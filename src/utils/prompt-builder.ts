import { resolve } from "path";
import { detectProjectType } from "./detect-project";
import { readAdapter, type AdapterConfig } from "./adapter";
import { loadPersistedState } from "./storage-lifecycle";
import { createStorage } from "../storage";
import { fenceUserInput } from "./sanitize";

export interface PromptContext {
  cwd: string;
  projectType: string;
  techStack: string;
  qualityGates: string;
  learningsPath: string | null;
  codebaseIndexPath: string | null;
  ticketContext?: string;
  conversationHistory?: string;
  adapter: AdapterConfig | null;
}

/**
 * Gather all project context needed for prompt construction.
 */
export async function gatherPromptContext(cwd: string): Promise<PromptContext> {
  const projectType = await detectProjectType(cwd);
  const adapter = await readAdapter(cwd);
  const techStack = adapter?.tech_stack
    ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
    : projectType;
  const qualityGates = adapter?.quality_gates
    ? Object.entries(adapter.quality_gates).map(([name, cmd]) => `${name}: \`${cmd}\``).join(", ")
    : "default";

  const storage = await createStorage(cwd);
  const { learningsPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

  return {
    cwd,
    projectType,
    techStack,
    qualityGates,
    learningsPath,
    codebaseIndexPath,
    adapter,
  };
}

/**
 * Build the common project context lines shared by all prompts.
 */
export function buildProjectContext(ctx: PromptContext): string[] {
  const lines = [
    `## Project Context`,
    `- Type: ${ctx.projectType}`,
    `- Tech stack: ${ctx.techStack}`,
    `- Quality gates: ${ctx.qualityGates}`,
    `- Working directory: ${ctx.cwd}`,
  ];

  if (ctx.learningsPath) {
    lines.push(`- Learnings: ${ctx.learningsPath}`);
  }
  if (ctx.codebaseIndexPath) {
    lines.push(`- Codebase index: ${ctx.codebaseIndexPath}`);
  }
  if (ctx.ticketContext) {
    lines.push(``, ctx.ticketContext);
  }

  return lines;
}

/**
 * Build the auto-commit instruction block.
 */
export function buildAutoCommitBlock(commitType: "feat" | "fix" | "any"): string[] {
  const prefix = commitType === "any" ? `"..."` : `"${commitType}: ..."`;
  return [
    `## Auto-Commit`,
    `You are already on the correct PR branch. Do NOT create new branches or switch branches.`,
    `After making changes:`,
    `1. \`git add\` only source files you changed (NOT .jdi/ or .claude/)`,
    `2. \`git commit -m ${prefix}\` with a conventional commit message`,
    `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
  ];
}

/**
 * Build tech-stack-aware learnings instructions.
 * Maps tech stack keywords to the relevant learnings files.
 * Always includes general.md; domain files added based on stack.
 */
export function buildLearningsBlock(techStack: string): string[] {
  const lower = techStack.toLowerCase();
  const base = ".jdi/framework/learnings";
  const files = [`${base}/general.md`];

  if (/php|laravel/.test(lower)) files.push(`${base}/backend.md`);
  if (/react|typescript|\.ts|frontend|vite/.test(lower)) files.push(`${base}/frontend.md`);
  if (/test|vitest|pest/.test(lower)) files.push(`${base}/testing.md`);
  if (/docker|ci|deploy/.test(lower)) files.push(`${base}/devops.md`);

  return [
    `## Learnings`,
    `Read these learnings files and follow any conventions found (learnings override defaults):`,
    ...files.map((f) => `- ${f}`),
  ];
}

function agentPaths(cwd: string) {
  return {
    baseProtocol: resolve(cwd, ".jdi/framework/components/meta/AgentBase.md"),
    complexityRouter: resolve(cwd, ".jdi/framework/components/meta/ComplexityRouter.md"),
    orchestration: resolve(cwd, ".jdi/framework/components/meta/AgentTeamsOrchestration.md"),
    plannerSpec: resolve(cwd, ".jdi/framework/agents/jdi-planner.md"),
  };
}

export function buildPlanPrompt(ctx: PromptContext, description: string): string {
  const { baseProtocol, plannerSpec } = agentPaths(ctx.cwd);
  return [
    `Read ${baseProtocol} for the base agent protocol.`,
    `You are jdi-planner. Read ${plannerSpec} for your full specification.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    `## Task`,
    `Create an implementation plan for: ${description}`,
    ``,
    `Follow the planning workflow in your spec. If your spec has \`requires_components\` in frontmatter, batch-read all listed components before starting. Resolve remaining <JDI:*> components on-demand.`,
  ].join("\n");
}

export function buildImplementPrompt(ctx: PromptContext, planPath: string, overrideFlag?: string): string {
  const { baseProtocol, complexityRouter, orchestration } = agentPaths(ctx.cwd);
  return [
    `Read ${baseProtocol} for the base agent protocol.`,
    `Read ${complexityRouter} for complexity routing rules.`,
    `Read ${orchestration} for Agent Teams orchestration (if needed).`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    ...buildLearningsBlock(ctx.techStack),
    ``,
    `## Task`,
    `Execute implementation plan: ${resolve(ctx.cwd, planPath)}${overrideFlag ? `\nOverride: ${overrideFlag}` : ""}`,
    ``,
    `Follow the implement-plan orchestration:`,
    `1. Read codebase context (.jdi/codebase/SUMMARY.md if exists)`,
    `2. Read plan file and state.yaml — parse tasks, deps, waves, tech_stack`,
    `3. Apply ComplexityRouter: evaluate plan signals, choose single-agent or Agent Teams mode`,
    `4. Tech routing: detect primary agent from tech stack`,
    `5. Spawn agent(s) with cache-optimised load order (AgentBase first, then agent spec)`,
    `6. Collect and execute deferred ops (files, commits)`,
    `7. Run verification (tests, lint, typecheck)`,
    `8. Update state, present summary, enter review loop`,
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
    ...buildLearningsBlock(ctx.techStack),
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
    ...buildLearningsBlock(ctx.techStack),
    `Cross-reference learnings against every change — flag violations and praise adherence.`,
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
    `- Does it follow the team's documented learnings?`,
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
  const { baseProtocol, plannerSpec } = agentPaths(ctx.cwd);
  return [
    `Read ${baseProtocol} for the base agent protocol.`,
    `You are jdi-planner. Read ${plannerSpec} for your full specification.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    fenceUserInput("conversation-history", conversationHistory),
    ``,
    `## Refinement Feedback`,
    fenceUserInput("user-request", feedback),
    ``,
    `## HARD CONSTRAINTS — PLAN REFINEMENT MODE`,
    `- ONLY modify files under \`.jdi/plans/\` and \`.jdi/config/\` — NEVER create, edit, or delete source code files`,
    `- NEVER run \`git commit\`, \`git push\`, or any git write operations`,
    `- Planning and implementation are SEPARATE gates — user must explicitly approve before implementation`,
    ``,
    `## Instructions`,
    `Read state.yaml and existing plan files. Apply feedback incrementally — do not restart from scratch.`,
    `If the feedback is a question, answer it conversationally. If it implies a plan change, update the plan.`,
    ``,
    `## Response Format (MANDATORY)`,
    `1-2 sentence summary of what changed. Then the full updated plan in a collapsible block:`,
    `\`<details><summary>View full plan</summary> ... </details>\``,
    `Use the same plan structure as the initial plan (tasks table, per-task details, verification).`,
    `End with: "Any changes before implementation?"`,
  ].join("\n");
}

export function buildPostImplFeedbackPrompt(ctx: PromptContext, feedback: string, conversationHistory: string): string {
  const { baseProtocol } = agentPaths(ctx.cwd);
  return [
    `Read ${baseProtocol} for the base agent protocol.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    ...buildLearningsBlock(ctx.techStack),
    ``,
    fenceUserInput("conversation-history", conversationHistory),
    ``,
    `## Feedback on Implementation`,
    fenceUserInput("user-request", feedback),
    ``,
    `## Instructions`,
    `The user is iterating on code that Jedi already implemented. Review the conversation above to understand what was built.`,
    `Be conversational — if the user asks a question, answer it first. Then make changes if needed.`,
    `Apply changes incrementally to the existing code — do not rewrite from scratch.`,
    ``,
    ...buildAutoCommitBlock("fix"),
    `Present a summary of what you changed.`,
  ].join("\n");
}

/**
 * Append dry-run instructions to any prompt.
 */
export function applyDryRunMode(prompt: string): string {
  return prompt + "\n\nDRY RUN MODE: List all files you would touch and summarize changes. Do NOT edit files, run commands, or commit.";
}
