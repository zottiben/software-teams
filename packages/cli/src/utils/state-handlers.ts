import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { readState, writeState, type SoftwareTeamsState } from "./state";

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

  const fullPlanPath = planPath.startsWith("/") ? planPath : join(cwd, planPath);
  const planMeta = await (async () => {
    if (!existsSync(fullPlanPath)) return { phase: undefined as number | undefined, planNumber: undefined as string | undefined, taskFiles: [] as string[] };
    const content = await Bun.file(fullPlanPath).text();
    const fm = parseFrontmatter(content);
    if (!fm) return { phase: undefined as number | undefined, planNumber: undefined as string | undefined, taskFiles: [] as string[] };
    return {
      phase: fm.phase != null ? Number(fm.phase) : undefined,
      planNumber: fm.plan != null ? String(fm.plan) : undefined,
      taskFiles: Array.isArray(fm.task_files) ? (fm.task_files as string[]) : [],
    };
  })();
  const { phase, planNumber, taskFiles } = planMeta;

  state.position = {
    ...state.position,
    ...(phase != null ? { phase } : {}),
    plan: planNumber ?? planPath,
    plan_name: planName,
    status: "planning",
  } as SoftwareTeamsState["position"];
  state.current_plan = {
    ...state.current_plan,
    path: planPath,
    tasks: taskFiles,
    completed_tasks: [],
    current_task_index: taskFiles.length > 0 ? 0 : null,
  } as SoftwareTeamsState["current_plan"];
  state.progress = {
    ...state.progress,
    tasks_total: taskFiles.length,
    tasks_completed: 0,
  } as SoftwareTeamsState["progress"];
  state.review = {
    ...state.review,
    status: "in_review" as const,
    scope: "plan" as const,
  } as SoftwareTeamsState["review"];
  await updateSessionActivity(cwd, state);
}

export interface PlanReviewVerdict {
  oneShotReady: boolean;
  score?: number | null;
  status?: "pending" | "gaps_found" | "satisfied";
  planName?: string | null;
  revision?: number | null;
}

/**
 * Record a plan-review quality verdict and mark the user as on the
 * review-plan approval path. The approval gate in transitionToApproved
 * reads quality_gate.one_shot_ready.
 */
export async function recordPlanReview(cwd: string, verdict: PlanReviewVerdict): Promise<void> {
  const state = (await readState(cwd)) ?? {};
  const now = new Date().toISOString();
  state.review = {
    ...state.review,
    path: "review-plan" as const,
    quality_gate: {
      status: verdict.status ?? (verdict.oneShotReady ? "satisfied" : "gaps_found"),
      one_shot_ready: verdict.oneShotReady,
      score: verdict.score ?? null,
      plan_name: verdict.planName ?? state.position?.plan_name ?? null,
      revision: verdict.revision ?? state.review?.revision ?? null,
      last_reviewed_at: now,
    },
  } as SoftwareTeamsState["review"];
  await updateSessionActivity(cwd, state);
}

/**
 * Transition state to "approved" after plan approval.
 *
 * Quality gate: if the user entered the review-plan path
 * (review.path === "review-plan"), approval is refused until the quality
 * agent has marked the plan one-shot ready — unless `force` is passed.
 */
export async function transitionToApproved(
  cwd: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const state = (await readState(cwd)) ?? {};
  if (
    opts.force !== true &&
    state.review?.path === "review-plan" &&
    state.review?.quality_gate?.one_shot_ready !== true
  ) {
    throw new Error(
      "Cannot approve: a plan review is in progress and the quality gate is not satisfied yet. " +
        "Run /st:review-plan to finish the review, or pass --force to override.",
    );
  }
  state.position = {
    ...state.position,
    status: "approved",
  } as SoftwareTeamsState["position"];
  state.review = {
    ...state.review,
    status: "approved" as const,
    approved_at: new Date().toISOString(),
  } as SoftwareTeamsState["review"];
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
  } as SoftwareTeamsState["position"];
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
  } as SoftwareTeamsState["position"];

  // Increment plans_completed
  if (!state.progress) {
    state.progress = { phases_total: 0, phases_completed: 0, plans_total: 0, plans_completed: 0, tasks_total: 0, tasks_completed: 0 };
  }
  state.progress.plans_completed = (state.progress.plans_completed ?? 0) + 1;

  // Try to advance to next plan in the current phase via roadmap.yaml.
  try {
    const roadmapPath = join(cwd, ".software-teams", "roadmap.yaml");
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
              } as SoftwareTeamsState["position"];
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
async function updateSessionActivity(cwd: string, state: SoftwareTeamsState): Promise<void> {
  state.session = {
    ...state.session,
    last_activity: new Date().toISOString(),
  } as SoftwareTeamsState["session"];
  await writeState(cwd, state);
}
