import { resolve, dirname, basename } from "node:path";
import { existsSync } from "node:fs";
import { detectProjectType } from "./detect-project";
import { readAdapter, type AdapterConfig } from "./adapter";
import { loadPersistedState } from "./storage-lifecycle";
import { createStorage } from "../storage";
import { fenceUserInput } from "./sanitize";
import { getComponent } from "../components/resolve";

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
    `1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`,
    `2. \`git commit -m ${prefix}\` with a conventional commit message`,
    `3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`,
  ];
}

/**
 * Build tech-stack-aware rules instructions.
 *
 * Phase D folded the legacy `.software-teams/framework/learnings/*.md`
 * tree into `.software-teams/rules/`. Always includes general.md; domain
 * files added based on stack. Heading kept as "Learnings" — the rules
 * directory still carries the same content, just in a single location
 * alongside commits.md / deviations.md.
 */
export function buildLearningsBlock(techStack: string): string[] {
  const lower = techStack.toLowerCase();
  const base = ".software-teams/rules";
  const files = [`${base}/general.md`];

  if (/php|laravel/.test(lower)) files.push(`${base}/backend.md`);
  if (/react|typescript|\.ts|frontend|vite/.test(lower)) files.push(`${base}/frontend.md`);
  if (/test|vitest|pest/.test(lower)) files.push(`${base}/testing.md`);
  if (/docker|ci|deploy/.test(lower)) files.push(`${base}/devops.md`);

  return [
    `## Learnings`,
    `Read these rules files and follow any conventions found (rules override defaults):`,
    ...files.map((f) => `- ${f}`),
  ];
}

/**
 * Resolve runtime component bodies from the TS registry. Inlining beats
 * passing file paths because callers don't need to Read separate files —
 * and after the markdown component layer is retired, only the registry
 * has the bodies anyway.
 */
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
    `You are software-teams-planner. Read ${plannerSpecPath(ctx.cwd)} for your full specification.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    `## Task`,
    `Create an implementation plan for: ${description}`,
    ``,
    `Follow the planning workflow in your spec. Components are resolved at sync time via @ST: tags; at runtime, fetch additional components on demand via \`software-teams component get <Name>\`.`,
  ].join("\n");
}

/**
 * Resolve plan tier artefacts. If the supplied plan path is a `.orchestration.md`
 * (three-tier index), the orchestration path is itself; the legacy `.plan.md`
 * sibling is preferred when present, otherwise the orchestration path is the
 * canonical index. If the supplied path is a `.plan.md`, look for a sibling
 * `.orchestration.md` and report it when present (three-tier output produced
 * alongside the legacy index).
 *
 * Returns `tier: "three-tier"` when an orchestration file is found, otherwise
 * `tier: "single-tier"`. Both branches preserve the original plan path so the
 * markdown skill (`commands/implement-plan.md`) can run its own
 * **Plan Tier Detection** step deterministically.
 */
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
  const tierLine = tierInfo.tier === "three-tier"
    ? `Plan tier: three-tier (SPEC + ORCHESTRATION + per-agent slices). ORCHESTRATION: ${tierInfo.orchestrationPath}`
    : `Plan tier: single-tier (legacy index + per-task files).`;
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
    ...buildLearningsBlock(ctx.techStack),
    ``,
    `## Task`,
    `Execute implementation plan: ${resolve(ctx.cwd, planPath)}${overrideFlag ? `\nOverride: ${overrideFlag}` : ""}`,
    tierLine,
    ``,
    `Follow the implement-plan orchestration:`,
    `1. Read codebase context (.software-teams/codebase/SUMMARY.md if exists)`,
    `2. Apply Plan Tier Detection from the implement-plan skill: if ORCHESTRATION.md exists for this slug, run the Three-Tier Execution Loop; otherwise run the Single-Tier Execution Loop.`,
    `3. Read the canonical index (ORCHESTRATION.md for three-tier, PLAN.md for single-tier) and \`.software-teams/config/state.yaml\` — parse tasks, deps, waves, tech_stack`,
    `4. Apply ComplexityRouter: evaluate plan signals, choose single-agent or Agent Teams mode`,
    `5. Per-task spawn: in three-tier mode, pass each agent ONLY its per-agent slice (\`{slug}.T{n}.md\`) plus the SPEC sections cited in the slice's \`**Read first:**\` line — NOT the full SPEC, NOT all task files`,
    `6. Spawn agent(s) with cache-optimised load order (AgentBase first, then agent spec)`,
    `7. Collect and execute deferred ops (files, commits)`,
    `8. Run verification (tests, lint, typecheck)`,
    `9. Update state, present summary, enter review loop`,
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
  const { baseProtocol } = inlineComponents();
  return [
    `## Agent Base Protocol`,
    baseProtocol,
    ``,
    `You are software-teams-planner. Read ${plannerSpecPath(ctx.cwd)} for your full specification.`,
    ``,
    ...buildProjectContext(ctx),
    ``,
    fenceUserInput("conversation-history", conversationHistory),
    ``,
    `## Refinement Feedback`,
    fenceUserInput("user-request", feedback),
    ``,
    `## HARD CONSTRAINTS — PLAN REFINEMENT MODE`,
    `- ONLY modify files under \`.software-teams/plans/\` and \`.software-teams/config/\` — NEVER create, edit, or delete source code files`,
    `- NEVER run \`git commit\`, \`git push\`, or any git write operations`,
    `- Planning and implementation are SEPARATE gates — user must explicitly approve before implementation`,
    ``,
    `## Instructions`,
    `Read \`.software-teams/config/state.yaml\` and existing plan files. Apply feedback incrementally — do not restart from scratch.`,
    `If the feedback is a question, answer it conversationally. If it implies a plan change, update the plan.`,
    ``,
    `## Response Format (MANDATORY)`,
    `1-2 sentence summary of what changed. Then the updated plan summary in a collapsible block:`,
    `\`<details><summary>View full plan</summary> ... </details>\``,
    `Show the tasks manifest table and brief summaries. Maintain the SPLIT plan format: update the index file and individual task files (.T{n}.md) separately.`,
    `End with: "Any changes before implementation?"`,
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
    ...buildLearningsBlock(ctx.techStack),
    ``,
    fenceUserInput("conversation-history", conversationHistory),
    ``,
    `## Feedback on Implementation`,
    fenceUserInput("user-request", feedback),
    ``,
    `## Instructions`,
    `The user is iterating on code that Software Teams already implemented. Review the conversation above to understand what was built.`,
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
