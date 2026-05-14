import { defineCommand } from "citty";
import { consola } from "consola";
import { detectProjectType } from "../../utils/detect-project";
import { readAdapter } from "../../utils/adapter";
import { spawnClaude } from "../../utils/claude";
import { createStorage } from "../../storage";
import { loadPersistedState, savePersistedState } from "../../utils/storage-lifecycle";
import { extractClickUpId, fetchClickUpTicket, formatTicketAsContext } from "../../utils/clickup";
import { checkAuthorization } from "../../utils/auth";
import { sanitizeUserInput } from "../../utils/sanitize";
import { readState, writeState } from "../../utils/state";
import { buildRulesBlock } from "../../utils/prompt-builder";
import { runQualityGates } from "../../utils/verify";
import { formatVerificationResults } from "../../utils/github";
import {
  postGitHubComment,
  updateGitHubComment,
  reactToComment,
  formatSoftwareTeamsComment,
  formatErrorComment,
  fetchCommentThread,
  buildConversationContext,
  fetchIssueTitleAndBody,
  isPullRequest,
  fetchPrLinkedIssues,
  findPrTemplate,
  ASSISTANT_COMMENT_MARKER,
} from "../../utils/github";
import { gitBranch, gitCheckoutNewBranch, slugify } from "../../utils/git";
import { findActiveOrchestration } from "../../utils/orchestration";
import { parseResearcherQuestions } from "../../utils/researcher-output";
import { buildRouterPrompt, type ActionContext } from "./router-prompts";

type SoftwareTeamsCommand = "plan" | "implement" | "quick" | "review" | "feedback" | "ping";

interface ParsedIntent {
  command: SoftwareTeamsCommand;
  description: string;
  clickUpUrl: string | null;
  fullFlow: boolean;
  isFeedback: boolean;
  isApproval: boolean;
  dryRun: boolean;
}

// Fail-closed allow-list for --event-type values. New event types require an
// explicit code change — unknown values are rejected before any API calls.
const ALLOWED_EVENT_TYPES = new Set(["issue_labeled"]);

/**
 * Model used for every parent-Claude spawn in the GitHub Action flow.
 *
 * Defaults to Sonnet — Opus was costing ~$1 per test on small changes when
 * the parent inherited Claude Code's account default. Sonnet 4.6 is more
 * than capable of the planner/implementer self-play this action does today.
 *
 * Override per-repo by setting the `SOFTWARE_TEAMS_MODEL` env var (wired
 * through `vars.SOFTWARE_TEAMS_MODEL` in the workflow). Accepts either an
 * alias (`sonnet`, `opus`, `haiku`) or a full model ID
 * (e.g. `claude-opus-4-7`).
 *
 * NOTE: this knob is parent-Claude only. Sub-agents spawned via the Task
 * tool still use the `model:` pin in their spec frontmatter. Once we
 * migrate the action from "self-play with injected spec" to "router that
 * delegates to native subagents," the planner's `model: opus` pin in
 * `agents/software-teams-planner.md` becomes the dominant cost lever and
 * should be revisited.
 */
const ACTION_MODEL = process.env.SOFTWARE_TEAMS_MODEL || "claude-sonnet-4-6";

/**
 * Spawn the pre-plan researcher and return its markdown findings.
 *
 * Mirrors `commands/create-plan.md` §4a: before the Planning Agent runs,
 * we spawn `software-teams-researcher` in `pre-plan-discovery` mode to
 * survey the workspace, surface codebase context, and report genuine
 * pre-plan questions the issue text doesn't pin down. The findings are
 * threaded into the planner's brief as a `## Discovery findings` block.
 *
 * Failure (non-zero exit, empty response) is non-fatal — the caller
 * falls back to running the planner without findings, same as today's
 * behaviour. We log a warning so the operator can spot it in the run.
 */
async function runPrePlanDiscovery(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  intent: ParsedIntent;
  projectLines: string[];
  workspaceLines: string[];
  rulesBlock: string[];
  conversationHistory: string;
}): Promise<string> {
  const discoveryCtx: ActionContext = {
    flow: { kind: "pre-plan-discovery" },
    userRequest: opts.intent.description,
    repo: opts.repo ?? "",
    issueNumber: opts.issueNumber,
    conversationHistory: opts.conversationHistory,
    projectLines: opts.projectLines,
    workspaceLines: opts.workspaceLines,
    rulesBlock: opts.rulesBlock,
  };
  const discoveryPrompt = buildRouterPrompt(discoveryCtx);
  consola.info("Running pre-plan discovery (Research Agent)...");
  try {
    const result = await spawnClaude(discoveryPrompt, {
      cwd: opts.cwd,
      permissionMode: "acceptEdits",
      model: ACTION_MODEL,
    });
    if (result.exitCode !== 0 || !result.response.trim()) {
      consola.warn(
        `Pre-plan discovery returned no findings (exit ${result.exitCode}) — planner will run without them`,
      );
      return "";
    }
    consola.success(`Pre-plan discovery captured ${result.response.length} bytes of findings`);
    return result.response;
  } catch (err) {
    consola.warn(`Pre-plan discovery failed; planner will run without findings: ${err}`);
    return "";
  }
}

