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
import { readState } from "./state";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface OrchestrationFrontmatter {
  task_files?: unknown;
  spec_link?: unknown;
  available_agents?: unknown;
  primary_agent?: unknown;
  [key: string]: unknown;
}

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
 * Locate the orchestration index for the currently active plan.
 *
 * Resolution order:
 *   1. `state.yaml`'s `current_plan.path` — if set AND it ends with
 *      `.orchestration.md` AND exists, use it.
 *   2. If `current_plan.path` ends in `.plan.md`, derive the orchestration
 *      filename by replacing `.plan.md` with `.orchestration.md` (some
 *      single-tier plans get upgraded to three-tier later).
 *   3. Otherwise, fall back to the most recently modified
 *      `.software-teams/plans/*.orchestration.md` file.
 *
 * Returns null when the workspace has no orchestration index — caller falls
 * back to the legacy single-agent implementation flow.
 */
async function locateOrchestrationFile(cwd: string): Promise<string | null> {
  const plansDir = join(cwd, ".software-teams", "plans");

  const state = await readState(cwd).catch(() => null);
  const statePath = state?.current_plan?.path;
  if (typeof statePath === "string" && statePath.length > 0) {
    const absolute = statePath.startsWith("/") ? statePath : join(cwd, statePath);
    if (absolute.endsWith(".orchestration.md") && existsSync(absolute)) {
      return absolute;
    }
    if (absolute.endsWith(".plan.md")) {
      const candidate = absolute.replace(/\.plan\.md$/, ".orchestration.md");
      if (existsSync(candidate)) return candidate;
    }
  }

  if (!existsSync(plansDir)) return null;
  const candidates = readdirSync(plansDir)
    .filter((name) => name.endsWith(".orchestration.md"))
    .map((name) => join(plansDir, name));
  if (candidates.length === 0) return null;
  // Most recently modified wins — if the user shipped an old plan and then
  // labelled a new issue, the new plan's orchestration is the more recent one.
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
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
export async function findActiveOrchestration(cwd: string): Promise<ActiveOrchestration | null> {
  const orchestrationAbs = await locateOrchestrationFile(cwd);
  if (!orchestrationAbs) return null;

  const orchestrationRel = orchestrationAbs.startsWith(cwd + "/")
    ? orchestrationAbs.slice(cwd.length + 1)
    : orchestrationAbs;

  let content: string;
  try {
    content = readFileSync(orchestrationAbs, "utf-8");
  } catch {
    return null;
  }

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

    let sliceContent: string;
    try {
      sliceContent = readFileSync(sliceAbs, "utf-8");
    } catch {
      continue;
    }
    const sliceFm = parseFrontmatter<SliceFrontmatter>(sliceContent);
    const agentType = asString(sliceFm?.agent);
    if (!agentType) continue;

    const sliceRel = sliceAbs.startsWith(cwd + "/")
      ? sliceAbs.slice(cwd.length + 1)
      : sliceAbs;
    slices.push({ slicePath: sliceRel, agentType });
  }

  if (slices.length === 0) return null;

  // Resolve SPEC path — prefer the orchestration's explicit `spec_link:`,
  // otherwise derive from the slug.
  let specPath: string | undefined;
  const specLink = asString(fm.spec_link);
  if (specLink) {
    const specAbs = specLink.startsWith("/") ? specLink : join(cwd, specLink);
    if (existsSync(specAbs)) {
      specPath = specAbs.startsWith(cwd + "/") ? specAbs.slice(cwd.length + 1) : specAbs;
    }
  }
  if (!specPath) {
    const derived = orchestrationAbs.replace(/\.orchestration\.md$/, ".spec.md");
    if (existsSync(derived)) {
      specPath = derived.startsWith(cwd + "/") ? derived.slice(cwd.length + 1) : derived;
    }
  }

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
