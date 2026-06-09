import { describe, test, expect } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import {
  applyResult,
  buildPlannerEnvelope,
  deserialiseRunState,
  failedTasks,
  initRunState,
  isNodeEnvelope,
  needsInputTasks,
  nextReadyWave,
  orderTasks,
  parseBreakdown,
  planEpic,
  readyTasks,
  serialiseRunState,
  summarise,
  tasksToEnvelopes,
  type AgentTurnAdapter,
  type OrchestrationTask,
} from "../run-state";

// A representative cross-team breakdown the planner would return for an epic.
// Frontend (wave 1) → QA (wave 2, depends on frontend); Backend (wave 1) →
// PR generator (wave 3, depends on QA + backend).
const SAMPLE_TASKS: OrchestrationTask[] = [
  { taskId: "T3", name: "Open the PR", agent: "software-teams-pr-generator", wave: 3, dependsOn: ["T2", "T4"] },
  { taskId: "T2", name: "QA the banner", agent: "software-teams-qa-tester", wave: 2, dependsOn: ["T1"] },
  { taskId: "T1", name: "Build the banner", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
  { taskId: "T4", name: "Add the API endpoint", agent: "software-teams-backend", wave: 1, dependsOn: [] },
];

const SAMPLE_JSON = JSON.stringify(SAMPLE_TASKS);

/** A mocked T3 adapter that returns a fixed planner breakdown. No claude binary,
 *  no n8n — proves the canvas-delegation model in isolation. */
function mockPlannerAdapter(text: string): AgentTurnAdapter {
  return async (input: NodeEnvelope): Promise<NodeEnvelope> => ({
    ...input,
    status: "ok",
    result: { text },
  });
}

describe("orderTasks — wave-major, dependency-respecting (R-04)", () => {
  test("emits one entry per task, never dropping or duplicating", () => {
    const ordered = orderTasks(SAMPLE_TASKS);
    expect(ordered).toHaveLength(SAMPLE_TASKS.length);
    expect(new Set(ordered.map((t) => t.taskId)).size).toBe(SAMPLE_TASKS.length);
  });

  test("waves are non-decreasing across the ordered output", () => {
    const ordered = orderTasks(SAMPLE_TASKS);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.wave).toBeGreaterThanOrEqual(ordered[i - 1]!.wave);
    }
  });

  test("every dependency appears before its dependent", () => {
    const ordered = orderTasks(SAMPLE_TASKS);
    const position = new Map(ordered.map((t, i) => [t.taskId, i]));
    for (const t of ordered) {
      for (const dep of t.dependsOn) {
        expect(position.get(dep)!).toBeLessThan(position.get(t.taskId)!);
      }
    }
  });

  test("is deterministic — identical input yields identical order", () => {
    const a = orderTasks(SAMPLE_TASKS).map((t) => t.taskId);
    const b = orderTasks([...SAMPLE_TASKS]).map((t) => t.taskId);
    expect(a).toEqual(b);
  });

  test("throws on a dependency cycle (traceable, not silent)", () => {
    const cyclic: OrchestrationTask[] = [
      { taskId: "A", name: "a", agent: "x", wave: 1, dependsOn: ["B"] },
      { taskId: "B", name: "b", agent: "y", wave: 1, dependsOn: ["A"] },
    ];
    expect(() => orderTasks(cyclic)).toThrow(/cyclic|unsatisfiable/i);
  });
});

