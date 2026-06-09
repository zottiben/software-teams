/**
 * Orchestrator run-state model + canvas-delegation core (T9 — AC4, R-04, R-05)
 *
 * This module is the Bun-free heart of the Orchestrator node. It:
 *   1. Turns a planner breakdown into an ordered list of per-task NodeEnvelopes
 *      (the canvas-delegation contract — ARCHITECTURE.md §"Decision C — Canvas
 *      handoff replaces the native Task tool").
 *   2. Models run state (waves, per-task status, correlationId) so a partial
 *      failure mid-run is resumable and traceable rather than silently
 *      half-complete (ARCHITECTURE.md §"Partial-failure & resume", R-05).
 *
 * It deliberately contains NO Bun/Node-only APIs and does NOT import the T3
 * single-turn adapter directly — the adapter is injected (`AgentTurnAdapter`),
 * so this file type-checks and unit-tests under both the root Bun runtime and
 * the n8n (Node/commonjs) tsconfig, and `planEpic` is testable with a mocked
 * adapter WITHOUT a running n8n instance or the `claude` binary.
 *
 * Contract references:
 *   - n8n/ARCHITECTURE.md §"Decision C — Canvas handoff" (item-emission authority)
 *   - n8n/CONTRACT.md §1 (NodeEnvelope shape) / §2 (producer/consumer rules)
 *   - spec AC3 (inter-node contract), AC4 (orchestrator delegation)
 *   - src/utils/parse-orchestration.ts (the OrchestrationTask shape mirrored here)
 *   - agents/software-teams-planner.md §"Task Breakdown" + §"Wave Computation"
 */

import type { NodeEnvelope } from "../contract/envelope";

// ---------------------------------------------------------------------------
// Task shape — mirrors `OrchestrationTask` in src/utils/parse-orchestration.ts.
// Re-declared (not imported) so this module stays free of that file's runtime
// dependencies (`yaml`, `node:fs/promises`) which are not on the n8n package's
// dependency surface. `slice` is optional here — the canvas breakdown does not
// need a per-agent slice file path.
// ---------------------------------------------------------------------------

export interface OrchestrationTask {
  taskId: string;
  name: string;
  agent: string;
  wave: number;
  dependsOn: string[];
  slice?: string;
}

/** Single-turn adapter signature (T3 `runAgentTurn`). Injected so the planning
 *  pass is unit-testable with a mock — never imported statically (Bun chain). */
export type AgentTurnAdapter = (input: NodeEnvelope) => Promise<NodeEnvelope>;

// ---------------------------------------------------------------------------
// 1. Ordering — wave-major, dependency-respecting, deterministic
// ---------------------------------------------------------------------------

/**
 * Order tasks for canvas delegation: by wave ascending, and within that always
 * after every in-plan dependency (Kahn-style topological pass). Ties break on
 * the planner's original index so identical breakdowns produce identical order.
 *
 * Throws on a dependency cycle / unsatisfiable dependency so a malformed plan
 * surfaces loudly (traceable) rather than emitting a silently broken graph.
 */