/**
 * Format a "🔮 A few questions before I plan" comment body from the
 * researcher's surfaced pre-plan questions. Wrapped by
 * `formatSoftwareTeamsComment("questions", …)` at the post site so the
 * comment header + invisible marker land consistently.
 */
function formatQuestionsCommentBody(questions: string[], issueNumber: number): string {
  return [
    `The Research Agent surveyed the codebase and has a few questions before producing a plan for issue #${issueNumber}. Answer them in a follow-up comment on this issue and the plan will continue.`,
    ``,
    `### Questions`,
    ``,
    ...questions.map((q) => `- ${q}`),
    ``,
    `_(I'll skip the plan until I have your answers — no plan files have been written yet.)_`,
  ].join("\n");
}

/**
 * Run the pre-plan researcher and gate the rest of the plan flow on its
 * output. When the researcher surfaces genuine pre-plan questions, the
 * runner posts a comment containing JUST those questions and exits — the
 * planner does NOT run, no plan files are written. The user replies in a
 * follow-up comment; on the next run the researcher sees their answers
 * in the conversation history and either returns `_none._` (plan
 * proceeds) or asks remaining questions (gate re-fires).
 *
 * Returns:
 *   - `{ findings, aborted: false }` — proceed to planner.
 *   - `{ findings: "", aborted: true }` — comment posted; caller MUST
 *     return / exit without running the planner.
 *
 * Mirrors `commands/create-plan.md` §4b ("Pre-Planning Questions
 * (Interactive Gate)") for the headless action context — AskUserQuestion
 * isn't available here, so we use issue comments as the human-in-loop
 * channel.
 */
async function runDiscoveryAndGate(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  intent: ParsedIntent;
  projectLines: string[];
  workspaceLines: string[];
  rulesBlock: string[];
  conversationHistory: string;
  placeholderCommentId: number | null;
  storage: ReturnType<typeof createStorage> extends Promise<infer S> ? S : never;
}): Promise<{ findings: string; aborted: boolean }> {
  const findings = await runPrePlanDiscovery({
    cwd: opts.cwd,
    repo: opts.repo,
    issueNumber: opts.issueNumber,
    intent: opts.intent,
    projectLines: opts.projectLines,
    workspaceLines: opts.workspaceLines,
    rulesBlock: opts.rulesBlock,
    conversationHistory: opts.conversationHistory,
  });

  const parsed = parseResearcherQuestions(findings);
  if (!parsed.hasQuestions) {
    return { findings, aborted: false };
  }

  consola.info(
    `Researcher surfaced ${parsed.questions.length} pre-plan question(s) — posting and aborting plan run`,
  );
  if (opts.repo && opts.issueNumber) {
    const body = formatQuestionsCommentBody(parsed.questions, opts.issueNumber);
    const finalBody = formatSoftwareTeamsComment("questions", body);
    if (opts.placeholderCommentId) {
      await updateGitHubComment(opts.repo, opts.placeholderCommentId, finalBody).catch((err) => {
        consola.error("Failed to update placeholder with questions:", err);
      });
    } else {
      await postGitHubComment(opts.repo, opts.issueNumber, finalBody).catch((err) => {
        consola.error("Failed to post questions comment:", err);
      });
    }
  }

  // Persist whatever state the researcher's run accumulated (rules etc.)
  // so the next run picks up where this one left off.
  await savePersistedState(opts.cwd, opts.storage).catch(() => {});

  return { findings: "", aborted: true };
}

interface FeatureBranchContext {
  branchName: string;
  defaultBranch: string;
}

/**
 * When the trigger came from an issue (no associated PR), cut a feature
 * branch off the current (default) branch BEFORE any agent runs so that the
 * implementation lands on a reviewable PR — never directly on main/master.
 * Returns null for PR-context runs (existing flow unchanged).
 *
 * Branch name format: `issue-<N>-<slug>` where slug is derived from the
 * user's description with leading command verbs ("implement", "quick",
 * "plan", "do", "the") stripped. No "software-teams/" prefix — the
 * branch name surfaces in PR titles when GitHub falls back from
 * commit-message derivation, and we don't want the brand leaking there.
 *
 * Examples:
 *   "Hey Software Teams implement the plan" (issue 49)
 *     description = "implement the plan"
 *     slug after strip = "plan" (leading "implement the" → leading verbs)
 *     branch = "issue-49-plan"
 *   "Hey Software Teams quick fix the nav bug" (issue 50)
 *     description = "fix the nav bug"
 *     slug after strip = "fix-the-nav-bug" (no leading command-verb to strip)
 *     branch = "issue-50-fix-the-nav-bug"
 */
/**
 * Derive the slug used in the feature-branch name. Prefers the plan's
 * filename slug (most specific to the work — e.g. `01-01-users-api.orchestration.md`
 * yields `users-api`) over the user's free-form description (often just
 * "implement the plan"). Falls back to the description, then to "task"
 * when both are empty.
 */