describe("tasksToEnvelopes — canvas-delegation contract (ARCHITECTURE §Decision C)", () => {
  test("emits exactly one NodeEnvelope per wave-task", () => {
    const envelopes = tasksToEnvelopes(orderTasks(SAMPLE_TASKS), "run-1");
    expect(envelopes).toHaveLength(SAMPLE_TASKS.length);
  });

  test("each envelope's agentId is the task's assigned specialist", () => {
    const ordered = orderTasks(SAMPLE_TASKS);
    const envelopes = tasksToEnvelopes(ordered, "run-1");
    envelopes.forEach((env, i) => {
      expect(env.agentId).toBe(ordered[i]!.agent);
    });
  });

  test("correlationId is carried unchanged onto every emitted item", () => {
    const envelopes = tasksToEnvelopes(orderTasks(SAMPLE_TASKS), "run-CU-4821");
    for (const env of envelopes) {
      expect(env.correlationId).toBe("run-CU-4821");
    }
  });

  test("input.prompt is the sub-task brief; metadata rides on input.context", () => {
    const ordered = orderTasks(SAMPLE_TASKS);
    const envelopes = tasksToEnvelopes(ordered, "run-1");
    envelopes.forEach((env, i) => {
      expect(env.input.prompt).toBe(ordered[i]!.name);
      const ctx = env.input.context as { taskId: string; wave: number };
      expect(ctx.taskId).toBe(ordered[i]!.taskId);
      expect(ctx.wave).toBe(ordered[i]!.wave);
    });
  });

  test("each emitted envelope satisfies the NodeEnvelope contract", () => {
    const envelopes = tasksToEnvelopes(orderTasks(SAMPLE_TASKS), "run-1");
    for (const env of envelopes) {
      expect(isNodeEnvelope(env)).toBe(true);
      expect(env.status).toBe("ok");
      expect(env.result.text).toBe("");
      expect(Array.isArray(env.artifacts)).toBe(true);
    }
  });
});

describe("parseBreakdown — tolerant planner-output parsing", () => {
  test("parses a bare JSON array", () => {
    expect(parseBreakdown(SAMPLE_JSON)).toHaveLength(4);
  });

  test("parses a ```json fenced array embedded in prose", () => {
    const fenced = `Here is the plan:\n\n\`\`\`json\n${SAMPLE_JSON}\n\`\`\`\nDone.`;
    expect(parseBreakdown(fenced)).toHaveLength(4);
  });

  test("skips malformed rows (missing name/agent) but keeps valid ones", () => {
    const mixed = JSON.stringify([
      { taskId: "T1", name: "Good", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
      { taskId: "T2", wave: 1, dependsOn: [] },
    ]);
    expect(parseBreakdown(mixed)).toHaveLength(1);
  });

  test("throws when no valid tasks are present (traceable)", () => {
    expect(() => parseBreakdown("no json here")).toThrow();
    expect(() => parseBreakdown("[]")).toThrow(/no valid tasks/i);
  });
});

describe("buildPlannerEnvelope — reuses the planner spec via the T3 adapter", () => {
  test("targets the software-teams-planner specialist (adapter inlines its spec)", () => {
    const env = buildPlannerEnvelope("Ship a cookie banner", "run-1");
    expect(env.agentId).toBe("software-teams-planner");
    expect(env.correlationId).toBe("run-1");
    expect(env.input.prompt).toContain("Ship a cookie banner");
    // Pins a machine-readable output contract — does NOT re-author breakdown logic.
    expect(env.input.prompt).toContain('"taskId"');
    expect(env.input.prompt).toContain('"dependsOn"');
  });
});

describe("planEpic — full delegation pass with a MOCKED T3 adapter (AC4)", () => {
  test("epic input produces N ordered envelopes (one per wave-task) WITHOUT n8n", async () => {
    const plan = await planEpic(
      "Add a cookie-consent banner",
      "run-1",
      mockPlannerAdapter(SAMPLE_JSON),
    );

    // ── item COUNT: one envelope per planned wave-task ──────────────────────
    expect(plan.envelopes).toHaveLength(SAMPLE_TASKS.length);
    expect(plan.tasks).toHaveLength(SAMPLE_TASKS.length);

    // ── wave/dependency ORDERING ─────────────────────────────────────────────
    const waves = plan.envelopes.map(
      (e) => (e.input.context as { wave: number }).wave,
    );
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i]!).toBeGreaterThanOrEqual(waves[i - 1]!);
    }
    const order = plan.tasks.map((t) => t.taskId);
    expect(order.indexOf("T1")).toBeLessThan(order.indexOf("T2")); // dep before dependent
    expect(order.indexOf("T2")).toBeLessThan(order.indexOf("T3"));
    expect(order.indexOf("T4")).toBeLessThan(order.indexOf("T3"));

    // ── initial run state: all pending, keyed to the run ────────────────────
    expect(plan.state.correlationId).toBe("run-1");
    expect(summarise(plan.state).total).toBe(SAMPLE_TASKS.length);
    expect(summarise(plan.state).pending).toBe(SAMPLE_TASKS.length);
  });

  test("a planner needs-input bubbles up (no tasks emitted) for the Slack flow (T10)", async () => {
    const adapter: AgentTurnAdapter = async (input) => ({
      ...input,
      status: "needs-input",
      result: { text: "Which repo should I target?" },
    });
    const plan = await planEpic("Vague goal", "run-1", adapter);
    expect(plan.envelopes).toHaveLength(0);
    expect(plan.plannerNeedsInput?.status).toBe("needs-input");
    expect(plan.plannerNeedsInput?.result.text).toContain("Which repo");
  });

  test("a planner error throws (the node surfaces it)", async () => {
    const adapter: AgentTurnAdapter = async (input) => ({
      ...input,
      status: "error",
      result: { text: "claude binary not found" },
    });
    await expect(planEpic("goal", "run-1", adapter)).rejects.toThrow(/Planner turn failed/);
  });
});