export function orderTasks(tasks: OrchestrationTask[]): OrchestrationTask[] {
  const known = new Set(tasks.map((t) => t.taskId));
  const originalIndex = new Map<string, number>();
  tasks.forEach((t, i) => originalIndex.set(t.taskId, i));

  const done = new Set<string>();
  const ordered: OrchestrationTask[] = [];
  const remaining = [...tasks];

  while (remaining.length > 0) {
    // A task is available when every dependency that exists in this plan is done.
    // Dependencies pointing outside the plan are treated as already satisfied.
    const available = remaining.filter((t) =>
      t.dependsOn.every((d) => !known.has(d) || done.has(d)),
    );
    if (available.length === 0) {
      throw new Error(
        `Cyclic or unsatisfiable dependencies in task breakdown: ${remaining
          .map((t) => t.taskId)
          .join(", ")}`,
      );
    }
    // Pick the available task with the lowest wave, ties broken by original
    // index → wave-major emission that still respects dependencies.
    available.sort((a, b) =>
      a.wave !== b.wave
        ? a.wave - b.wave
        : (originalIndex.get(a.taskId) ?? 0) - (originalIndex.get(b.taskId) ?? 0),
    );
    const next = available[0]!;
    ordered.push(next);
    done.add(next.taskId);
    remaining.splice(remaining.indexOf(next), 1);
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// 2. Canvas-delegation contract — one NodeEnvelope per wave-task
//    (ARCHITECTURE.md §"Decision C" is the authority for this emission)
// ---------------------------------------------------------------------------

/**
 * Turn ordered tasks into the per-task envelopes the Orchestrator emits on its
 * output port — exactly one item per wave-task. Each envelope:
 *   - carries the run's `correlationId` UNCHANGED (the run-state/Slack join key),
 *   - sets `agentId` to the task's assigned specialist (the consumer rewrites it
 *     to its own identity per CONTRACT.md §2 before invoking),
 *   - sets `input.prompt` to the sub-task brief (the agent's prompt expression
 *     reads `{{ $json.input.prompt }}`),
 *   - carries task metadata (taskId/wave/dependsOn) on `input.context` so a
 *     returned result can be correlated back to a specific run-state task.
 */
export function tasksToEnvelopes(
  tasks: OrchestrationTask[],
  correlationId: string,
): NodeEnvelope[] {
  return tasks.map((t) => ({
    correlationId,
    agentId: t.agent,
    status: "ok" as const,
    input: {
      prompt: t.name,
      context: {
        taskId: t.taskId,
        wave: t.wave,
        dependsOn: [...t.dependsOn],
        ...(t.slice ? { slice: t.slice } : {}),
      },
    },
    result: { text: "" },
    artifacts: [],
  }));
}

// ---------------------------------------------------------------------------
// 3. Planner breakdown — reuse the planner spec via the T3 adapter
// ---------------------------------------------------------------------------

/**
 * The output contract appended to the planner turn. The planner's breakdown
 * LOGIC (Task Breakdown → Wave Computation) is NOT re-authored here — it is
 * inlined by the T3 adapter, which resolves and prepends the
 * `software-teams-planner` spec for `agentId: "software-teams-planner"` (the
 * same mechanism as `inlineAgentSpec` in src/utils/prompt-builder.ts). This
 * block only pins a machine-readable OUTPUT shape so the result is parseable.
 */
export const BREAKDOWN_INSTRUCTION = [
  "Break the epic / sprint goal below into a waved task breakdown using your",
  "Task Breakdown and Wave Computation workflow.",
  "",
  "Return ONLY a single JSON array — no surrounding prose. Each element MUST",
  "have exactly these fields:",
  '  - "taskId":    string   (e.g. "T1")',
  '  - "name":      string   (the sub-task brief handed to the specialist)',
  '  - "agent":     string   (assigned specialist, e.g. "software-teams-frontend")',
  '  - "wave":      number   (1-based execution wave)',
  '  - "dependsOn": string[] (taskIds this task depends on; [] for wave 1)',
  "",
  "Emission order does not matter — the orchestrator computes execution order",
  "from waves and dependencies.",
].join("\n");

/**
 * Build the single-turn envelope that runs the planner. `agentId` is
 * `software-teams-planner` so the T3 adapter inlines the planner spec/persona.
 */
export function buildPlannerEnvelope(
  epic: string,
  correlationId: string,
): NodeEnvelope {
  return {
    correlationId,
    agentId: "software-teams-planner",
    status: "ok",
    input: {
      prompt: `${BREAKDOWN_INSTRUCTION}\n\n## Epic / Goal\n${epic}`,
      context: null,
    },
    result: { text: "" },
    artifacts: [],
  };
}

/** Extract the JSON array substring from a planner response (tolerates fences). */
function extractJsonArray(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  return candidate.trim();
}

/**
 * Parse a planner response into `OrchestrationTask`-shaped items. Tolerant of
 * markdown fences and stray prose; throws with a clear message when nothing
 * parseable is found so a broken planning pass is traceable (R-05).
 */
export function parseBreakdown(text: string): OrchestrationTask[] {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonArray(text));
  } catch (err) {
    throw new Error(
      `Planner did not return a parseable JSON task breakdown: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new Error("Planner breakdown is not a JSON array.");
  }

  const tasks: OrchestrationTask[] = [];
  raw.forEach((entry, i) => {
    if (entry == null || typeof entry !== "object") return;
    const o = entry as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const agent = typeof o.agent === "string" ? o.agent.trim() : "";
    if (!name || !agent) return; // skip malformed rows rather than poison the run

    const taskId =
      typeof o.taskId === "string" && o.taskId.trim() ? o.taskId.trim() : `T${i + 1}`;
    const waveNum =
      typeof o.wave === "number" && Number.isFinite(o.wave)
        ? Math.trunc(o.wave)
        : Number.parseInt(String(o.wave ?? ""), 10);
    const wave = Number.isFinite(waveNum) && waveNum > 0 ? waveNum : 1;
    const dependsOn = Array.isArray(o.dependsOn)
      ? (o.dependsOn as unknown[]).filter((d): d is string => typeof d === "string")
      : [];
    const slice = typeof o.slice === "string" ? o.slice : undefined;

    tasks.push({ taskId, name, agent, wave, dependsOn, slice });
  });

  if (tasks.length === 0) {
    throw new Error("Planner breakdown contained no valid tasks.");
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// 4. Planning pass — epic → ordered envelopes + run state (injectable adapter)
// ---------------------------------------------------------------------------

export interface PlanResult {
  correlationId: string;
  /** ordered (wave then dependency) task breakdown */
  tasks: OrchestrationTask[];
  /** one NodeEnvelope per wave-task, in emission order */
  envelopes: NodeEnvelope[];
  /** initial run state (all tasks pending) */
  state: RunState;
  /** set when the PLANNER itself asked for human input — bubble up to T10 */
  plannerNeedsInput?: NodeEnvelope;
}

/**
 * Run a single-turn planning pass through the injected adapter and produce the
 * canvas-delegation payload: ordered per-task envelopes + an initial run state.
 *
 * - Planner `needs-input` → returned via `plannerNeedsInput` (no tasks emitted);
 *   the node bubbles it to the Slack HITL flow (T10).
 * - Planner `error` → throws (the node surfaces it as a node error).
 */
export async function planEpic(
  epic: string,
  correlationId: string,
  adapter: AgentTurnAdapter,
): Promise<PlanResult> {
  const planned = await adapter(buildPlannerEnvelope(epic, correlationId));

  if (planned.status === "needs-input") {
    return {
      correlationId,
      tasks: [],
      envelopes: [],
      state: initRunState(correlationId, []),
      plannerNeedsInput: planned,
    };
  }
  if (planned.status === "error") {
    throw new Error(
      `Planner turn failed: ${planned.result.text || "unknown error"}`,
    );
  }

  const tasks = orderTasks(parseBreakdown(planned.result.text));
  return {
    correlationId,
    tasks,
    envelopes: tasksToEnvelopes(tasks, correlationId),
    state: initRunState(correlationId, tasks),
  };
}

// ---------------------------------------------------------------------------
// 5. Run-state model — waves, per-task status, correlationId (R-05)
// ---------------------------------------------------------------------------

export type RunTaskStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "needs-input";

export interface RunTaskState {
  taskId: string;
  agent: string;
  wave: number;
  dependsOn: string[];
  status: RunTaskStatus;
  /** populated when a task transitions to error / needs-input (traceability) */
  detail?: string;
}

export interface RunState {
  /** the run/conversation id — the join key for resume + Slack HITL (R-05) */
  correlationId: string;
  createdAt: string;
  tasks: RunTaskState[];
}

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
 * Fold a returned agent envelope into the run state for `taskId`. The envelope
 * carries the run-level `correlationId`; the specific task it answers is named
 * by `taskId` (carried on `input.context` when the orchestrator emitted it).
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

export interface RunSummary {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
  needsInput: number;
  /** every task done */
  complete: boolean;
  /** outstanding work remains and the run can be re-driven (not a silent half-finish) */
  resumable: boolean;
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
 * The orchestrator uses this for wave-gated re-entry — a failed/needs-input
 * dependency holds back its dependents instead of silently skipping them.
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

export function needsInputTasks(state: RunState): RunTaskState[] {
  return state.tasks.filter((t) => t.status === "needs-input");
}

// ---------------------------------------------------------------------------
// 6. Persistence helpers — plain JSON for n8n workflow static data
// ---------------------------------------------------------------------------

/** Deep-clone to a plain JSON object for storage in workflow static data. */
export function serialiseRunState(state: RunState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

/** Rehydrate a run state from workflow static data; null when shape is invalid. */
export function deserialiseRunState(value: unknown): RunState | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.correlationId !== "string" || !Array.isArray(v.tasks)) return null;
  return value as RunState;
}

/** Whether a value is a well-formed NodeEnvelope (used to detect handoff items). */
export function isNodeEnvelope(value: unknown): value is NodeEnvelope {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.correlationId === "string" &&
    v.correlationId.length > 0 &&
    typeof v.agentId === "string" &&
    (v.status === "ok" || v.status === "error" || v.status === "needs-input")
  );
}
