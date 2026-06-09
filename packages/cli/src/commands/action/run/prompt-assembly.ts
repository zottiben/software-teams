import { consola } from "consola";
import { buildRulesBlock } from "../../../utils/prompt-builder";
import {
  postGitHubComment,
  updateGitHubComment,
  formatErrorComment,
} from "../../../utils/github";
import { findActiveOrchestration } from "../../../utils/orchestration";
import { findPrTemplate } from "../../../utils/github";
import { buildRouterPrompt, type ActionContext } from "../router-prompts";
import { createStorage } from "../../../storage";
import { runDiscoveryAndGate } from "./discovery-gate";
import { prepareIssueFeatureBranch } from "./feature-branch";
import type { ParsedIntent } from "./types";

/**
 * Build the router prompt for a comment-triggered run. Handles:
 *  - post-impl iteration feedback
 *  - plan refinement feedback (with/without existing plan)
 *  - new commands: plan / implement / quick / review / feedback
 *
 * Returns the assembled prompt string. Callers that hit an error path
 * (e.g. no plan found for implement) should call process.exit(1) after
 * updating the placeholder comment — this function does NOT exit.
 *
 * Returns null when the gate aborted (questions posted) — caller must
 * return immediately without spawning Claude.
 */
export async function buildCommentPrompt(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  intent: ParsedIntent;
  projectLines: string[];
  workspaceLines: string[];
  conversationHistory: string;
  placeholderCommentId: number | null;
  storage: ReturnType<typeof createStorage> extends Promise<infer S> ? S : never;
  isFollowUp: boolean;
  isPostImplementation: boolean;
}): Promise<string | null> {
  const {
    cwd, repo, issueNumber, intent, projectLines, workspaceLines,
    conversationHistory, placeholderCommentId, storage, isFollowUp, isPostImplementation,
  } = opts;

  // Build prompt based on whether this is feedback or a new command.
  // All prompt assembly is delegated to `buildRouterPrompt` — the parent
  // Claude is a thin router that spawns the right Software Teams
  // specialist via the `Task` tool. No component bodies or planner-spec
  // text is inlined here; subagents auto-load their `.claude/agents/*.md`
  // spec natively.
  const techStack = projectLines[2]?.replace("- Tech stack: ", "") ?? "";

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
    return buildRouterPrompt(routerCtx);
  }

  if (intent.isFeedback) {
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
      return buildRouterPrompt(routerCtx);
    }

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
      isFollowUp,
    });
    if (gateResult.aborted) return null;
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
    return buildRouterPrompt(routerCtx);
  }

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
        isFollowUp,
      });
      if (gateResult.aborted) return null;
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
      return buildRouterPrompt(routerCtx);
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
      return buildRouterPrompt(routerCtx);
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
      return buildRouterPrompt(routerCtx);
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
      return buildRouterPrompt(routerCtx);
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
      return buildRouterPrompt(routerCtx);
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

/**
 * Build the router prompt for the label-triggered (issue_labeled) path.
 * Runs the discovery gate and returns either the assembled prompt string
 * or null when the gate aborted (questions posted — caller must return).
 */
export async function buildLabelPathPrompt(opts: {
  cwd: string;
  repo: string;
  issueNumber: number;
  intent: ParsedIntent;
  projectLines: string[];
  workspaceLines: string[];
  placeholderCommentId: number | null;
  storage: ReturnType<typeof createStorage> extends Promise<infer S> ? S : never;
}): Promise<string | null> {
  const { cwd, repo, issueNumber, intent, projectLines, workspaceLines, placeholderCommentId, storage } = opts;
  const techStack = projectLines[2]?.replace("- Tech stack: ", "") ?? "";

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
    return null;
  }
  const routerCtx: ActionContext = {
    flow: { kind: "plan" },
    userRequest: intent.description,
    repo: repo,
    issueNumber,
    conversationHistory: "",
    projectLines,
    workspaceLines,
    rulesBlock: buildRulesBlock(techStack),
    prePlanDiscovery: gateResult.findings || undefined,
  };
  return buildRouterPrompt(routerCtx);
}
