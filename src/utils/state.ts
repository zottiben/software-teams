import { join } from "path";
import { existsSync } from "fs";
import { parse, stringify } from "yaml";

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

export async function readState(cwd: string): Promise<JDIState | null> {
  const statePath = join(cwd, ".jdi", "config", "state.yaml");
  if (!existsSync(statePath)) return null;

  const content = await Bun.file(statePath).text();
  return parse(content) as JDIState;
}

export async function writeState(cwd: string, state: JDIState): Promise<void> {
  const statePath = join(cwd, ".jdi", "config", "state.yaml");
  await Bun.write(statePath, stringify(state));
}