function deriveFeatureBranchSlug(opts: {
  description: string;
  orchestrationPath?: string;
}): string {
  if (opts.orchestrationPath) {
    const filename = opts.orchestrationPath.split("/").pop() ?? "";
    const planSlug = filename
      .replace(/\.orchestration\.md$/, "")
      // Strip leading phase/plan numeric prefixes like `01-01-` or `1-02-`.
      .replace(/^\d+-\d+-/, "")
      .replace(/^\d+-/, "");
    const slugged = slugify(planSlug, 40);
    if (slugged && slugged !== "task") return slugged;
  }

  // Fallback: strip leading filler verbs/articles the user often types after
  // the trigger phrase ("implement the plan", "quick fix the foo", etc.) so
  // the slug doesn't double up with the command word.
  const stripped = opts.description
    .replace(/^\s*(implement|quick|plan|do|the)\s+/i, "")
    .replace(/^\s*(implement|quick|plan|do|the)\s+/i, "")
    .trim();
  const slugBase = stripped.length > 0 ? stripped : opts.description;
  return slugify(slugBase, 40);
}

async function prepareIssueFeatureBranch(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  description: string;
  commandKind: "implement" | "quick";
  orchestrationPath?: string;
}): Promise<FeatureBranchContext | null> {
  if (!opts.repo || !opts.issueNumber) return null;
  if (await isPullRequest(opts.repo, opts.issueNumber)) return null;

  const defaultBranch = await gitBranch();
  const slug = deriveFeatureBranchSlug({
    description: opts.description,
    orchestrationPath: opts.orchestrationPath,
  });

  const branchName = `issue-${opts.issueNumber}-${slug}`;
  await gitCheckoutNewBranch(branchName, opts.cwd);
  return { branchName, defaultBranch };
}

