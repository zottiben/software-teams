import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { AgentTurnAdapter, OrchestrationTask, PlanResult } from "./shapes";
import { orderTasks, tasksToEnvelopes } from "./ordering";
import { initRunState } from "./transitions";

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
  const raw = (() => {
    try {
      return JSON.parse(extractJsonArray(text));
    } catch (err) {
      throw new Error(
        `Planner did not return a parseable JSON task breakdown: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  })();
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
