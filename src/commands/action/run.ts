import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "node:path";
import { detectProjectType } from "../../utils/detect-project";
import { readAdapter } from "../../utils/adapter";
import { spawnClaude } from "../../utils/claude";
import { createStorage } from "../../storage";
import { loadPersistedState, savePersistedState } from "../../utils/storage-lifecycle";
import { extractClickUpId, fetchClickUpTicket, formatTicketAsContext } from "../../utils/clickup";
import { checkAuthorization } from "../../utils/auth";
import { sanitizeUserInput, fenceUserInput } from "../../utils/sanitize";
import { readState, writeState } from "../../utils/state";
import { applyDryRunMode, buildLearningsBlock } from "../../utils/prompt-builder";
import { runQualityGates } from "../../utils/verify";
import { formatVerificationResults } from "../../utils/github";
import {
  postGitHubComment,
  updateGitHubComment,
  reactToComment,
  formatJdiComment,
  formatErrorComment,
  fetchCommentThread,
  buildConversationContext,
} from "../../utils/github";

type JdiCommand = "plan" | "implement" | "quick" | "review" | "feedback" | "ping";

interface ParsedIntent {
  command: JdiCommand;
  description: string;
  clickUpUrl: string | null;
  fullFlow: boolean;
  isFeedback: boolean;
  isApproval: boolean;
  dryRun: boolean;
}