function parseComment(
  comment: string,
  isFollowUp: boolean,
): ParsedIntent | null {
  // Detect --dry-run flag in comment body
  const hasDryRun = /--dry-run/i.test(comment);
  const cleanComment = comment.replace(/--dry-run/gi, "").trim();

  // Strip "Hey Software Teams" trigger prefix (case-insensitive; accepts
  // both spaced and hyphenated forms).
  const match = cleanComment.match(/hey\s+software[\s-]?teams\s+(.+)/is);
  if (!match) {
    // No trigger prefix — if this is a follow-up in an existing conversation,
    // treat the entire comment as feedback
    if (isFollowUp) {
      return {
        command: "plan", // will be overridden by conversation context
        description: cleanComment,
        clickUpUrl: null,
        fullFlow: false,
        isFeedback: true,
        isApproval: false,
        dryRun: hasDryRun,
      };
    }
    return null;
  }

  const body = match[1].trim();

  // Extract ClickUp URL if present
  const clickUpMatch = body.match(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i);
  const clickUpUrl = clickUpMatch ? clickUpMatch[1] : null;

  // Remove the URL from the body for cleaner description
  const description = body
    .replace(/(https?:\/\/[^\s]*clickup\.com\/t\/[a-z0-9]+)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = body.toLowerCase();

  const base = { clickUpUrl, fullFlow: false, isFeedback: false, isApproval: false, dryRun: hasDryRun };

  // "approved" / "lgtm" / "looks good" — explicit approval (does NOT trigger implementation)
  // Must be checked BEFORE command prefixes so "plan approved" is treated as approval, not a new plan.
  if (/\b(approved?|lgtm|looks?\s*good|ship\s*it)\b/i.test(lower)) {
    return { ...base, command: "plan", description: body, clickUpUrl: null, isFeedback: true, isApproval: true };
  }

  // Explicit commands always start a new workflow
  if (lower.startsWith("ping") || lower.startsWith("status")) {
    return { ...base, command: "ping", description: "", clickUpUrl: null };
  }
  if (lower.startsWith("plan ")) {
    return { ...base, command: "plan", description };
  }
  if (lower.startsWith("implement")) {
    return { ...base, command: "implement", description };
  }
  if (lower.startsWith("quick ")) {
    return { ...base, command: "quick", description };
  }
  if (lower.startsWith("review")) {
    return { ...base, command: "review", description };
  }
  if (lower.startsWith("feedback")) {
    return { ...base, command: "feedback", description };
  }

  // "do" triggers full flow (plan + implement) if ClickUp URL present
  if (lower.startsWith("do ")) {
    if (clickUpUrl) {
      return { ...base, command: "plan", description, fullFlow: true };
    }
    return { ...base, command: "quick", description };
  }

  // If there's an existing conversation, treat ambiguous trigger-prefixed messages as refinement feedback
  if (isFollowUp) {
    return { ...base, command: "plan", description: body, clickUpUrl: null, isFeedback: true };
  }

  // Default: treat as new plan request
  return { ...base, command: "plan", description };
}

export const runCommand = defineCommand({
  meta: {
    name: "run",
    description: "GitHub Action entry point — parse 'Hey Software Teams' comment and run workflow",
  },
  args: {
    comment: {
      type: "positional",
      description: "The raw comment body containing the trigger mention (default 'Hey Software Teams')",
      required: true,
    },
    "comment-id": {
      type: "string",
      description: "GitHub comment ID for reactions",
    },
    "pr-number": {
      type: "string",
      description: "PR number (if triggered from a PR)",
    },
    "issue-number": {
      type: "string",
      description: "Issue number (if triggered from an issue)",
    },
    repo: {
      type: "string",
      description: "Repository in owner/repo format",
    },
    "comment-author": {
      type: "string",
      // On the label-trigger path this carries either the issue author or the
      // labeller — whichever the workflow YAML supplies (T4 decides).
      description: "GitHub username of the comment/issue author (for auth gate); on the label path carries the issue author or labeller",
    },
    "event-type": {
      type: "string",
      description: "Event type override — set by the workflow YAML for non-comment triggers (e.g. 'issue_labeled')",
    },
    "allowed-users": {
      type: "string",
      description: "Comma-separated list of allowed GitHub usernames",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
    const commentId = args["comment-id"] ? Number(args["comment-id"]) : null;
    const issueNumber = Number(args["pr-number"] ?? args["issue-number"] ?? 0);
    const commentAuthor = args["comment-author"] ?? process.env.COMMENT_AUTHOR ?? "";
    const allowedUsers = args["allowed-users"] ?? process.env.ALLOWED_USERS ?? "";

    // Fail-closed event-type validation — reject any value not in the allow-list
    if (args["event-type"] !== undefined && !ALLOWED_EVENT_TYPES.has(args["event-type"])) {
      consola.error(
        `Unsupported event-type: "${args["event-type"]}". Allowed values: ${[...ALLOWED_EVENT_TYPES].join(", ")}`,
      );
      process.exit(1);
    }

    // Opt-in authorization gate — only active if SOFTWARE_TEAMS_AUTH_ENABLED or --allowed-users is set
    if (commentAuthor && (allowedUsers || process.env.SOFTWARE_TEAMS_AUTH_ENABLED)) {
      const authResult = await checkAuthorization(repo!, commentAuthor, allowedUsers || undefined);
      if (!authResult.authorized) {
        consola.warn(`Auth denied: ${authResult.reason}`);
        if (repo && commentId) {
          await reactToComment(repo, commentId, "confused").catch(() => {});
        }
        if (repo && issueNumber) {
          const denyBody = formatSoftwareTeamsComment("auth", `Access denied: ${authResult.reason}`);
          await postGitHubComment(repo, issueNumber, denyBody).catch(() => {});
        }
        return;
      }
    }

    // ── Label-triggered path (issue_labeled) ──────────────────────────────────
    // Bypasses comment parsing and thread fetching — the issue title+body IS
    // the user request. Continues into the existing planner-prompt path below.
    if (args["event-type"] === "issue_labeled") {
      consola.info(`Label-triggered run — fetching issue ${issueNumber} from ${repo}`);

      if (!repo) {
        consola.error("--repo (or GITHUB_REPOSITORY) is required for label-triggered runs");
        process.exit(1);
      }
      if (!issueNumber) {
        consola.error("--issue-number is required for label-triggered runs");
        process.exit(1);
      }

      const issue = await fetchIssueTitleAndBody(repo, issueNumber);
      if (!issue) {
        consola.error(`Failed to fetch issue ${issueNumber} from ${repo}`);
        process.exit(1);
      }

      const { title, body } = issue;
      // Build synthetic description: title + body (trim trailing whitespace;
      // empty body → just the title with no trailing newlines)
      const synthetic = body.trim() ? `${title}\n\n${body}` : title;
      const sanitized = sanitizeUserInput(synthetic, 10_000);

      const intent: ParsedIntent = {
        command: "plan",
        description: sanitized,
        clickUpUrl: null,
        fullFlow: false,
        isFeedback: false,
        isApproval: false,
        dryRun: false,
      };

      // No comment thread or comment ID on this path — conversation history
      // is passed empty to the router brief.
      consola.info("Parsed intent: plan (label-triggered)");

      // No eyes reaction — there is no comment to react to
      // Post a thinking placeholder comment
      let placeholderCommentId: number | null = null;
      if (repo && issueNumber) {
        const thinkingBody = `${ASSISTANT_COMMENT_MARKER}\n<h3>🧠 Working on it...</h3>\n\n---\n\n_Reviewing your request..._`;
        placeholderCommentId = await postGitHubComment(repo, issueNumber, thinkingBody).catch(() => null);
      }

      // ── Delegate to the shared planner-prompt path ──────────────────────────
      // Re-use all the prompt-building and execution logic that follows the
      // comment-parsing block. We jump there by falling through into the shared
      // variable scope below — but since the async run() function is a single
      // block, we extract the shared logic via an IIFE-style inline call.
      // Simpler: duplicate only the load + prompt-build + execute + post steps.
      const storage = await createStorage(cwd);
      const { rulesPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

      const projectType = await detectProjectType(cwd);
      const adapter = await readAdapter(cwd);
      const techStack = adapter?.tech_stack
        ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
        : projectType;

      const projectLines = [
        `## Project Context`,
        `- Type: ${projectType}`,
        `- Tech stack: ${techStack}`,
        `- Rules: ${rulesPath ?? "(none)"}`,
        `- Codebase index: ${codebaseIndexPath ?? "(none)"}`,
      ];

      const workspaceLines = [
        `## Workspace`,
        `- Working directory: ${cwd}`,
      ];

      const gateResult = await runDiscoveryAndGate({
        cwd,
        repo,
        issueNumber,
        intent,
        projectLines,
        workspaceLines,
        rulesBlock: buildRulesBlock(techStack),
        conversationHistory: "",
        placeholderCommentId,
        storage,
      });
      if (gateResult.aborted) {
        // Researcher surfaced pre-plan questions — comment posted, no
        // plan written. Wait for the user to reply; the next run picks
        // up their answers via the conversation history bridge.
        return;
      }
      const routerCtx: ActionContext = {
        flow: { kind: "plan" },
        userRequest: intent.description,
        repo: repo!,
        issueNumber,
        conversationHistory: "",
        projectLines,
        workspaceLines,
        rulesBlock: buildRulesBlock(techStack),
        prePlanDiscovery: gateResult.findings || undefined,
      };
      const prompt = buildRouterPrompt(routerCtx);

      let success = true;
      let fullResponse = "";
      try {
        const { exitCode, response } = await spawnClaude(prompt, {
          cwd,
          permissionMode: "acceptEdits",
          model: ACTION_MODEL,
        });
        fullResponse = response;
        if (exitCode !== 0) {
          success = false;
          consola.error(`Claude exited with code ${exitCode}`);
        }
      } catch (err) {
        success = false;
        consola.error("Execution failed:", err);
      }

      const saved = await savePersistedState(cwd, storage);
      if (saved.rulesSaved) consola.info("Rules persisted to storage");
      if (saved.codebaseIndexSaved) consola.info("Codebase index persisted to storage");

      if (repo && issueNumber) {
        const actionLabel = "plan";
        let commentBody: string;
        if (success && fullResponse) {
          commentBody = formatSoftwareTeamsComment(actionLabel, fullResponse);
        } else if (!success) {
          commentBody = formatErrorComment(actionLabel, "Check workflow logs for details.");
        } else {
          commentBody = formatSoftwareTeamsComment(actionLabel, `Executed \`${actionLabel}\` successfully.`);
        }

        if (placeholderCommentId) {
          await updateGitHubComment(repo, placeholderCommentId, commentBody).catch((err) => {
            consola.error("Failed to update result comment:", err);
          });
        } else {
          await postGitHubComment(repo, issueNumber, commentBody).catch((err) => {
            consola.error("Failed to post result comment:", err);
          });
        }
      }

      if (!success) process.exit(1);
      return;
    }
    // ── End label-triggered path ───────────────────────────────────────────────

    // Fetch comment thread to detect if this is a follow-up conversation.
    // On PR-context runs, also fetch comments from any issue this PR
    // closes (via `Closes #N` trailer) so the agent inherits the originating
    // issue's conversation — otherwise it would start from scratch on the
    // first PR comment.
    let conversationHistory = "";
    let isFollowUp = false;
    let isPostImplementation = false;
    if (repo && issueNumber) {
      let thread = await fetchCommentThread(repo, issueNumber);

      if (await isPullRequest(repo, issueNumber)) {
        const linkedIssues = await fetchPrLinkedIssues(repo, issueNumber);
        for (const issueN of linkedIssues) {
          const linkedThread = await fetchCommentThread(repo, issueN);
          if (linkedThread.length > 0) {
            consola.info(
              `Bridged ${linkedThread.length} comment(s) from linked issue #${issueN}`,
            );
            thread = [...linkedThread, ...thread];
          }
        }
      }

      const context = buildConversationContext(
        thread,
        commentId ?? 0,
      );
      conversationHistory = context.history;
      isFollowUp = context.isFollowUp;
      isPostImplementation = context.isPostImplementation;

      if (isFollowUp) {
        consola.info(
          `Continuing conversation (${context.previousRuns} previous assistant run(s))${isPostImplementation ? " [post-implementation]" : ""}`,
        );
      }
      // Sanitize conversation history (may contain user-controlled content)
      conversationHistory = sanitizeUserInput(conversationHistory, 50_000);
    }

    // Parse intent — pass isFollowUp so ambiguous messages become feedback
    const intent = parseComment(args.comment, isFollowUp);
    if (!intent) {
      consola.error("Could not parse trigger phrase (e.g. 'Hey Software Teams ...') from comment");
      process.exit(1);
    }

    // Sanitize user-controlled input
    intent.description = sanitizeUserInput(intent.description, 10_000);

    consola.info(
      `Parsed intent: ${intent.isApproval ? "approval (finalise plan)" : intent.isFeedback ? "refinement feedback" : intent.command}${intent.fullFlow ? " (full flow)" : ""}`,
    );

    // React with eyes to indicate processing
    if (repo && commentId) {
      await reactToComment(repo, commentId, "eyes").catch(() => {});
    }

    // Post a thinking placeholder comment
    let placeholderCommentId: number | null = null;
    if (repo && issueNumber) {
      const thinkingBody = `${ASSISTANT_COMMENT_MARKER}\n<h3>🧠 Working on it...</h3>\n\n---\n\n_Reviewing your request..._`;
      placeholderCommentId = await postGitHubComment(repo, issueNumber, thinkingBody).catch(() => null);
    }

    // Approval: lightweight confirmation — no Claude invocation needed
    if (intent.isFeedback && intent.isApproval) {
      // Update state.yaml using proper YAML parser
      const state = await readState(cwd) ?? {};
      state.review = {
        ...state.review,
        status: "approved",
        approved_at: new Date().toISOString(),
      } as any;
      await writeState(cwd, state);

      const approvalBody = `Plan approved and locked in.\n\nSay **\`Hey Software Teams implement\`** when you're ready to go.`;
      const finalBody = formatSoftwareTeamsComment("plan", approvalBody);

      if (repo && placeholderCommentId) {
        await updateGitHubComment(repo, placeholderCommentId, finalBody).catch((err) => {
          consola.error("Failed to update approval comment:", err);
        });
      } else if (repo && issueNumber) {
        await postGitHubComment(repo, issueNumber, finalBody).catch((err) => {
          consola.error("Failed to post approval comment:", err);
        });
      } else {
        console.log(finalBody);
      }

      if (repo && commentId) {
        await reactToComment(repo, commentId, "+1").catch(() => {});
      }
      return;
    }

    // Ping: quick framework status check — no Claude invocation needed
    if (intent.command === "ping") {
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      const frameworkExists = existsSync(join(cwd, ".software-teams/framework"));
      const claudeMdExists = existsSync(join(cwd, ".claude/CLAUDE.md"));
      const stateExists = existsSync(join(cwd, ".software-teams/config/state.yaml"));
      const rulesExists = existsSync(join(cwd, ".software-teams/rules"));

      let version = "unknown";
      try {
        const pkgPath = join(cwd, "node_modules/@websitelabs/software-teams/package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(await Bun.file(pkgPath).text());
          version = pkg.version;
        }
      } catch {}

      const statusBody = [
        `**Framework Status**`,
        ``,
        `| Component | Status |`,
        `|-----------|--------|`,
        `| Framework files | ${frameworkExists ? "found" : "missing"} |`,
        `| CLAUDE.md | ${claudeMdExists ? "found" : "missing"} |`,
        `| State config | ${stateExists ? "found" : "missing"} |`,
        `| Rules | ${rulesExists ? "found" : "missing"} |`,
        `| Version | \`${version}\` |`,
      ].join("\n");

      const finalBody = formatSoftwareTeamsComment("ping", statusBody);

      if (repo && placeholderCommentId) {
        await updateGitHubComment(repo, placeholderCommentId, finalBody).catch((err) => {
          consola.error("Failed to update ping comment:", err);
        });
      } else if (repo && issueNumber) {
        await postGitHubComment(repo, issueNumber, finalBody).catch((err) => {
          consola.error("Failed to post ping comment:", err);
        });
      } else {
        console.log(finalBody);
      }

      if (repo && commentId) {
        await reactToComment(repo, commentId, "+1").catch(() => {});
      }
      return;
    }

    // Load persisted state via storage
    const storage = await createStorage(cwd);
    const { rulesPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

    // Fetch ClickUp ticket context if URL present
    let ticketContext = "";
    if (intent.clickUpUrl) {
      const taskId = extractClickUpId(intent.clickUpUrl);
      if (taskId) {
        consola.info(`Fetching ClickUp ticket: ${taskId}`);
        const ticket = await fetchClickUpTicket(taskId);
        if (ticket) {
          ticketContext = formatTicketAsContext(ticket);
          consola.success(`Loaded ticket: ${ticket.name}`);
        }
      }
    }

    // Build project context
    const projectType = await detectProjectType(cwd);
    const adapter = await readAdapter(cwd);
    const techStack = adapter?.tech_stack
      ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
      : projectType;

    // Project-identity block. Byte-stable for a given project — placeholders
    // fill in for absent fields so the same prefix appears on every action
    // invocation. Runtime-varying bits (cwd, ticket context, conversation
    // history) live in `workspaceLines` and `historyBlock` below and are
    // emitted strictly AFTER the cacheable header.
    const projectLines = [
      `## Project Context`,
      `- Type: ${projectType}`,
      `- Tech stack: ${techStack}`,
      `- Rules: ${rulesPath ?? "(none)"}`,
      `- Codebase index: ${codebaseIndexPath ?? "(none)"}`,
    ];

    const workspaceLines = [
      `## Workspace`,
      `- Working directory: ${cwd}`,
    ];
    if (ticketContext) {
      workspaceLines.push(``, ticketContext);
    }

    // Build prompt based on whether this is feedback or a new command.
    // All prompt assembly is delegated to `buildRouterPrompt` — the parent
    // Claude is a thin router that spawns the right Software Teams
    // specialist via the `Task` tool. No component bodies or planner-spec
    // text is inlined here; subagents auto-load their `.claude/agents/*.md`
    // spec natively.
    let prompt: string;

    if (intent.isFeedback && isPostImplementation) {
      // ── Post-implementation iteration — allow code changes, commit, push ──
      const routerCtx: ActionContext = {
        flow: { kind: "post-impl-iteration" },
        userRequest: intent.description,
        repo: repo ?? "",
        issueNumber,
        conversationHistory,
        projectLines,
        workspaceLines,
        rulesBlock: buildRulesBlock(techStack),
        isDryRun: intent.dryRun,
      };
      prompt = buildRouterPrompt(routerCtx);
    } else if (intent.isFeedback) {
      // ── Plan refinement OR answer-to-pre-plan-questions ──
      //
      // The user wrote a follow-up comment without an explicit trigger
      // phrase. Two cases:
      //
      //   (a) A plan already exists for this issue → refinement. The
      //       Planning Agent edits the existing plan in place.
      //   (b) No plan exists yet → the user is answering pre-plan
      //       questions from a prior Phase C abort. Reroute through the
      //       Discovery Gate: researcher reads the conversation history
      //       (which now includes the user's answers) and either returns
      //       `_none._` → planner builds a fresh plan, or surfaces
      //       remaining questions → gate re-fires.
      const existingOrch = await findActiveOrchestration(cwd, issueNumber);
      if (existingOrch) {
        // (a) Refinement — update the plan only, NEVER implement.
        const routerCtx: ActionContext = {
          flow: { kind: "plan", isRefinement: true },
          userRequest: intent.description,
          repo: repo ?? "",
          issueNumber,
          conversationHistory,
          projectLines,
          workspaceLines,
          rulesBlock: buildRulesBlock(techStack),
          isDryRun: intent.dryRun,
        };
        prompt = buildRouterPrompt(routerCtx);
      } else {
        // (b) No plan yet — treat as initial plan with the user's answers
        // folded into the conversation history.
        consola.info(
          `No plan exists for issue #${issueNumber} yet — treating this follow-up as an answer to pre-plan questions`,
        );
        const gateResult = await runDiscoveryAndGate({
          cwd,
          repo,
          issueNumber,
          intent,
          projectLines,
          workspaceLines,
          rulesBlock: buildRulesBlock(techStack),
          conversationHistory,
          placeholderCommentId,
          storage,
        });
        if (gateResult.aborted) return;
        const routerCtx: ActionContext = {
          flow: { kind: "plan" },
          userRequest: intent.description,
          repo: repo ?? "",
          issueNumber,
          conversationHistory,
          projectLines,
          workspaceLines,
          rulesBlock: buildRulesBlock(techStack),
          prePlanDiscovery: gateResult.findings || undefined,
          isDryRun: intent.dryRun,
        };
        prompt = buildRouterPrompt(routerCtx);
      }
    } else {
      // ── New command — route to the appropriate native subagent. ──
      switch (intent.command) {
        case "plan": {
          const gateResult = await runDiscoveryAndGate({
            cwd,
            repo,
            issueNumber,
            intent,
            projectLines,
            workspaceLines,
            rulesBlock: buildRulesBlock(techStack),
            conversationHistory,
            placeholderCommentId,
            storage,
          });
          if (gateResult.aborted) return;
          const routerCtx: ActionContext = {
            flow: { kind: "plan" },
            userRequest: intent.description,
            repo: repo ?? "",
            issueNumber,
            conversationHistory,
            projectLines,
            workspaceLines,
            rulesBlock: buildRulesBlock(techStack),
            prePlanDiscovery: gateResult.findings || undefined,
            isDryRun: intent.dryRun,
          };
          prompt = buildRouterPrompt(routerCtx);
          break;
        }

        case "implement": {
          const orchestration = await findActiveOrchestration(cwd, issueNumber);
          if (!orchestration) {
            // No plan tagged with `issue: ${issueNumber}` exists in the
            // workspace. Implementing whatever stale plan is lying around
            // (the May-11 regression) is unsafe — refuse and tell the user
            // to run plan first.
            consola.error(
              `No plan found for issue #${issueNumber} in .software-teams/plans/. Refusing to implement.`,
            );
            const body = `_No current plan found for issue #${issueNumber}._\n\nThis issue does not have a three-tier plan tagged with \`issue: ${issueNumber}\` in its orchestration frontmatter. Run **\`Hey Software Teams plan\`** on this issue first, then comment **\`Hey Software Teams implement\`** once the plan is ready.`;
            const finalBody = formatErrorComment("implement", body);
            if (repo && placeholderCommentId) {
              await updateGitHubComment(repo, placeholderCommentId, finalBody).catch(() => {});
            } else if (repo && issueNumber) {
              await postGitHubComment(repo, issueNumber, finalBody).catch(() => {});
            }
            process.exit(1);
          }
          const fb = await prepareIssueFeatureBranch({
            cwd, repo, issueNumber, description: intent.description, commandKind: "implement",
            orchestrationPath: orchestration.orchestrationPath,
          });
          if (orchestration.slices.length >= 2) {
            consola.info(
              `Three-tier plan detected — orchestrator will dispatch ${orchestration.slices.length} per-agent spawns in parallel`,
            );
          }
          const routerCtx: ActionContext = {
            flow: { kind: "implement" },
            userRequest: intent.description,
            repo: repo ?? "",
            issueNumber,
            conversationHistory,
            projectLines,
            workspaceLines,
            rulesBlock: buildRulesBlock(techStack),
            featureBranch: fb ?? undefined,
            prTemplate: fb ? findPrTemplate(cwd) ?? undefined : undefined,
            orchestration,
            isDryRun: intent.dryRun,
          };
          prompt = buildRouterPrompt(routerCtx);
          break;
        }

        case "quick": {
          const fb = await prepareIssueFeatureBranch({
            cwd, repo, issueNumber, description: intent.description, commandKind: "quick",
          });
          const routerCtx: ActionContext = {
            flow: { kind: "quick" },
            userRequest: intent.description,
            repo: repo ?? "",
            issueNumber,
            conversationHistory,
            projectLines,
            workspaceLines,
            rulesBlock: buildRulesBlock(techStack),
            featureBranch: fb ?? undefined,
            prTemplate: fb ? findPrTemplate(cwd) ?? undefined : undefined,
            isDryRun: intent.dryRun,
          };
          prompt = buildRouterPrompt(routerCtx);
          break;
        }

        case "review": {
          const routerCtx: ActionContext = {
            flow: { kind: "review" },
            userRequest: intent.description,
            repo: repo ?? "",
            issueNumber,
            conversationHistory,
            projectLines,
            workspaceLines,
            rulesBlock: buildRulesBlock(techStack),
            isDryRun: intent.dryRun,
          };
          prompt = buildRouterPrompt(routerCtx);
          break;
        }

        case "feedback": {
          const routerCtx: ActionContext = {
            flow: { kind: "feedback" },
            userRequest: intent.description,
            repo: repo ?? "",
            issueNumber,
            conversationHistory,
            projectLines,
            workspaceLines,
            rulesBlock: buildRulesBlock(techStack),
            isDryRun: intent.dryRun,
          };
          prompt = buildRouterPrompt(routerCtx);
          break;
        }

        // Note: `ping` is handled earlier in the function and never reaches
        // this switch. TypeScript narrows it out of `intent.command` by the
        // time we get here.
        default: {
          // Exhaustiveness — every command in SoftwareTeamsCommand must have
          // a case above. If TypeScript complains here, add the missing case.
          const _exhaustive: never = intent.command;
          throw new Error(`Unhandled command: ${_exhaustive}`);
        }
      }
    }

    // Dry-run mode is handled inside `buildRouterPrompt` (the brief carries
    // a DRY-RUN MODE block when `isDryRun: true`) so the SUBAGENT — which
    // actually does the work — sees the no-write directive. The parent
    // router only spawns Task + echoes the result, so a trailing dry-run
    // line on the parent prompt is moot.

    // Execute
    let success = true;
    let fullResponse = "";
    try {
      const { exitCode, response } = await spawnClaude(prompt, {
        cwd,
        permissionMode: "acceptEdits",
        allowedTools: intent.dryRun ? ["Read", "Glob", "Grep", "Bash"] : undefined,
        model: ACTION_MODEL,
      });
      fullResponse = response;
      if (exitCode !== 0) {
        success = false;
        consola.error(`Claude exited with code ${exitCode}`);
      }

      // If full flow, run implement after plan
      if (intent.fullFlow && success) {
        consola.info("Full flow: now running implement...");
        // Look up orchestration FIRST so the feature branch can be named
        // after the plan slug rather than the user's free-form description.
        const implOrchestration = await findActiveOrchestration(cwd, issueNumber);
        const fb = await prepareIssueFeatureBranch({
          cwd, repo, issueNumber, description: intent.description, commandKind: "implement",
          orchestrationPath: implOrchestration?.orchestrationPath,
        });
        if (implOrchestration && implOrchestration.slices.length >= 2) {
          consola.info(
            `Three-tier plan detected — orchestrator will dispatch ${implOrchestration.slices.length} per-agent spawns in parallel`,
          );
        }
        const implRouterCtx: ActionContext = {
          flow: { kind: "implement" },
          userRequest: intent.description,
          repo: repo ?? "",
          issueNumber,
          conversationHistory,
          projectLines,
          workspaceLines,
          rulesBlock: buildRulesBlock(techStack),
          featureBranch: fb ?? undefined,
          prTemplate: fb ? findPrTemplate(cwd) ?? undefined : undefined,
          orchestration: implOrchestration ?? undefined,
          isDryRun: intent.dryRun,
        };
        const implementPrompt = buildRouterPrompt(implRouterCtx);

        const implResult = await spawnClaude(implementPrompt, {
          cwd,
          permissionMode: "acceptEdits",
          model: ACTION_MODEL,
        });
        if (implResult.exitCode !== 0) {
          success = false;
        }
        // Append implementation response
        if (implResult.response) {
          fullResponse += "\n\n---\n\n" + implResult.response;
        }

        // Run quality gates after full-flow implementation
        if (!intent.dryRun) {
          const verification = await runQualityGates(cwd);
          if (verification.gates.length > 0) {
            fullResponse += "\n\n" + formatVerificationResults(verification);
          }
        }
      }
    } catch (err) {
      success = false;
      consola.error("Execution failed:", err);
    }

    // Save updated state back to storage
    const saved = await savePersistedState(cwd, storage);
    if (saved.rulesSaved) consola.info("Rules persisted to storage");
    if (saved.codebaseIndexSaved) consola.info("Codebase index persisted to storage");

    // Update placeholder comment with final response (or post new if placeholder failed)
    if (repo && issueNumber) {
      const actionLabel = intent.isFeedback ? "feedback" : intent.command;
      let commentBody: string;

      if (success && fullResponse) {
        commentBody = formatSoftwareTeamsComment(actionLabel, fullResponse);
      } else if (!success) {
        commentBody = formatErrorComment(actionLabel, "Check workflow logs for details.");
      } else {
        commentBody = formatSoftwareTeamsComment(actionLabel, `Executed \`${actionLabel}\` successfully.`);
      }

      if (placeholderCommentId) {
        await updateGitHubComment(repo, placeholderCommentId, commentBody).catch((err) => {
          consola.error("Failed to update result comment:", err);
        });
      } else {
        await postGitHubComment(repo, issueNumber, commentBody).catch((err) => {
          consola.error("Failed to post result comment:", err);
        });
      }
    }

    // React with result
    if (repo && commentId) {
      const reaction = success ? "+1" : "-1";
      await reactToComment(repo, commentId, reaction).catch(() => {});
    }

    if (!success) process.exit(1);
  },
});
