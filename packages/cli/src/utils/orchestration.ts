/**
 * Orchestration-file parsing for the action runner.
 *
 * After phase B, the action runner reads `<slug>.orchestration.md` to
 * discover the per-agent slices a three-tier plan declared, then instructs
 * the parent Claude to spawn one Task per slice (in parallel). This mirrors
 * how the local `/st:implement-plan` skill orchestrates — see
 * `commands/implement-plan.md` §3T.8 and `agents/...` AgentTeamsOrchestration.
 *
 * The shape we need from a plan:
 *   - the path to the orchestration index
 *   - the path to the SPEC (for shared context)
 *   - the list of per-agent slices, each with its pinned `agent:` field
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** Ingestion boundary: fields parsed from YAML frontmatter; types are uninferable until narrowed downstream. */
interface OrchestrationFrontmatter {
  task_files?: unknown;
  spec_link?: unknown;
  available_agents?: unknown;
  primary_agent?: unknown;
  /**
   * Issue number this plan addresses — written by the planner per the
   * "Plan Provenance" block in `router-prompts.ts`. The action runner
   * uses this to find the right orchestration for a given issue,
   * avoiding state.yaml staleness or cross-issue contamination.
   */
  issue?: unknown;
  repo?: unknown;
  [key: string]: unknown;
}

/** Ingestion boundary: per-task slice frontmatter; fields are uninferable until narrowed. */
interface SliceFrontmatter {
  agent?: unknown;
  tier?: unknown;
  spec_link?: unknown;
  orchestration_link?: unknown;
  [key: string]: unknown;
}

export interface OrchestrationSlice {
  /** workspace-relative path to the per-agent `{slug}.T{n}.md` file */
  slicePath: string;
  /** subagent_type to spawn — read from the slice's frontmatter `agent:` field */
  agentType: string;
}

export interface ActiveOrchestration {
  /** workspace-relative path to the `{slug}.orchestration.md` file */
  orchestrationPath: string;
  /** workspace-relative path to the SPEC, if discoverable */
  specPath?: string;
  /** per-agent slices declared in the orchestration's `task_files:` frontmatter */
  slices: OrchestrationSlice[];
}

