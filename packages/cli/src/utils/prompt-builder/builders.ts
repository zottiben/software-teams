import { resolve, dirname, basename } from "node:path";
import { existsSync } from "node:fs";
import { fenceUserInput } from "../sanitize";
import { getComponent } from "../../components/resolve";
import { type PromptContext, buildProjectContext, buildWorkspaceContext, buildAutoCommitBlock, buildRulesBlock } from "./context";
import { inlineAgentSpec } from "./agent-spec";

function inlineComponents() {
  return {
    baseProtocol: getComponent("AgentBase"),
    complexityRouter: getComponent("ComplexityRouter"),
    orchestration: getComponent("AgentTeamsOrchestration"),
  };
}

function plannerSpecPath(cwd: string): string {
  return resolve(cwd, ".software-teams/framework/agents/software-teams-planner.md");
}

export function buildPlanPrompt(ctx: PromptContext, description: string): string {
  const { baseProtocol } = inlineComponents();
  return [
    `## Agent Base Protocol`,
    baseProtocol,
    ``,
    `You are software-teams-planner.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    ...inlineAgentSpec(ctx.cwd, "software-teams-planner", plannerSpecPath(ctx.cwd)),
    ``,
    ...buildWorkspaceContext(ctx),
    ``,
    `## Task`,
    `Create an implementation plan for: ${description}`,
    ``,
    `Follow the planning workflow in your spec above. Components are resolved at sync time via @ST: tags; at runtime, fetch additional components on demand via \`software-teams component get <Name>\`.`,
  ].join("\n");
}

export function detectPlanTier(cwd: string, planPath: string): {
  tier: "three-tier" | "single-tier";
  planPath: string;
  orchestrationPath: string | null;
} {
  const fullPlanPath = resolve(cwd, planPath);
  const dir = dirname(fullPlanPath);
  const file = basename(fullPlanPath);

  // Derive the slug — strip any of the recognised suffixes
  const slug = file
    .replace(/\.orchestration\.md$/i, "")
    .replace(/\.plan\.md$/i, "")
    .replace(/\.md$/i, "");

  const orchestrationCandidate = resolve(dir, `${slug}.orchestration.md`);
  const planCandidate = resolve(dir, `${slug}.plan.md`);

  const hasOrchestration = existsSync(orchestrationCandidate);
  const hasPlan = existsSync(planCandidate);

  if (hasOrchestration) {
    return {
      tier: "three-tier",
      planPath: hasPlan ? planCandidate : orchestrationCandidate,
      orchestrationPath: orchestrationCandidate,
    };
  }
  return {
    tier: "single-tier",
    planPath: fullPlanPath,
    orchestrationPath: null,
  };
}

export function buildImplementPrompt(ctx: PromptContext, planPath: string, overrideFlag?: string): string {
  const { baseProtocol, complexityRouter, orchestration } = inlineComponents();
  const tierInfo = detectPlanTier(ctx.cwd, planPath);
  const planLines = [
    `## Plan`,
    `- Plan path: ${resolve(ctx.cwd, planPath)}`,
    `- Plan tier: ${tierInfo.tier}`,
    `- Orchestration file: ${tierInfo.orchestrationPath ?? "(none — single-tier)"}`,
    `- Override: ${overrideFlag ?? "(none)"}`,
  ];
  return [
    `## Agent Base Protocol`,
    baseProtocol,
    ``,
    `## Complexity Routing`,
    complexityRouter,
    ``,
    `## Agent Teams Orchestration (if needed)`,
    orchestration,
    ``,
    ...buildProjectContext(ctx),
    ``,
    ...buildRulesBlock(ctx.techStack),
    ``,
    `## Task`,
    `Execute the current implementation plan.`,
    ``,
    `Follow the implement-plan orchestration:`,
    `1. Read codebase context (.software-teams/codebase/summary.md if exists)`,
    `2. Apply Plan Tier Detection from the implement-plan skill: if orchestration.md exists for this slug, run the Three-Tier Execution Loop; otherwise run the Single-Tier Execution Loop.`,
    `3. Read the canonical index (orchestration.md for three-tier, plan.md for single-tier) and \`.software-teams/state.yaml\` — parse tasks, deps, waves, tech_stack`,
    `4. Apply ComplexityRouter: evaluate plan signals, choose single-agent or Agent Teams mode`,
    `5. Per-task spawn: in three-tier mode, pass each agent ONLY its per-agent slice (\`{slug}.T{n}.md\`) plus the SPEC sections cited in the slice's \`**Read first:**\` line — NOT the full SPEC, NOT all task files`,
    `6. Spawn agent(s) with cache-optimised load order (AgentBase first, then agent spec)`,
    `7. Collect and execute deferred ops (files, commits)`,
    `8. Run verification (tests, lint, typecheck)`,
    `9. Update state, present summary, enter review loop`,
    ``,
    ...buildWorkspaceContext(ctx),
    ``,
    ...planLines,
  ].join("\n");
}

