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

async function fetchConversationContext(
  repo: string | undefined,
  issueNumber: number,
  commentId: number | null,
): Promise<{ conversationHistory: string; isFollowUp: boolean; isPostImplementation: boolean }> {
  if (!repo || !issueNumber) {
    return { conversationHistory: "", isFollowUp: false, isPostImplementation: false };
  }

  const baseThread = await fetchCommentThread(repo, issueNumber);
  const isPr = await isPullRequest(repo, issueNumber);
  const thread = isPr
    ? await (async () => {
        const linkedIssues = await fetchPrLinkedIssues(repo, issueNumber);
        const linkedThreads = await Promise.all(
          linkedIssues.map(async (issueN) => {
            const linked = await fetchCommentThread(repo, issueN);
            if (linked.length > 0) {
              consola.info(`Bridged ${linked.length} comment(s) from linked issue #${issueN}`);
            }
            return linked;
          }),
        );
        return [...linkedThreads.flat(), ...baseThread];
      })()
    : baseThread;

  const context = buildConversationContext(thread, commentId ?? 0);
  if (context.isFollowUp) {
    consola.info(
      `Continuing conversation (${context.previousRuns} previous assistant run(s))${context.isPostImplementation ? " [post-implementation]" : ""}`,
    );
  }
  return {
    conversationHistory: sanitizeUserInput(context.history, 50_000),
    isFollowUp: context.isFollowUp,
    isPostImplementation: context.isPostImplementation,
  };
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

    if (args["event-type"] !== undefined && !ALLOWED_EVENT_TYPES.has(args["event-type"])) {
      consola.error(
        `Unsupported event-type: "${args["event-type"]}". Allowed values: ${[...ALLOWED_EVENT_TYPES].join(", ")}`,
      );
      process.exit(1);
    }

    if (commentAuthor && (allowedUsers || process.env.SOFTWARE_TEAMS_AUTH_ENABLED)) {
      const authResult = await checkAuthorization(repo ?? "", commentAuthor, allowedUsers || undefined);
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

    if (args["event-type"] === "issue_labeled") {
      if (!repo) {
        consola.error("issue_labeled event requires a repo (--repo or GITHUB_REPOSITORY)");
        process.exit(1);
      }
      await runLabelTriggeredPath({ cwd, repo, issueNumber });
      return;
    }

    const { conversationHistory, isFollowUp, isPostImplementation } =
      await fetchConversationContext(repo, issueNumber, commentId);

    const intent = parseComment(args.comment, isFollowUp);
    if (!intent) {
      consola.error("Could not parse trigger phrase (e.g. 'Hey Software Teams ...') from comment");
      process.exit(1);
    }

    intent.description = sanitizeUserInput(intent.description, 10_000);

    consola.info(
      `Parsed intent: ${intent.isApproval ? "approval (finalise plan)" : intent.isFeedback ? "refinement feedback" : intent.command}${intent.fullFlow ? " (full flow)" : ""}`,
    );

    if (repo && commentId) {
      await reactToComment(repo, commentId, "eyes").catch(() => {});
    }

    const placeholderCommentId: number | null = (repo && issueNumber)
      ? await postGitHubComment(repo, issueNumber, `${ASSISTANT_COMMENT_MARKER}\n<h3>🧠 Working on it...</h3>\n\n---\n\n_Reviewing your request..._`).catch(() => null)
      : null;

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

    const storage = await createStorage(cwd);
    const { rulesPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

    const issueRecord = (repo && issueNumber)
      ? await fetchIssueTitleAndBody(repo, issueNumber).catch(() => null)
      : null;
    const externalSearchCorpus = issueRecord
      ? `${intent.description ?? ""}\n${issueRecord.title}\n${issueRecord.body}`
      : (intent.description ?? "");
    const externalBlocks = await loadExternalContexts(externalSearchCorpus);

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
