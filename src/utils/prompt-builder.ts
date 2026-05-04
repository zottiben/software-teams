import { resolve, dirname, basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
  rulesPath: string | null;
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
  const { rulesPath, codebaseIndexPath } = await loadPersistedState(cwd, storage);

  return {
    cwd,
    projectType,
    techStack,
    qualityGates,
    rulesPath,
    codebaseIndexPath,
    adapter,
  };
}

/**
 * Build the project-identity block. Byte-stable for a given project — the
 * same lines are emitted on every invocation (placeholders fill in for
 * absent fields) so this block can sit at the cacheable prefix of every
 * prompt without churn from per-call state.
 *
 * The runtime-varying bits (cwd, ticket context) live in
 * `buildWorkspaceContext` and are emitted strictly after this block.
 */
export function buildProjectContext(ctx: PromptContext): string[] {
  return [
    `## Project Context`,
    `- Type: ${ctx.projectType}`,
    `- Tech stack: ${ctx.techStack}`,
    `- Quality gates: ${ctx.qualityGates}`,
    `- Rules: ${ctx.rulesPath ?? "(none)"}`,
    `- Codebase index: ${ctx.codebaseIndexPath ?? "(none)"}`,
  ];
}

/**
 * Build the runtime workspace block — cwd, ticket context, anything
 * specific to *this* invocation rather than to *this project*. Emitted
 * after `buildProjectContext` so the project-identity prefix above stays
 * byte-stable across worktrees and across invocations.
 */
export function buildWorkspaceContext(ctx: PromptContext): string[] {
  const lines = [
    `## Workspace`,
    `- Working directory: ${ctx.cwd}`,
  ];
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
 * Build tech-stack-aware rules instructions. Always includes general.md;
 * domain files added based on stack.
 */
export function buildRulesBlock(techStack: string): string[] {
  const lower = techStack.toLowerCase();
  const base = ".software-teams/rules";
  const files = [`${base}/general.md`];

  if (/php|laravel/.test(lower)) files.push(`${base}/backend.md`);
  if (/react|typescript|\.ts|frontend|vite/.test(lower)) files.push(`${base}/frontend.md`);
  if (/test|vitest|pest/.test(lower)) files.push(`${base}/testing.md`);
  if (/docker|ci|deploy/.test(lower)) files.push(`${base}/devops.md`);

  return [
    `## Rules`,
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

/**
 * Resolve the canonical source of an agent spec, preferring the synced
 * Claude-native copy under `.claude/agents/` (where the @ST: tags are
 * already expanded), then the self-host source under `<cwd>/agents/`,
 * then the npm-installed package's `<packageRoot>/agents/` directory.
 */
function resolveAgentSpecPath(cwd: string, agentName: string): string | null {
  const claudeNative = join(cwd, ".claude", "agents", `${agentName}.md`);
  if (existsSync(claudeNative)) return claudeNative;
  const selfHost = join(cwd, "agents", `${agentName}.md`);
  if (existsSync(selfHost)) return selfHost;
  // Package-root fallback (mirrors copy-framework.ts and convert-agents.ts).
  const oneUp = join(import.meta.dir, "..");
  const twoUp = join(import.meta.dir, "..", "..");
  const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;
  const pkgPath = join(packageRoot, "agents", `${agentName}.md`);
  if (existsSync(pkgPath)) return pkgPath;
  return null;
}

/**
 * Strip YAML frontmatter and the AUTO-GENERATED banner from a spec file's
 * raw text, returning just the prompt-relevant body. Frontmatter holds
 * Claude Code metadata (name, description, model, tools) that the spec
 * body doesn't need to repeat — and we control those declaratively
 * elsewhere — so inlining only the body keeps the prompt minimal.
 */
function stripSpecFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  let body = fmMatch ? content.slice(fmMatch[0].length) : content;
  // Drop the AUTO-GENERATED banner if convert-agents added one.
  body = body.replace(/^\s*<!--\s*AUTO-GENERATED[\s\S]*?-->\s*\n?/, "");
  // Drop the "canonical frontmatter" comment that lives at the top of the
  // canonical (un-synced) source files.
  body = body.replace(/^\s*<!--\s*canonical frontmatter[\s\S]*?-->\s*\n?/, "");
  return body.trim();
}

// Module-load cache. Spec body is read once per process — subsequent calls
// return the cached string. The cache lives for the process lifetime; this
// matches the lifecycle of the CLI command (one process per invocation) and
// of the long-running action runner (one process across many spawns).
const _agentSpecCache = new Map<string, string | null>();

/**
 * Read an agent spec body from disk and return it ready for inlining into
 * a prompt. Returns `null` when the spec cannot be located so callers can
 * fall back to a path reference + `Read`-tool instruction.
 *
 * Why inline instead of reference-by-path:
 * - The spawned `claude -p` doesn't natively load `.claude/agents/<name>.md`
 *   the way an interactive Claude Code session does, so an unreferenced spec
 *   is invisible. The agent then has to issue a `Read` tool call and pay
 *   the round-trip cost on every spawn.
 * - Reading the spec at module load time inlines its bytes into the prompt
 *   prefix, which puts them in Claude Code's API-cache-eligible region.
 *   Across multiple spawns within the cache TTL, repeated invocations
 *   share the prefix and avoid re-paying for the same content.
 */
export function readAgentSpecBody(cwd: string, agentName: string): string | null {
  const cacheKey = `${cwd}:${agentName}`;
  if (_agentSpecCache.has(cacheKey)) return _agentSpecCache.get(cacheKey) ?? null;

  const path = resolveAgentSpecPath(cwd, agentName);
  if (path == null) {
    _agentSpecCache.set(cacheKey, null);
    return null;
  }
  try {
    const content = readFileSync(path, "utf-8");
    const body = stripSpecFrontmatter(content);
    _agentSpecCache.set(cacheKey, body);
    return body;
  } catch {
    _agentSpecCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Render an "## Agent Spec" block for inlining into a prompt. When the
 * spec body can be read, it is inlined verbatim; otherwise a fallback
 * pointer to the spec file is emitted instead, preserving the previous
 * behaviour for environments where the spec isn't available on disk.
 */
function inlineAgentSpec(cwd: string, agentName: string, fallbackPath: string): string[] {
  const body = readAgentSpecBody(cwd, agentName);
  if (body == null) {
    return [
      `## Agent Spec — ${agentName}`,
      `Spec file: ${fallbackPath}`,
      `(Read the spec file before proceeding — it could not be inlined into this prompt.)`,
    ];
  }
  return [
    `## Agent Spec — ${agentName}`,
    body,
  ];
}

/**
 * Reset the agent-spec cache — exposed for tests so each test can read a
 * fresh fixture without cross-test bleed.
 * @internal
 */
export function _resetAgentSpecCache(): void {
  _agentSpecCache.clear();
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
  // Plan-specific lines live in a tail block, not in the main body, so the
  // 9-step orchestration playbook above stays byte-identical across plans
  // (cache-friendly: one stable prefix shared by every implement-prompt
  // invocation in the project).
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

/**
 * Append dry-run instructions to any prompt.
 */
export function applyDryRunMode(prompt: string): string {
  return prompt + "\n\nDRY RUN MODE: List all files you would touch and summarize changes. Do NOT edit files, run commands, or commit.";
}