describe("run-state — partial-failure resume + traceability (R-05)", () => {
  test("a mid-run failure leaves a resumable, traceable state (not silent half-completion)", () => {
    let state = initRunState("run-1", orderTasks(SAMPLE_TASKS));

    // Wave 1 partially completes: frontend done, backend FAILS mid-run.
    state = applyResult(state, "T1", okEnvelope("T1"));
    state = applyResult(state, "T4", errorEnvelope("T4", "compile error"));

    const summary = summarise(state);
    expect(summary.done).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.complete).toBe(false);
    expect(summary.resumable).toBe(true); // outstanding work remains → re-drivable

    // The failure is recorded with detail (traceable), not lost.
    const failed = failedTasks(state);
    expect(failed.map((t) => t.taskId)).toEqual(["T4"]);
    expect(failed[0]!.detail).toBe("compile error");

    // T2 depends on the DONE T1 → ready; T3 depends on the FAILED branch → held back.
    expect(readyTasks(state).map((t) => t.taskId)).toEqual(["T2"]);
    expect(nextReadyWave(state)).toBe(2);
  });

  test("a needs-input task is surfaced for the Slack HITL flow (T10)", () => {
    let state = initRunState("run-1", orderTasks(SAMPLE_TASKS));
    state = applyResult(state, "T1", {
      correlationId: "run-1",
      agentId: "software-teams-frontend",
      status: "needs-input",
      input: { prompt: "", context: null },
      result: { text: "Light or dark theme?" },
      artifacts: [],
    });
    const pending = needsInputTasks(state);
    expect(pending.map((t) => t.taskId)).toEqual(["T1"]);
    expect(pending[0]!.detail).toBe("Light or dark theme?");
  });

  test("a fully completed run reports complete + not resumable", () => {
    let state = initRunState("run-1", orderTasks(SAMPLE_TASKS));
    for (const id of ["T1", "T4", "T2", "T3"]) {
      state = applyResult(state, id, okEnvelope(id));
    }
    const summary = summarise(state);
    expect(summary.complete).toBe(true);
    expect(summary.resumable).toBe(false);
    expect(nextReadyWave(state)).toBeNull();
  });

  test("run state round-trips through workflow static-data persistence", () => {
    const state = initRunState("run-1", orderTasks(SAMPLE_TASKS));
    const stored = serialiseRunState(state);
    const rehydrated = deserialiseRunState(JSON.parse(JSON.stringify(stored)));
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.correlationId).toBe("run-1");
    expect(rehydrated!.tasks).toHaveLength(SAMPLE_TASKS.length);
    expect(deserialiseRunState({ bogus: true })).toBeNull();
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function okEnvelope(taskId: string): NodeEnvelope {
  return {
    correlationId: "run-1",
    agentId: "software-teams-x",
    status: "ok",
    input: { prompt: taskId, context: null },
    result: { text: `done ${taskId}` },
    artifacts: [],
  };
}

function errorEnvelope(taskId: string, detail: string): NodeEnvelope {
  return {
    correlationId: "run-1",
    agentId: "software-teams-x",
    status: "error",
    input: { prompt: taskId, context: null },
    result: { text: detail },
    artifacts: [],
  };
}
