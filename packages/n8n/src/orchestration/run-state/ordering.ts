import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { OrchestrationTask } from "./shapes";

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
