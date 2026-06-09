import { defineCommand } from "citty";
import { consola } from "consola";
import { detectProjectType } from "../../../utils/detect-project";
import { readAdapter } from "../../../utils/adapter";
import { createStorage } from "../../../storage";
import { loadPersistedState } from "../../../utils/storage-lifecycle";
import { sanitizeUserInput } from "../../../utils/sanitize";
import { checkAuthorization } from "../../../utils/auth";
import {
  postGitHubComment,
  reactToComment,
  formatSoftwareTeamsComment,
  fetchCommentThread,
  buildConversationContext,
  fetchIssueTitleAndBody,
  isPullRequest,
  fetchPrLinkedIssues,
  ASSISTANT_COMMENT_MARKER,
} from "../../../utils/github";
import { ALLOWED_EVENT_TYPES } from "./constants";
import { loadExternalContexts } from "./external-contexts";
import { parseComment } from "./intent-parser";
import { runLabelTriggeredPath } from "./label-path";
import { runApprovalHandler, runPingHandler } from "./approval-ping";
import { buildCommentPrompt } from "./prompt-assembly";
import { executeAndPost } from "./execute-and-post";

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
      await runLabelTriggeredPath({ cwd, repo: repo!, issueNumber });
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
      await runApprovalHandler({ cwd, repo, issueNumber, commentId, placeholderCommentId, intent });
      return;
    }

    // Ping: quick framework status check — no Claude invocation needed
    if (intent.command === "ping") {
      await runPingHandler({ cwd, repo, issueNumber, commentId, placeholderCommentId });
      return;
    }

    // Load persisted state via storage
    const storage = await createStorage(cwd);
    const { rulesPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

    // Load external-context blocks (ClickUp tickets, Datadog Error
    // Tracking issues). URLs are searched in BOTH the trigger comment
    // AND the issue/PR title + body — users often paste the Datadog
    // link in the issue body itself, with the trigger comment being
    // just "Hey Software Teams fix this". Each context is sanitised
    // through the PII scrubber before it lands in the prompt.
    let externalSearchCorpus = intent.description ?? "";
    if (repo && issueNumber) {
      const issueRecord = await fetchIssueTitleAndBody(repo, issueNumber).catch(() => null);
      if (issueRecord) {
        externalSearchCorpus += `\n${issueRecord.title}\n${issueRecord.body}`;
      }
    }
    const externalBlocks = await loadExternalContexts(externalSearchCorpus);

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
    for (const block of externalBlocks) {
      workspaceLines.push(``, block);
    }

    const prompt = await buildCommentPrompt({
      cwd,
      repo,
      issueNumber,
      intent,
      projectLines,
      workspaceLines,
      conversationHistory,
      placeholderCommentId,
      storage,
      isFollowUp,
      isPostImplementation,
    });

    // null means the discovery gate aborted (questions posted) — don't spawn Claude
    if (prompt === null) return;

    await executeAndPost({
      cwd,
      repo,
      issueNumber,
      commentId,
      placeholderCommentId,
      intent,
      prompt,
      storage,
      projectLines,
      workspaceLines,
      conversationHistory,
      isPostImplementation,
    });
  },
});
