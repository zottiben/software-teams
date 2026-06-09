/**
 * Orchestrator run-state model + canvas-delegation core (T9 — AC4, R-04, R-05)
 *
 * Public re-export entry — sub-modules are under `run-state/`.
 * All importers (`nodes/`, `__tests__/`) continue to resolve this path unchanged.
 *
 * Contract references:
 *   - n8n/ARCHITECTURE.md §"Decision C — Canvas handoff" (item-emission authority)
 *   - n8n/CONTRACT.md §1 (NodeEnvelope shape) / §2 (producer/consumer rules)
 *   - spec AC3 (inter-node contract), AC4 (orchestrator delegation)
 *   - ARCHITECTURE.md §"Partial-failure & resume", R-05 (resumability/traceability)
 */

export type {
  OrchestrationTask,
  AgentTurnAdapter,
  RunTaskStatus,
  RunTaskState,
  RunState,
  RunSummary,
  PlanResult,
} from "./run-state/shapes";

export { orderTasks, tasksToEnvelopes } from "./run-state/ordering";

export {
  BREAKDOWN_INSTRUCTION,
  buildPlannerEnvelope,
  parseBreakdown,
  planEpic,
} from "./run-state/planning";

export {
  initRunState,
  markTask,
  applyResult,
  summarise,
  readyTasks,
  nextReadyWave,
  failedTasks,
  needsInputTasks,
} from "./run-state/transitions";

export {
  serialiseRunState,
  deserialiseRunState,
  isNodeEnvelope,
} from "./run-state/persistence";
