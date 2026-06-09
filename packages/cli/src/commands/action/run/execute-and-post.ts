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

/**
 * Execute the router prompt via spawnClaude, handle the optional full-flow
 * implement step, save persisted state, post the result comment, advance
 * the lifecycle label, and react on the trigger comment.
 *
 * Calls process.exit(1) on failure (matching original behaviour).
 */
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

  // Dry-run mode is handled inside `buildRouterPrompt` (the brief carries
  // a DRY-RUN MODE block when `isDryRun: true`) so the SUBAGENT — which
  // actually does the work — sees the no-write directive. The parent
  // router only spawns Task + echoes the result, so a trailing dry-run
  // line on the parent prompt is moot.

  // Execute
  let success = true;
  let fullResponse = "";
  try {
    const { exitCode, response } = await spawnRouter({ prompt, cwd, dryRun: intent.dryRun });
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
      // Plan flows on this comment-triggered path also get the
      // `📂 Plan files` collapsible appended — same behaviour as the
      // label-triggered path. Both initial plan (intent.command ===
      // "plan") and plan refinement (intent.isFeedback === true on
      // a non-implemented issue) produce/refresh the plan files on
      // disk, so the user should see them inline. Implement / quick
      // / feedback flows don't write plan files, so we skip.
      let planFilesBlock = "";
      const isPlanFlow =
        (intent.command === "plan" || intent.isFeedback) && !isPostImplementation;
      if (isPlanFlow) {
        try {
          const writtenOrch = await findActiveOrchestration(cwd, issueNumber);
          if (writtenOrch) {
            planFilesBlock = formatPlanFilesSection(readPlanFiles(cwd, writtenOrch));
          }
        } catch (err) {
          consola.warn("Failed to build plan-files comment block:", err);
        }
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

    // Lifecycle label: advance the issue/PR's Software Teams state
    // label so the issue board reflects the current stage. Only acts
    // on successful runs — failed runs leave the prior label in
    // place.
    //
    // Two categories matter:
    //   - Code-pushing flows → ready-to-review on the PR (and
    //     originating issue, when different). Includes:
    //       * explicit implement / quick commands
    //       * fullFlow (plan + implement in one shot)
    //       * post-implementation iteration — when the user replies
    //         to a PR comment thread that already has implementation
    //         commits, the feedback flow pushes a new code commit
    //         rather than refining a plan. Regression on PR 6193:
    //         this was mislabeled as plan-ready because the parser
    //         returns command="plan" for any unspecified follow-up,
    //         even though the actual flow pushed code.
    //   - Plan-producing flows → plan-ready on the issue. Includes:
    //       * explicit plan command
    //       * plan refinement (isFeedback=true) on a non-implemented
    //         issue — that updates the plan in place.
    //     Crucially NOT when isPostImplementation is true — that
    //     branch pushes code, not a plan.
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
        // Always advance the originating issue's label — the
        // implementation work is done from Software Teams' side, and
        // the issue board should reflect that even if the user
        // hasn't yet clicked the [Open this PR] link. Pre-this-fix
        // we only labelled when findPrForBranch returned a PR
        // number, so issues whose implementation completed with
        // only the compare-URL link stayed on `plan-ready` forever
        // (observed on issue 6206).
        await setLifecycleLabel(repo, issueNumber, "ready-to-review").catch(() => {});

        // Also label the PR itself when one already exists (e.g.
        // for PR-context implements where the user commented on an
        // existing PR thread, or for follow-up post-impl runs).
        // When no PR exists yet, we can't label it — but a future
        // pull_request:opened trigger could pick that up.
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

  // React with result
  if (repo && commentId) {
    const reaction = success ? "+1" : "-1";
    await reactToComment(repo, commentId, reaction).catch(() => {});
  }

  if (!success) process.exit(1);
}
