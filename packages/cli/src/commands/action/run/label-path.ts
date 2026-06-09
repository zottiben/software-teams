import { consola } from "consola";
import { detectProjectType } from "../../../utils/detect-project";
import { readAdapter } from "../../../utils/adapter";
import { createStorage } from "../../../storage";
import { loadPersistedState, savePersistedState } from "../../../utils/storage-lifecycle";
import { sanitizeUserInput } from "../../../utils/sanitize";
import {
  postGitHubComment,
  updateGitHubComment,
  formatSoftwareTeamsComment,
  formatErrorComment,
  fetchIssueTitleAndBody,
  ASSISTANT_COMMENT_MARKER,
} from "../../../utils/github";
import { findActiveOrchestration } from "../../../utils/orchestration";
import { readPlanFiles, formatPlanFilesSection } from "../../../utils/plan-files-comment";
import { setLifecycleLabel } from "../../../utils/labels";
import { spawnRouter } from "./spawner";
import { loadExternalContexts } from "./external-contexts";
import { buildLabelPathPrompt } from "./prompt-assembly";
import type { ParsedIntent } from "./types";

/**
 * Handle the label-triggered (issue_labeled) path end-to-end.
 * Fetches the issue, builds intent + context, runs discovery gate,
 * spawns Claude, posts the result comment, and sets the lifecycle label.
 * Returns after posting — caller must `return` immediately after this.
 */
export async function runLabelTriggeredPath(opts: {
  cwd: string;
  repo: string;
  issueNumber: number;
}): Promise<void> {
  const { cwd, repo, issueNumber } = opts;

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

  // Scan the synthesised issue text (title + body) for external
  // context URLs (ClickUp tickets, Datadog Error Tracking issues)
  // and append their sanitised context blocks. The synthetic
  // description IS `${title}\n\n${body}` for this path.
  const externalBlocks = await loadExternalContexts(intent.description);
  for (const block of externalBlocks) {
    workspaceLines.push("", block);
  }

  // Build plan prompt (runs discovery gate — returns null when gate aborted)
  const prompt = await buildLabelPathPrompt({
    cwd, repo, issueNumber, intent, projectLines, workspaceLines,
    placeholderCommentId, storage,
  });
  if (prompt === null) {
    // Researcher surfaced pre-plan questions — comment posted, no
    // plan written. Wait for the user to reply; the next run picks
    // up their answers via the conversation history bridge.
    return;
  }

  let success = true;
  let fullResponse = "";
  try {
    const { exitCode, response } = await spawnRouter({ prompt, cwd });
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
      // Embed the just-written plan files into the comment so the
      // user can actually read them before approving. The runner
      // owns this section (not the planner's text) — see
      // `utils/plan-files-comment.ts` for the rationale.
      let planFilesBlock = "";
      try {
        const writtenOrch = await findActiveOrchestration(cwd, issueNumber);
        if (writtenOrch) {
          planFilesBlock = formatPlanFilesSection(readPlanFiles(cwd, writtenOrch));
        }
      } catch (err) {
        consola.warn("Failed to build plan-files comment block:", err);
      }
      commentBody = formatSoftwareTeamsComment(actionLabel, fullResponse + planFilesBlock);
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
    // Lifecycle label: plan produced and waiting on user (approval or implement).
    if (success) {
      await setLifecycleLabel(repo, issueNumber, "plan-ready").catch(() => {});
    }
  }

  if (!success) process.exit(1);
}
