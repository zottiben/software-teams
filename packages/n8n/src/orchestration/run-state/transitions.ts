import type { ChangeRef, NodeEnvelope } from "@websitelabs/software-teams";
import type {
  OrchestrationTask,
  RunState,
  RunSummary,
  RunTaskState,
  RunTaskStatus,
} from "./shapes";

/** Create a fresh run state with every task pending. */
export function initRunState(
  correlationId: string,
  tasks: OrchestrationTask[],
): RunState {
  return {
    correlationId,
    createdAt: new Date().toISOString(),
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      ...(t.name ? { name: t.name } : {}),
      agent: t.agent,
      wave: t.wave,
      dependsOn: [...t.dependsOn],
      status: "pending" as RunTaskStatus,
    })),
  };
}

/** Immutably set a task's status (and optional detail). */
export function markTask(
  state: RunState,
  taskId: string,
  status: RunTaskStatus,
  detail?: string,
): RunState {
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.taskId === taskId
        ? { ...t, status, ...(detail !== undefined ? { detail } : {}) }
        : t,
    ),
  };
}

/**
 * Fold a returned agent envelope into the run state for `taskId`.
 * The specific task is named by `taskId` (carried on `input.context` when the
 * orchestrator emitted it).
 */
export function applyResult(
  state: RunState,
  taskId: string,
  env: NodeEnvelope,
): RunState {
  const status: RunTaskStatus =
    env.status === "ok"
      ? "done"
      : env.status === "needs-input"
        ? "needs-input"
        : "error";
  const detail = status === "done" ? undefined : env.result.text;
  return markTask(state, taskId, status, detail);
}

/** Aggregate the run's status — the traceable view a partial failure leaves behind. */
export function summarise(state: RunState): RunSummary {
  const count = (s: RunTaskStatus) =>
    state.tasks.filter((t) => t.status === s).length;
  const total = state.tasks.length;
  const done = count("done");
  const pending = count("pending");
  const running = count("running");
  const needsInput = count("needs-input");
  const error = count("error");
  const complete = total > 0 && done === total;
  const resumable = !complete && pending + running + needsInput > 0;
  return { total, pending, running, done, error, needsInput, complete, resumable };
}

/**
 * Tasks that may run now: still pending and every in-plan dependency is done.
 * A failed/needs-input dependency holds back its dependents (no silent skips).
 */
export function readyTasks(state: RunState): RunTaskState[] {
  const known = new Set(state.tasks.map((t) => t.taskId));
  const done = new Set(
    state.tasks.filter((t) => t.status === "done").map((t) => t.taskId),
  );
  return state.tasks.filter(
    (t) =>
      t.status === "pending" &&
      t.dependsOn.every((d) => !known.has(d) || done.has(d)),
  );
}

/** The lowest wave with ready work, or null when nothing can run now. */
export function nextReadyWave(state: RunState): number | null {
  const ready = readyTasks(state);
  if (ready.length === 0) return null;
  return Math.min(...ready.map((t) => t.wave));
}

export function failedTasks(state: RunState): RunTaskState[] {
  return state.tasks.filter((t) => t.status === "error");
}

/**
 * ADR-002 Decision F — T8 aggregation transition.
 *
 * Record a returning agent envelope's terminal status + changeRef into run-state.
 * The task is located by correlationId (must match) + taskId (from envelope.input.context).
 * Idempotent: re-applying the same result for an already-terminal task is a no-op.
 */
export function recordAgentResult(
  state: RunState,
  env: NodeEnvelope,
): RunState {
  if (env.correlationId !== state.correlationId) return state;

  const ctx = env.input.context as Record<string, unknown> | null | undefined;
  const taskId = typeof ctx?.taskId === "string" ? ctx.taskId : undefined;
  if (taskId === undefined) return state;

  const terminal: ReadonlySet<RunTaskStatus> = new Set(["done", "error", "needs-input"]);

  return {
    ...state,
    tasks: state.tasks.map((t): RunTaskState => {
      if (t.taskId !== taskId) return t;
      if (terminal.has(t.status)) return t;

      const status: RunTaskStatus =
        env.status === "ok"
          ? "done"
          : env.status === "needs-input"
            ? "needs-input"
            : "error";
      const detail = status === "done" ? undefined : env.result.text;
      const changeRef: ChangeRef | undefined =
        env.changeRef !== undefined ? env.changeRef : undefined;

      return {
        ...t,
        status,
        ...(detail !== undefined ? { detail } : {}),
        ...(changeRef !== undefined ? { changeRef } : {}),
      };
    }),
  };
}

/**
 * ADR-002 Decision F — T9 read contract (forward-aggregation accessor).
 *
 * Enumerate every agent task's status and changeRef from the rehydrated run-state.
 * The Finaliser calls this to build its merge set — it does not receive envelopes back
 * from agents; it reads the aggregated run-state directly.
 */
export interface AgentResult {
  readonly taskId: string;
  readonly agent: string;
  readonly status: RunTaskStatus;
  readonly changeRef?: ChangeRef;
}

export function enumerateAgentResults(state: RunState): AgentResult[] {
  return state.tasks.map((t) => ({
    taskId: t.taskId,
    agent: t.agent,
    status: t.status,
    ...(t.changeRef !== undefined ? { changeRef: t.changeRef } : {}),
  }));
}

export function needsInputTasks(state: RunState): RunTaskState[] {
  return state.tasks.filter((t) => t.status === "needs-input");
}