function parseComment(
  comment: string,
  isFollowUp: boolean,
): ParsedIntent | null {
  // Detect --dry-run flag in comment body
  const hasDryRun = /--dry-run/i.test(comment);
  const cleanComment = comment.replace(/--dry-run/gi, "").trim();

  // Strip "Hey jdi" prefix (case-insensitive)
  const match = cleanComment.match(/hey\s+jdi\s+(.+)/is);
  if (!match) {
    // No "Hey jdi" prefix — if this is a follow-up in an existing conversation,
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

  // If there's an existing conversation, treat ambiguous "Hey jdi" messages as refinement feedback
  if (isFollowUp) {
    return { ...base, command: "plan", description: body, clickUpUrl: null, isFeedback: true };
  }

  // Default: treat as new plan request
  return { ...base, command: "plan", description };
}

export const runCommand = defineCommand({
  meta: {
    name: "run",
    description: "GitHub Action entry point — parse 'Hey jdi' comment and run workflow",
  },
  args: {
    comment: {
      type: "positional",
      description: "The raw comment body containing 'Hey jdi' mention",
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
      description: "GitHub username of the comment author (for auth gate)",
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

    // Opt-in authorization gate — only active if SOFTWARE_TEAMS_AUTH_ENABLED or --allowed-users is set
    if (commentAuthor && (allowedUsers || process.env.SOFTWARE_TEAMS_AUTH_ENABLED)) {
      const authResult = await checkAuthorization(repo!, commentAuthor, allowedUsers || undefined);
      if (!authResult.authorized) {
        consola.warn(`Auth denied: ${authResult.reason}`);
        if (repo && commentId) {
          await reactToComment(repo, commentId, "confused").catch(() => {});
        }
        if (repo && issueNumber) {
          const denyBody = formatJdiComment("auth", `Access denied: ${authResult.reason}`);
          await postGitHubComment(repo, issueNumber, denyBody).catch(() => {});
        }
        return;
      }
    }

    // Fetch comment thread to detect if this is a follow-up conversation
    let conversationHistory = "";
    let isFollowUp = false;
    let isPostImplementation = false;
    if (repo && issueNumber) {
      const thread = await fetchCommentThread(repo, issueNumber);
      const context = buildConversationContext(
        thread,
        commentId ?? 0,
      );
      conversationHistory = context.history;
      isFollowUp = context.isFollowUp;
      isPostImplementation = context.isPostImplementation;

      if (isFollowUp) {
        consola.info(
          `Continuing conversation (${context.previousJdiRuns} previous JDI run(s))${isPostImplementation ? " [post-implementation]" : ""}`,
        );
      }
      // Sanitize conversation history (may contain user-controlled content)
      conversationHistory = sanitizeUserInput(conversationHistory, 50_000);
    }

    // Parse intent — pass isFollowUp so ambiguous messages become feedback
    const intent = parseComment(args.comment, isFollowUp);
    if (!intent) {
      consola.error("Could not parse 'Hey jdi' intent from comment");
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
      const thinkingBody = `<h3>🧠 JDI <sup>thinking</sup></h3>\n\n---\n\n_Working on it..._`;
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

      const approvalBody = `Plan approved and locked in.\n\nSay **\`Hey jdi implement\`** when you're ready to go.`;
      const finalBody = formatJdiComment("plan", approvalBody);

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
      const learningsExists = existsSync(join(cwd, ".software-teams/persistence/learnings.md"));

      let version = "unknown";
      try {
        const pkgPath = join(cwd, "node_modules/@benzotti/software-teams/package.json");
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
        `| Learnings | ${learningsExists ? "found" : "missing"} |`,
        `| Version | \`${version}\` |`,
      ].join("\n");

      const finalBody = formatJdiComment("ping", statusBody);

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
    const { learningsPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

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

    const contextLines = [
      `## Project Context`,
      `- Type: ${projectType}`,
      `- Tech stack: ${techStack}`,
      `- Working directory: ${cwd}`,
    ];

    if (learningsPath) {
      contextLines.push(`- Learnings: ${learningsPath}`);
    }
    if (codebaseIndexPath) {
      contextLines.push(`- Codebase index: ${codebaseIndexPath}`);
    }
    if (ticketContext) {
      contextLines.push(``, ticketContext);
    }

    const baseProtocol = resolve(cwd, ".software-teams/framework/components/meta/AgentBase.md");

    // Build prompt based on whether this is feedback or a new command
    let prompt: string;

    if (intent.isFeedback && isPostImplementation) {
      // ── Post-implementation iteration — allow code changes, commit, push ──
      prompt = [
        `Read ${baseProtocol} for the base agent protocol.`,
        ``,
        ...contextLines,
        ``,
        ...buildLearningsBlock(techStack),
        ``,
        fenceUserInput("conversation-history", conversationHistory),
        ``,
        `## Feedback on Implementation`,
        fenceUserInput("user-request", intent.description),
        ``,
        `## Instructions`,
        `The user is iterating on code that Software Teams already implemented. Review the conversation above to understand what was built.`,
        `Be conversational — if the user asks a question, answer it first. Then make changes if needed.`,
        `Apply changes incrementally to the existing code — do not rewrite from scratch.`,
        ``,
        `## Auto-Commit`,
        `You are already on the correct PR branch. Do NOT create new branches or switch branches.`,
        `After making changes:`,
        `1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`,
        `2. \`git commit -m "fix: ..."\` or \`git commit -m "refactor: ..."\` with a conventional commit message`,
        `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
        `Present a summary of what you changed.`,
      ].join("\n");
    } else if (intent.isFeedback) {
      // ── Refinement — update the plan only, NEVER implement ──
      const agentSpec = resolve(cwd, `.software-teams/framework/agents/software-teams-planner.md`);

      prompt = [
        `Read ${baseProtocol} for the base agent protocol.`,
        `You are software-teams-planner. Read ${agentSpec} for your full specification.`,
        ``,
        ...contextLines,
        ``,
        fenceUserInput("conversation-history", conversationHistory),
        ``,
        `## Refinement Feedback`,
        fenceUserInput("user-request", intent.description),
        ``,
        `## HARD CONSTRAINTS — PLAN REFINEMENT MODE`,
        `- ONLY modify files under \`.software-teams/plans/\` and \`.software-teams/config/\` — NEVER create, edit, or delete source code files`,
        `- NEVER run \`git commit\`, \`git push\`, or any git write operations`,
        `- Planning and implementation are SEPARATE gates — user must explicitly approve before implementation`,
        ``,
        `## Instructions`,
        `Read state.yaml and existing plan files. Apply feedback incrementally — do not restart from scratch.`,
        `If the feedback is a question, answer it conversationally. If it implies a plan change, update the plan.`,
        `Maintain the SPLIT plan format: update the index file and individual task files (.T{n}.md) separately.`,
        ``,
        `## Response Format (MANDATORY)`,
        `1-2 sentence summary of what changed. Then the updated plan summary in a collapsible block:`,
        `\`<details><summary>View full plan</summary> ... </details>\``,
        `Show the tasks manifest table and brief summaries — full task details are in the task files.`,
        `End with: "Any changes before implementation?"`,
      ].join("\n");
    } else {
      // ── New command ──
      const agentSpec = resolve(cwd, `.software-teams/framework/agents/software-teams-planner.md`);

      // Include conversation history as context even for new commands,
      // so the agent is aware of any prior work on this issue
      const historyBlock = conversationHistory
        ? `\n${fenceUserInput("conversation-history", conversationHistory)}\n\nThe above is prior conversation on this issue for context.\n`
        : "";

      switch (intent.command) {
        case "plan":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            `You are software-teams-planner. Read ${agentSpec} for your full specification.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Create an implementation plan for:`,
            fenceUserInput("user-request", intent.description),
            ticketContext
              ? `\nUse the ClickUp ticket above as the primary requirements source.`
              : ``,
            ``,
            `## Scope Rules`,
            `IMPORTANT: Only plan what was explicitly requested. Do NOT add extras like testing, linting, formatting, CI, or tooling unless the user asked for them.`,
            `If something is ambiguous, ask — do not guess.`,
            `NEVER use time estimates (minutes, hours, etc). Use t-shirt sizes: S, M, L. This is mandatory.`,
            ``,
            `## Learnings`,
            `Before planning, read .software-teams/persistence/learnings.md and .software-teams/framework/learnings/ if they exist. Apply any team preferences found.`,
            ``,
            `## Plan File Format`,
            `CRITICAL: You MUST write plan files in SPLIT format as defined in your spec (Step 7a):`,
            `1. Write the index file: \`.software-teams/plans/{phase}-{plan}-{slug}.plan.md\` — contains frontmatter with \`task_files:\` list and a manifest table only (NO inline task details)`,
            `2. Write each task as a separate file: \`.software-teams/plans/{phase}-{plan}-{slug}.T{n}.md\` — one file per task with full implementation details`,
            `This split format is MANDATORY — it reduces token usage by letting agents load only their assigned task.`,
            ``,
            `## Response Format`,
            `After writing the split plan files, respond with EXACTLY this structure (no deviations, no meta-commentary):`,
            ``,
            `1-2 sentence summary of the approach.`,
            ``,
            `<details>`,
            `<summary>View full plan</summary>`,
            ``,
            `## {Plan Name}`,
            ``,
            `**Overall size:** {S|M|L}`,
            ``,
            `### Tasks`,
            ``,
            `| Task | Name | Size | Type | Wave |`,
            `|------|------|------|------|------|`,
            `| T1 | {name} | {S|M|L} | auto | 1 |`,
            ``,
            `(For each task, show a brief 1-2 line summary — full details are in the task files)`,
            ``,
            `### Verification`,
            `- [ ] {check 1}`,
            `- [ ] {check 2}`,
            ``,
            `</details>`,
            ``,
            `**Optional additions** — not included in this plan:`,
            `1. {suggestion}`,
            `2. {suggestion}`,
            ``,
            `Any changes before implementation?`,
          ].join("\n");
          break;

        case "implement":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            `Read ${resolve(cwd, ".software-teams/framework/components/meta/ComplexityRouter.md")} for complexity routing rules.`,
            `Read ${resolve(cwd, ".software-teams/framework/components/meta/AgentTeamsOrchestration.md")} for Agent Teams orchestration (if needed).`,
            ``,
            ...contextLines,
            ``,
            ...buildLearningsBlock(techStack),
            historyBlock,
            `## Task`,
            `Execute the current implementation plan. Read state.yaml for the active plan path.`,
            `Follow the implement-plan orchestration.`,
            ``,
            `## Auto-Commit`,
            `You are already on the correct PR branch. Do NOT create new branches or switch branches.`,
            `After implementing all changes:`,
            `1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`,
            `2. \`git commit -m "feat: ..."\` with a conventional commit message`,
            `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
            `Present a summary of what was implemented and committed.`,
          ].join("\n");
          break;

        case "quick":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            ``,
            ...buildLearningsBlock(techStack),
            historyBlock,
            `## Task`,
            `Make this quick change:`,
            fenceUserInput("user-request", intent.description),
            `Keep changes minimal and focused.`,
            ``,
            `## Auto-Commit`,
            `You are already on the correct PR branch. Do NOT create new branches or switch branches.`,
            `After making changes:`,
            `1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`,
            `2. \`git commit -m "..."\` with a conventional commit message`,
            `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
            `Present what you changed.`,
          ].join("\n");
          break;

        case "review":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Review the current PR. Post line-level review comments via gh api.`,
          ].join("\n");
          break;

        case "feedback":
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            `Address PR feedback comments. Read comments via gh api, make changes, reply to each.`,
          ].join("\n");
          break;

        default:
          prompt = [
            `Read ${baseProtocol} for the base agent protocol.`,
            ``,
            ...contextLines,
            historyBlock,
            `## Task`,
            intent.description,
          ].join("\n");
      }
    }

    // Apply dry-run mode if requested
    if (intent.dryRun) {
      prompt = applyDryRunMode(prompt);
    }

    // Execute
    let success = true;
    let fullResponse = "";
    try {
      const { exitCode, response } = await spawnClaude(prompt, {
        cwd,
        permissionMode: "acceptEdits",
        allowedTools: intent.dryRun ? ["Read", "Glob", "Grep", "Bash"] : undefined,
      });
      fullResponse = response;
      if (exitCode !== 0) {
        success = false;
        consola.error(`Claude exited with code ${exitCode}`);
      }

      // If full flow, run implement after plan
      if (intent.fullFlow && success) {
        consola.info("Full flow: now running implement...");
        const implementPrompt = [
          `Read ${baseProtocol} for the base agent protocol.`,
          `Read ${resolve(cwd, ".software-teams/framework/components/meta/ComplexityRouter.md")} for complexity routing rules.`,
          `Read ${resolve(cwd, ".software-teams/framework/components/meta/AgentTeamsOrchestration.md")} for Agent Teams orchestration (if needed).`,
          ``,
          ...contextLines,
          ``,
          ...buildLearningsBlock(techStack),
          ``,
          `## Task`,
          `Execute the most recently created implementation plan in .software-teams/plans/.`,
          `Follow the implement-plan orchestration.`,
          ``,
          `## Auto-Commit`,
          `You are already on the correct PR branch. Do NOT create new branches or switch branches.`,
          `After implementing all changes:`,
          `1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`,
          `2. \`git commit -m "feat: ..."\` with a conventional commit message`,
          `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
          `Present a summary of what was implemented and committed.`,
        ].join("\n");

        const implResult = await spawnClaude(implementPrompt, {
          cwd,
          permissionMode: "acceptEdits",
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
    if (saved.learningsSaved) consola.info("Learnings persisted to storage");
    if (saved.codebaseIndexSaved) consola.info("Codebase index persisted to storage");

    // Update placeholder comment with final response (or post new if placeholder failed)
    if (repo && issueNumber) {
      const actionLabel = intent.isFeedback ? "feedback" : intent.command;
      let commentBody: string;

      if (success && fullResponse) {
        commentBody = formatJdiComment(actionLabel, fullResponse);
      } else if (!success) {
        commentBody = formatErrorComment(actionLabel, "Check workflow logs for details.");
      } else {
        commentBody = formatJdiComment(actionLabel, `Executed \`${actionLabel}\` successfully.`);
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
