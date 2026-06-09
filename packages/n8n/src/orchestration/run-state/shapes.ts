import type { NodeEnvelope } from "../../contract/envelope";

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
// Run-state model — waves, per-task status, correlationId (R-05)
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