function parseFrontmatter<T>(content: string): T | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  try {
    return (parseYaml(match[1]) ?? {}) as T;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Locate the orchestration index for a given issue.
 *
 * Resolution strategy:
 *   1. If `issueNumber` is supplied, scan `.software-teams/plans/` for any
 *      `*.orchestration.md` whose frontmatter `issue:` matches. This is the
 *      authoritative path — it can't be fooled by stale state.yaml entries
 *      or by plan files that linger from earlier issues in the same repo.
 *   2. If `issueNumber` is undefined OR no match by frontmatter, fall back
 *      to the most recently modified `*.orchestration.md`. This covers
 *      legacy plans created before frontmatter tagging shipped (0.5.9).
 *   3. Returns null when no orchestration exists at all — caller falls
 *      back gracefully (the action runner refuses to implement in that case).
 *
 * Why this changed (post-0.5.22): the previous version preferred
 * state.yaml's `current_plan.path`, but state.yaml is never updated by the
 * action runner after the planner returns, so it stayed pointing at older
 * plans from earlier issues. That caused the wrong plan to be picked up
 * during implement runs — exactly the regression seen on issue #46.
 */
async function locateOrchestrationFile(
  cwd: string,
  issueNumber?: number,
): Promise<string | null> {
  const plansDir = join(cwd, ".software-teams", "plans");
  if (!existsSync(plansDir)) return null;

  const allOrchestrations = readdirSync(plansDir)
    .filter((name) => name.endsWith(".orchestration.md"))
    .map((name) => join(plansDir, name));
  if (allOrchestrations.length === 0) return null;

  if (issueNumber && issueNumber > 0) {
    for (const path of allOrchestrations) {
      const content = readFileSync(path, "utf-8");
      const fm = parseFrontmatter<OrchestrationFrontmatter>(content);
      const tagged = typeof fm?.issue === "number" ? fm.issue : Number(fm?.issue);
      if (Number.isFinite(tagged) && tagged === issueNumber) {
        return path;
      }
    }
    // No frontmatter-tagged match for this issue — do NOT fall back to
    // most-recent. That would silently pick up a different issue's plan,
    // which is exactly the regression we're fixing.
    return null;
  }

  // No issue number provided — return the most recently modified file.
  allOrchestrations.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return allOrchestrations[0];
}

/**
 * Walk the orchestration's `task_files:` and read each per-agent slice's
 * `agent:` frontmatter field. Returns null when:
 *   - the workspace has no orchestration file
 *   - the orchestration's frontmatter is missing or has an empty `task_files:`
 *   - none of the listed slice files exist on disk
 *   - none of the existing slices declare an `agent:` field
 *
 * In all these cases, the caller falls back to today's legacy single-agent
 * implementation flow rather than producing a half-formed multi-spawn brief.
 */
export async function findActiveOrchestration(
  cwd: string,
  issueNumber?: number,
): Promise<ActiveOrchestration | null> {
  const orchestrationAbs = await locateOrchestrationFile(cwd, issueNumber);
  if (!orchestrationAbs) return null;

  const orchestrationRel = orchestrationAbs.startsWith(cwd + "/")
    ? orchestrationAbs.slice(cwd.length + 1)
    : orchestrationAbs;

  const contentResult = (() => {
    try { return { ok: true as const, value: readFileSync(orchestrationAbs, "utf-8") }; }
    catch { return { ok: false as const }; }
  })();
  if (!contentResult.ok) return null;
  const content = contentResult.value;

  const fm = parseFrontmatter<OrchestrationFrontmatter>(content);
  if (!fm) return null;

  const taskFiles = asStringArray(fm.task_files);
  if (taskFiles.length === 0) return null;

  const plansDir = dirname(orchestrationAbs);
  const slices: OrchestrationSlice[] = [];

  for (const entry of taskFiles) {
    // `task_files:` entries are typically just the slice filename
    // (`{slug}.T1.md`) but we tolerate workspace-relative paths too.
    const sliceAbs = entry.includes("/")
      ? (entry.startsWith("/") ? entry : join(cwd, entry))
      : join(plansDir, basename(entry));
    if (!existsSync(sliceAbs)) continue;

    const sliceReadResult = (() => {
      try { return { ok: true as const, value: readFileSync(sliceAbs, "utf-8") }; }
      catch { return { ok: false as const }; }
    })();
    if (!sliceReadResult.ok) continue;
    const sliceContent = sliceReadResult.value;
    const sliceFm = parseFrontmatter<SliceFrontmatter>(sliceContent);
    const agentType = asString(sliceFm?.agent);
    if (!agentType) continue;

    const sliceRel = sliceAbs.startsWith(cwd + "/")
      ? sliceAbs.slice(cwd.length + 1)
      : sliceAbs;
    slices.push({ slicePath: sliceRel, agentType });
  }

  if (slices.length === 0) return null;

  const toRel = (abs: string) => abs.startsWith(cwd + "/") ? abs.slice(cwd.length + 1) : abs;
  const specLink = asString(fm.spec_link);
  const specPathFromLink = specLink
    ? (() => { const abs = specLink.startsWith("/") ? specLink : join(cwd, specLink); return existsSync(abs) ? toRel(abs) : undefined; })()
    : undefined;
  const specPathDerived = (() => {
    const derived = orchestrationAbs.replace(/\.orchestration\.md$/, ".spec.md");
    return existsSync(derived) ? toRel(derived) : undefined;
  })();
  const specPath = specPathFromLink ?? specPathDerived;

  return { orchestrationPath: orchestrationRel, specPath, slices };
}

/**
 * Convert an internal `software-teams-<role>` subagent type into the
 * user-facing role label used in attribution headers. Falls back to
 * Title-casing the suffix for unknown agents.
 *
 *   software-teams-frontend       → "The Frontend Agent"
 *   software-teams-qa-tester      → "The QA Agent"          (mapped)
 *   software-teams-unknown-x      → "The Unknown X Agent"   (fallback)
 *   general-purpose               → "The General Purpose Agent"
 */
const ROLE_LABEL_MAP: Record<string, string> = {
  "software-teams-planner": "The Planning Agent",
  "software-teams-programmer": "The Implementation Agent",
  "software-teams-frontend": "The Frontend Agent",
  "software-teams-backend": "The Backend Agent",
  "software-teams-quality": "The Quality Agent",
  "software-teams-qa-tester": "The QA Agent",
  "software-teams-devops": "The DevOps Agent",
  "software-teams-security": "The Security Agent",
  "software-teams-architect": "The Architect Agent",
  "software-teams-debugger": "The Debugger Agent",
  "software-teams-verifier": "The Verifier Agent",
  "software-teams-perf-analyst": "The Performance Agent",
  "software-teams-ux-designer": "The UX Agent",
  "software-teams-researcher": "The Research Agent",
  "software-teams-pr-feedback": "The Feedback Agent",
  "software-teams-pr-generator": "The PR Agent",
  "software-teams-committer": "The Committer Agent",
  "software-teams-product-lead": "The Product Lead Agent",
  "software-teams-producer": "The Producer Agent",
  "software-teams-head-engineering": "The Engineering Lead Agent",
  "software-teams-phase-researcher": "The Research Agent",
  "software-teams-codebase-mapper": "The Codebase Mapper Agent",
  "software-teams-feedback-learner": "The Feedback Agent",
  "software-teams-plan-checker": "The Plan Checker Agent",
};

export function agentTypeToRoleLabel(agentType: string): string {
  if (ROLE_LABEL_MAP[agentType]) return ROLE_LABEL_MAP[agentType];
  const suffix = agentType.replace(/^software-teams-/, "");
  const titled = suffix
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
  return `The ${titled} Agent`;
}
