import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { OrchestrationTask } from "./shapes";

/**
 * Order tasks for canvas delegation: wave-major, Kahn-style topological sort.
 * Ties within a wave break on the planner's original index for deterministic output.
 * Throws on a dependency cycle / unsatisfiable dependency so malformed plans surface loudly (R-05).
 */
export function orderTasks(tasks: OrchestrationTask[]): OrchestrationTask[] {
  const known = new Set(tasks.map((t) => t.taskId));
  const originalIndex = new Map<string, number>();
  tasks.forEach((t, i) => originalIndex.set(t.taskId, i));

  const done = new Set<string>();
  const ordered: OrchestrationTask[] = [];
  const remaining = [...tasks];

  while (remaining.length > 0) {
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

/**
 * Turn ordered tasks into the per-task envelopes the Orchestrator emits (one item per wave-task).
 * ARCHITECTURE.md §"Decision C" is the authority for this emission contract.
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
