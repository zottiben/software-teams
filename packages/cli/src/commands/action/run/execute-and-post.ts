import { consola } from "consola";
import { savePersistedState } from "../../../utils/storage-lifecycle";
import { buildRulesBlock } from "../../../utils/prompt-builder";
import { runQualityGates } from "../../../utils/verify";
import { formatVerificationResults } from "../../../utils/github";
import {
  postGitHubComment,
  updateGitHubComment,
  reactToComment,
  formatSoftwareTeamsComment,
  formatErrorComment,
  findPrTemplate,
} from "../../../utils/github";
import { gitBranch } from "../../../utils/git";
import { findActiveOrchestration } from "../../../utils/orchestration";
import { readPlanFiles, formatPlanFilesSection } from "../../../utils/plan-files-comment";
import { setLifecycleLabel, findPrForBranch } from "../../../utils/labels";
import { buildRouterPrompt, type ActionContext } from "../router-prompts";
import { createStorage } from "../../../storage";
import { spawnRouter, spawnImplement } from "./spawner";
import { prepareIssueFeatureBranch } from "./feature-branch";
import type { ParsedIntent } from "./types";

async function buildCommentBody(opts: {
  success: boolean;
  fullResponse: string;
  actionLabel: string;
  intent: ParsedIntent;
  isPostImplementation: boolean;
  cwd: string;
  issueNumber: number;
}): Promise<string> {
  const { success, fullResponse, actionLabel, intent, isPostImplementation, cwd, issueNumber } = opts;
  if (!success) return formatErrorComment(actionLabel, "Check workflow logs for details.");
  if (!fullResponse) return formatSoftwareTeamsComment(actionLabel, `Executed \`${actionLabel}\` successfully.`);

  const isPlanFlow = (intent.command === "plan" || intent.isFeedback) && !isPostImplementation;
  const planFilesBlock = isPlanFlow
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
  return formatSoftwareTeamsComment(actionLabel, fullResponse + planFilesBlock);
}

export async function executeAndPost(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  commentId: number | null;
  placeholderCommentId: number | null;
  intent: ParsedIntent;
  prompt: string;
  storage: ReturnType<typeof createStorage> extends Promise<infer S> ? S : never;
  projectLines: string[];
  workspaceLines: string[];
  conversationHistory: string;
  isPostImplementation: boolean;
}): Promise<void> {
  const {
    cwd, repo, issueNumber, commentId, placeholderCommentId,
    intent, prompt, storage, projectLines, workspaceLines,
    conversationHistory, isPostImplementation,
  } = opts;

  const { success, fullResponse } = await (async () => {
    try {
      const { exitCode, response } = await spawnRouter({ prompt, cwd, dryRun: intent.dryRun });
      const initialSuccess = exitCode === 0;
      if (!initialSuccess) consola.error(`Claude exited with code ${exitCode}`);

      if (!intent.fullFlow || !initialSuccess) return { success: initialSuccess, fullResponse: response };

      consola.info("Full flow: now running implement...");
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
      const techStack = projectLines[2]?.replace("- Tech stack: ", "") ?? "";
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

      const implResult = await spawnImplement({ prompt: implementPrompt, cwd });
      const implResponse = implResult.response ? response + "\n\n---\n\n" + implResult.response : response;

      if (intent.dryRun) return { success: implResult.exitCode === 0, fullResponse: implResponse };

      const verification = await runQualityGates(cwd);
      const verifiedResponse = verification.gates.length > 0
        ? implResponse + "\n\n" + formatVerificationResults(verification)
        : implResponse;
      return { success: implResult.exitCode === 0, fullResponse: verifiedResponse };
    } catch (err) {
      consola.error("Execution failed:", err);
      return { success: false, fullResponse: "" };
    }
  })();

  const saved = await savePersistedState(cwd, storage);
  if (saved.rulesSaved) consola.info("Rules persisted to storage");
  if (saved.codebaseIndexSaved) consola.info("Codebase index persisted to storage");

  if (repo && issueNumber) {
    const actionLabel = intent.isFeedback ? "feedback" : intent.command;
    const commentBody = await buildCommentBody({ success, fullResponse, actionLabel, intent, isPostImplementation, cwd, issueNumber });

    if (placeholderCommentId) {
      await updateGitHubComment(repo, placeholderCommentId, commentBody).catch((err) => {
        consola.error("Failed to update result comment:", err);
      });
    } else {
      await postGitHubComment(repo, issueNumber, commentBody).catch((err) => {
        consola.error("Failed to post result comment:", err);
      });
    }

    if (success) {
      const isPostImplFeedback = intent.isFeedback && isPostImplementation;
      const isCodePushFlow =
        intent.command === "implement" ||
        intent.command === "quick" ||
        intent.fullFlow ||
        isPostImplFeedback;
      const isPlanProducingFlow =
        intent.command === "plan" && !isPostImplementation;

      if (isCodePushFlow) {
        await setLifecycleLabel(repo, issueNumber, "ready-to-review").catch(() => {});
        const branch = await gitBranch().catch(() => "");
        const prNumber = branch ? await findPrForBranch(repo, branch) : null;
        if (prNumber && prNumber !== issueNumber) {
          await setLifecycleLabel(repo, prNumber, "ready-to-review").catch(() => {});
        }
      } else if (isPlanProducingFlow) {
        await setLifecycleLabel(repo, issueNumber, "plan-ready").catch(() => {});
      }
    }
  }

    if (repo && commentId) {
    const reaction = success ? "+1" : "-1";
    await reactToComment(repo, commentId, reaction).catch(() => {});
  }

  if (!success) process.exit(1);
}