export function buildQuickPrompt(ctx: PromptContext, description: string): string {
  const qualityGatesFormatted = ctx.adapter?.quality_gates
    ? Object.entries(ctx.adapter.quality_gates)
        .map(([name, cmd]) => `- ${name}: \`${cmd}\``)
        .join("\n")
    : "- Run any existing test suite";

  return [
    `# Quick Change`,
    ``,
    `## Task`,
    description,
    ``,
    `## Context`,
    `- Working directory: ${ctx.cwd}`,
    `- Project type: ${ctx.projectType}`,
    ``,
    ...buildRulesBlock(ctx.techStack),
    ``,
    `## Instructions`,
    `1. Make the minimal change needed to accomplish the task`,
    `2. Keep changes focused — do not refactor surrounding code`,
    `3. Follow existing code patterns and conventions`,
    ``,
    `## Verification`,
    qualityGatesFormatted,
    ``,
    `## Commit`,
    `When done, create a conventional commit describing the change.`,
  ].join("\n");
}

export function buildReviewPrompt(ctx: PromptContext, prNum: string, meta: string, diff: string): string {
  return [
    `# Code Review: PR #${prNum}`,
    ``,
    meta,
    ``,
    ...buildRulesBlock(ctx.techStack),
    `Cross-reference rules against every change — flag violations and praise adherence.`,
    ``,
    `## Diff`,
    "```diff",
    diff,
    "```",
    ``,
    `## Review Checklist`,
    `Evaluate this PR against the following criteria:`,
    ``,
    `### Correctness`,
    `- Does the code do what it claims to do?`,
    `- Are there edge cases not handled?`,
    `- Are error paths handled properly?`,
    ``,
    `### Patterns & Conventions`,
    `- Does it follow the project's existing patterns?`,
    `- Are naming conventions consistent?`,
    `- Is the code well-organised?`,
    `- Does it follow the team's documented rules?`,
    ``,
    `### Security`,
    `- Any injection risks (SQL, XSS, command)?`,
    `- Are secrets or credentials exposed?`,
    `- Is user input validated at boundaries?`,
    ``,
    `### Performance`,
    `- Any N+1 queries or unnecessary loops?`,
    `- Are there missing indexes or inefficient operations?`,
    ``,
    `## Output Format`,
    `For each finding, provide:`,
    `- **File & line**: where the issue is`,
    `- **Severity**: critical / warning / suggestion / nitpick`,
    `- **Issue**: what's wrong`,
    `- **Suggestion**: how to fix it`,
  ].join("\n");
}

export function buildRefinementPrompt(ctx: PromptContext, feedback: string, conversationHistory: string): string {
  const { baseProtocol } = inlineComponents();
  return [
    `## Agent Base Protocol`,
    baseProtocol,
    ``,
    `You are software-teams-planner.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    ...inlineAgentSpec(ctx.cwd, "software-teams-planner", plannerSpecPath(ctx.cwd)),
    ``,
    `## HARD CONSTRAINTS — PLAN REFINEMENT MODE`,
    `- ONLY modify files under \`.software-teams/plans/\` and \`.software-teams/config/\` — NEVER create, edit, or delete source code files`,
    `- NEVER run \`git commit\`, \`git push\`, or any git write operations`,
    `- Planning and implementation are SEPARATE gates — user must explicitly approve before implementation`,
    ``,
    `## Instructions`,
    `Read \`.software-teams/state.yaml\` and existing plan files. Apply feedback incrementally — do not restart from scratch.`,
    `If the feedback is a question, answer it conversationally. If it implies a plan change, update the plan.`,
    ``,
    `## Response Format (MANDATORY)`,
    `1-2 sentence summary of what changed. Then the updated plan summary in a collapsible block:`,
    `\`<details><summary>View full plan</summary> ... </details>\``,
    `Show the tasks manifest table and brief summaries. Maintain the SPLIT plan format: update the index file and individual task files (.T{n}.md) separately.`,
    `End with: "Any changes before implementation?"`,
    ``,
    ...buildWorkspaceContext(ctx),
    ``,
    fenceUserInput("conversation-history", conversationHistory),
    ``,
    `## Refinement Feedback`,
    fenceUserInput("user-request", feedback),
  ].join("\n");
}

export function buildPostImplFeedbackPrompt(ctx: PromptContext, feedback: string, conversationHistory: string): string {
  const { baseProtocol } = inlineComponents();
  return [
    `## Agent Base Protocol`,
    baseProtocol,
    ``,
    ...buildProjectContext(ctx),
    ``,
    ...buildRulesBlock(ctx.techStack),
    ``,
    `## Instructions`,
    `The user is iterating on code that Software Teams already implemented. Review the conversation above to understand what was built.`,
    `Be conversational — if the user asks a question, answer it first. Then make changes if needed.`,
    `Apply changes incrementally to the existing code — do not rewrite from scratch.`,
    ``,
    ...buildAutoCommitBlock("fix"),
    `Present a summary of what you changed.`,
    ``,
    ...buildWorkspaceContext(ctx),
    ``,
    fenceUserInput("conversation-history", conversationHistory),
    ``,
    `## Feedback on Implementation`,
    fenceUserInput("user-request", feedback),
  ].join("\n");
}

export function applyDryRunMode(prompt: string): string {
  return prompt + "\n\nDRY RUN MODE: List all files you would touch and summarize changes. Do NOT edit files, run commands, or commit.";
}
