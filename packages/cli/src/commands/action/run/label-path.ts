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

  consola.info("Parsed intent: plan (label-triggered)");

  const placeholderCommentId: number | null = (repo && issueNumber)
    ? await postGitHubComment(repo, issueNumber, `${ASSISTANT_COMMENT_MARKER}\n<h3>🧠 Working on it...</h3>\n\n---\n\n_Reviewing your request..._`).catch(() => null)
    : null;

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

  const externalBlocks = await loadExternalContexts(intent.description);
  for (const block of externalBlocks) {
    workspaceLines.push("", block);
  }

  const prompt = await buildLabelPathPrompt({
    cwd, repo, issueNumber, intent, projectLines, workspaceLines,
    placeholderCommentId, storage,
  });
  if (prompt === null) return;

  const executionResult = await (async () => {
    try {
      const { exitCode, response } = await spawnRouter({ prompt, cwd });
      if (exitCode !== 0) {
        consola.error(`Claude exited with code ${exitCode}`);
        return { success: false, fullResponse: response };
      }
      return { success: true, fullResponse: response };
    } catch (err) {
      consola.error("Execution failed:", err);
      return { success: false, fullResponse: "" };
    }
  })();
  const { success, fullResponse } = executionResult;

  const saved = await savePersistedState(cwd, storage);
  if (saved.rulesSaved) consola.info("Rules persisted to storage");
  if (saved.codebaseIndexSaved) consola.info("Codebase index persisted to storage");

  if (repo && issueNumber) {
    const actionLabel = "plan";
    const planFilesBlock = (success && fullResponse)
      ? await (async () => {
          try {
            const writtenOrch = await findActiveOrchestration(cwd, issueNumber);
            return writtenOrch ? formatPlanFilesSection(readPlanFiles(cwd, writtenOrch)) : "";
          } catch (err) {
            consola.warn("Failed to build plan-files comment block:", err);
            return "";
          }
        })()
      : "";
    const commentBody = success && fullResponse
      ? formatSoftwareTeamsComment(actionLabel, fullResponse + planFilesBlock)
      : !success
      ? formatErrorComment(actionLabel, "Check workflow logs for details.")
      : formatSoftwareTeamsComment(actionLabel, `Executed \`${actionLabel}\` successfully.`);

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
