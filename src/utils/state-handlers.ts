import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { readState, writeState, type JDIState } from "./state";

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the parsed object, or null if no frontmatter found.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return parseYaml(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Transition state to "plan ready" after a plan has been created.
 * Reads the plan file to extract phase, plan number, and task_files from frontmatter.
 */
export async function transitionToPlanReady(
  cwd: string,
  planPath: string,
  planName: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const state = await readState(cwd) ?? {};

  // Guard: refuse to roll the state machine back to "planning" while an
  // implementation run is in flight, unless the caller explicitly forces it.
  if (state.position?.status === "executing" && opts.force !== true) {
    throw new Error(
      `Cannot transition to plan-ready: state machine is currently executing plan ${state.position.plan}. Pass --force to override.`,
    );
  }

  // Read plan file and extract frontmatter
  const fullPlanPath = planPath.startsWith("/") ? planPath : join(cwd, planPath);
  let phase: number | undefined;
  let planNumber: string | undefined;
  let taskFiles: string[] = [];

  if (existsSync(fullPlanPath)) {
    const content = await Bun.file(fullPlanPath).text();
    const fm = parseFrontmatter(content);
    if (fm) {
      if (fm.phase != null) phase = Number(fm.phase);
      if (fm.plan != null) planNumber = String(fm.plan);
      if (Array.isArray(fm.task_files)) taskFiles = fm.task_files as string[];
    }
  }

  state.position = {
    ...state.position,
    ...(phase != null ? { phase } : {}),
    plan: planNumber ?? planPath,
    plan_name: planName,
    status: "planning",
  } as any;
  state.current_plan = {
    ...state.current_plan,
    path: planPath,
    tasks: taskFiles,
    completed_tasks: [],
    current_task_index: taskFiles.length > 0 ? 0 : null,
  } as any;
  state.progress = {
    ...state.progress,
    tasks_total: taskFiles.length,
    tasks_completed: 0,
  } as any;
  state.review = {
    ...state.review,
    status: "in_review",
    scope: "plan",
  } as any;
  await updateSessionActivity(cwd, state);
}

/**
 * Transition state to "approved" after plan approval.
 */
export async function transitionToApproved(cwd: string): Promise<void> {
  const state = await readState(cwd) ?? {};
  state.position = {
    ...state.position,
    status: "approved",
  } as any;
  state.review = {
    ...state.review,
    status: "approved",
    approved_at: new Date().toISOString(),
  } as any;
  await updateSessionActivity(cwd, state);
}

/**
 * Transition state to "executing" before implementation starts.
 */
export async function transitionToExecuting(
  cwd: string,
  taskId?: string,
  taskName?: string,
): Promise<void> {
  const state = await readState(cwd) ?? {};
  state.position = {
    ...state.position,
    status: "executing",
    task: taskId ?? state.position?.task ?? null,
    task_name: taskName ?? state.position?.task_name ?? null,
  } as any;
  await updateSessionActivity(cwd, state);
}

/**
 * Transition state to "complete" after implementation finishes.
 * Reads roadmap.yaml to advance to the next plan in the current phase if one exists.
 */
export async function transitionToComplete(cwd: string): Promise<void> {
  const state = await readState(cwd) ?? {};
  state.position = {
    ...state.position,
    status: "complete",
  } as any;

  // Increment plans_completed
  if (!state.progress) {
    state.progress = { phases_total: 0, phases_completed: 0, plans_total: 0, plans_completed: 0, tasks_total: 0, tasks_completed: 0 };
  }
  state.progress.plans_completed = (state.progress.plans_completed ?? 0) + 1;

  // Try to advance to next plan in the current phase via roadmap.yaml
  // (legacy uppercase ROADMAP.yaml supported as a fallback for projects that
  // haven't migrated to the Phase B lowercase target).
  try {
    const lcPath = join(cwd, ".software-teams", "roadmap.yaml");
    const ucPath = join(cwd, ".software-teams", "ROADMAP.yaml");
    const roadmapPath = existsSync(lcPath) ? lcPath : ucPath;
    if (existsSync(roadmapPath)) {
      const content = await Bun.file(roadmapPath).text();
      const roadmap = parseYaml(content) as Record<string, unknown>;

      const phases = roadmap?.phases as Record<string, unknown> | undefined;
      if (phases && typeof phases === "object") {
        const currentPhase = state.position?.phase;
        if (currentPhase != null) {
          const phase = phases[String(currentPhase)] as Record<string, unknown> | undefined;
          const plans = phase?.plans as Record<string, unknown> | undefined;
          if (plans && typeof plans === "object") {
            const sortedKeys = Object.keys(plans).sort();
            const currentPlan = state.position?.plan;
            const currentIndex = sortedKeys.indexOf(String(currentPlan));
            if (currentIndex !== -1 && currentIndex + 1 < sortedKeys.length) {
              const nextKey = sortedKeys[currentIndex + 1];
              const nextPlan = plans[nextKey] as Record<string, unknown> | undefined;
              state.position = {
                ...state.position,
                plan: nextKey,
                plan_name: (nextPlan?.name as string) ?? nextKey,
                status: "idle",
                task: null,
                task_name: null,
              } as any;
            }
          }
        }
      }
    }
  } catch {
    // Gracefully skip advancement on any error (malformed ROADMAP, read failure, etc.)
  }

  await updateSessionActivity(cwd, state);
}

/**
 * Advance to the next task in the current plan.
 */
export async function advanceTask(cwd: string, completedTaskId: string): Promise<void> {
  const state = await readState(cwd) ?? {};
  if (state.current_plan) {
    const completed = state.current_plan.completed_tasks ?? [];
    if (!completed.includes(completedTaskId)) {
      completed.push(completedTaskId);
    }
    state.current_plan.completed_tasks = completed;

    const tasks = state.current_plan.tasks ?? [];
    const nextIndex = completed.length;
    state.current_plan.current_task_index = nextIndex < tasks.length ? nextIndex : null;
  }
  if (!state.progress) {
    state.progress = { phases_total: 0, phases_completed: 0, plans_total: 0, plans_completed: 0, tasks_total: 0, tasks_completed: 0 };
  }
  state.progress.tasks_completed = (state.progress.tasks_completed ?? 0) + 1;
  await updateSessionActivity(cwd, state);
}

/**
 * Update session.last_activity and write state.
 */
async function updateSessionActivity(cwd: string, state: JDIState): Promise<void> {
  state.session = {
    ...state.session,
    last_activity: new Date().toISOString(),
  } as any;
  await writeState(cwd, state);
}
