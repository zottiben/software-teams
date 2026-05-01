import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import { findJdiRootOrNull } from "./find-root";

export interface JDIState {
  session?: { id: string | null; started_at: string; last_activity: string };
  project?: { name: string; root: string; initialised: boolean };
  position?: {
    phase: number;
    phase_name: string;
    plan: string;
    plan_name: string;
    task: string | null;
    task_name: string | null;
    status: string;
  };
  progress?: {
    phases_total: number;
    phases_completed: number;
    plans_total: number;
    plans_completed: number;
    tasks_total: number;
    tasks_completed: number;
  };
  current_plan?: {
    path: string | null;
    tasks: string[];
    completed_tasks: string[];
    current_task_index: number | null;
  };
  worktree?: {
    active: boolean;
    path: string | null;
    branch: string | null;
  };
  review?: {
    status: "draft" | "in_review" | "changes_requested" | "approved";
    revision: number;
    scope: "plan" | "implementation";
    feedback_history: Array<{
      revision: number;
      feedback: string;
      requested_at: string;
    }>;
    approved_at: string | null;
  };
  [key: string]: unknown;
}

/**
 * Resolve the Software Teams project root for a given cwd. Falls back to `cwd`
 * itself when no existing `.software-teams/config/state.yaml` can be located up
 * the directory tree (e.g. first-time writes before init).
 */
function resolveRoot(cwd: string): string {
  return findJdiRootOrNull(cwd) ?? cwd;
}

/**
 * Resolve the state.yaml path, preferring the Phase B target
 * (`.software-teams/state.yaml`) and falling back to the legacy location
 * (`.software-teams/config/state.yaml`) for projects that haven't migrated
 * yet. Used for both reads and writes.
 */
function resolveStatePath(root: string): string {
  const phaseB = join(root, ".software-teams", "state.yaml");
  if (existsSync(phaseB)) return phaseB;
  const legacy = join(root, ".software-teams", "config", "state.yaml");
  if (existsSync(legacy)) return legacy;
  // Neither exists — default to the new location for fresh writes.
  return phaseB;
}

/**
 * Read the Software Teams state file, walking up from the supplied `cwd`
 * (defaults to `process.cwd()`) to find the project root.
 *
 * Returns `null` when no state file can be located — either because no
 * Software Teams project exists on the path upward, or because the project root
 * was found but has no state.yaml yet.
 */
export async function readState(cwd: string = process.cwd()): Promise<JDIState | null> {
  const root = resolveRoot(cwd);
  const statePath = resolveStatePath(root);
  if (!existsSync(statePath)) return null;

  const content = await Bun.file(statePath).text();
  return parse(content) as JDIState;
}

/**
 * Write the Software Teams state file at the resolved project root. When no
 * project root can be found, falls back to writing at
 * `cwd/.software-teams/state.yaml` — this covers bootstrap scenarios such
 * as `software-teams init` before the project root exists.
 */
export async function writeState(cwd: string, state: JDIState): Promise<void>;
export async function writeState(state: JDIState): Promise<void>;
export async function writeState(
  cwdOrState: string | JDIState,
  maybeState?: JDIState,
): Promise<void> {
  const cwd = typeof cwdOrState === "string" ? cwdOrState : process.cwd();
  const state = (typeof cwdOrState === "string" ? maybeState : cwdOrState) as JDIState;
  const root = resolveRoot(cwd);
  const statePath = resolveStatePath(root);
  await Bun.write(statePath, stringify(state));
}
