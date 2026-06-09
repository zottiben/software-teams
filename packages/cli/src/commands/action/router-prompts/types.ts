import { type ActiveOrchestration } from "../../../utils/orchestration";

export type ActionFlow =
  | { kind: "plan"; isRefinement?: boolean; isApproval?: boolean }
  | { kind: "implement" }
  | { kind: "quick" }
  | { kind: "review" }
  | { kind: "feedback" }
  | { kind: "post-impl-iteration" }
  | { kind: "pre-plan-discovery" };

export interface FeatureBranchContext {
  branchName: string;
  defaultBranch: string;
}

export interface PrTemplateContext {
  path: string;   // workspace-relative
  body: string;   // raw template content
}

export interface ActionContext {
  flow: ActionFlow;
  userRequest: string;            // already sanitized
  repo: string;                   // "owner/repo"
  issueNumber: number;            // issue or PR number
  conversationHistory: string;    // already sanitized; may be empty
  projectLines: string[];         // ["## Project Context", "- Type: ...", ...]
  workspaceLines: string[];       // ["## Workspace", "- Working directory: ...", ...]
  rulesBlock: string[];           // pre-built rules block lines
  featureBranch?: FeatureBranchContext;  // present when issue-context impl/quick cut a branch
  prTemplate?: PrTemplateContext;        // present when the repo has a PR template
  // Present for implement flow when the workspace has a three-tier plan
  // with ≥2 per-agent slices. Triggers the multi-spawn orchestrator brief
  // shape (parent emits N parallel Task calls, collects results, commits,
  // pushes, writes per-agent attribution). Single-slice plans and missing
  // orchestrations fall back to the legacy single-agent brief.
  orchestration?: ActiveOrchestration;
  // Pre-plan researcher's findings from a prior spawn. When set on a plan
  // flow, the brief prepends a `## Discovery findings` block so the
  // planner makes codebase-grounded decisions and only surfaces genuinely
  // unanswered questions in its `### Open questions` slot. Empty string
  // or undefined means the researcher hasn't run (or returned nothing
  // useful) — planner falls back to working from issue text alone.
  prePlanDiscovery?: string;
  isDryRun?: boolean;
}

export interface SubagentSpawn {
  type: string;                   // subagent_type passed to Task
  description: string;            // short description for the Task tool's `description` field
}

export function pickSubagent(flow: ActionFlow): SubagentSpawn {
  switch (flow.kind) {
    case "plan":
      return {
        type: "software-teams-planner",
        description: flow.isRefinement
          ? "Refine existing plan with user feedback"
          : flow.isApproval
            ? "Finalise approved plan"
            : "Create implementation plan",
      };
    case "implement":
      return { type: "software-teams-programmer", description: "Implement the approved plan" };
    case "quick":
      return { type: "software-teams-programmer", description: "Make a small focused change" };
    case "review":
      return { type: "software-teams-quality", description: "Review the current PR" };
    case "feedback":
      return { type: "software-teams-pr-feedback", description: "Address PR review comments" };
    case "post-impl-iteration":
      return { type: "software-teams-pr-feedback", description: "Iterate on already-shipped code" };
    case "pre-plan-discovery":
      return { type: "software-teams-researcher", description: "Pre-plan codebase discovery" };
  }
}
