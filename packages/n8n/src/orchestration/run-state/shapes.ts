import type { ChangeRef, NodeEnvelope } from "@websitelabs/software-teams";

// Re-declared (not imported from src/utils/parse-orchestration.ts) so this
// module stays free of that file's runtime deps (yaml, node:fs/promises).
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
  /** ADR-002 Decision E/F — the agent's captured portable change, set on terminal status (T8). */
  changeRef?: ChangeRef;
}

export interface RunState {
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
  complete: boolean;
  resumable: boolean;
}

export interface PlanResult {
  correlationId: string;
  tasks: OrchestrationTask[];
  envelopes: NodeEnvelope[];
  state: RunState;
  /** set when the PLANNER itself asked for human input — bubble up to T10 */
  plannerNeedsInput?: NodeEnvelope;
}
