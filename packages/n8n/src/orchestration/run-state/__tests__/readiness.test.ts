import { describe, test, expect } from "bun:test";
import type { RunState } from "../shapes";
import { buildReadinessEnvelope, parseReadinessVerdict } from "../readiness";
import { initRunState } from "../transitions";
import type { OrchestrationTask } from "../shapes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTasks(): OrchestrationTask[] {
  return [
    { taskId: "T1", name: "Implement login form", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
    { taskId: "T2", name: "Build auth API", agent: "software-teams-backend", wave: 1, dependsOn: [] },
    { taskId: "T3", name: "Integration tests", agent: "software-teams-qa-tester", wave: 2, dependsOn: ["T1", "T2"] },
  ];
}

function makeRunState(): RunState {
  return initRunState("test-cid-001", makeTasks());
}

// ---------------------------------------------------------------------------
// buildReadinessEnvelope
// ---------------------------------------------------------------------------

describe("buildReadinessEnvelope (T6 — readiness gate)", () => {
  test("targets software-teams-quality agent", () => {
    const env = buildReadinessEnvelope(makeRunState(), "test-cid-001");
    expect(env.agentId).toBe("software-teams-quality");
  });

  test("uses the provided correlationId", () => {
    const env = buildReadinessEnvelope(makeRunState(), "my-run-id");
    expect(env.correlationId).toBe("my-run-id");
  });

  test("prompt contains task briefs from runState.tasks[].name", () => {
    const env = buildReadinessEnvelope(makeRunState(), "test-cid-001");
    expect(env.input.prompt).toContain("Implement login form");
    expect(env.input.prompt).toContain("Build auth API");
    expect(env.input.prompt).toContain("Integration tests");
  });

  test("prompt contains taskIds, agents, and waves", () => {
    const env = buildReadinessEnvelope(makeRunState(), "test-cid-001");
    expect(env.input.prompt).toContain("T1");
    expect(env.input.prompt).toContain("T2");
    expect(env.input.prompt).toContain("T3");
    expect(env.input.prompt).toContain("software-teams-frontend");
    expect(env.input.prompt).toContain("software-teams-backend");
    expect(env.input.prompt).toContain("software-teams-qa-tester");
  });

  test("prompt contains dependency info", () => {
    const env = buildReadinessEnvelope(makeRunState(), "test-cid-001");
    expect(env.input.prompt).toContain("dependsOn=[T1, T2]");
  });

  test("status is ok and result.text is empty", () => {
    const env = buildReadinessEnvelope(makeRunState(), "test-cid-001");
    expect(env.status).toBe("ok");
    expect(env.result.text).toBe("");
  });

  test("artifacts is an empty array", () => {
    const env = buildReadinessEnvelope(makeRunState(), "test-cid-001");
    expect(env.artifacts).toEqual([]);
  });

  test("handles tasks without name gracefully (empty string serialised)", () => {
    const state = makeRunState();
    // Simulate a legacy run-state entry without name
    delete (state.tasks[0] as Record<string, unknown>)["name"];
    const env = buildReadinessEnvelope(state, "test-cid-001");
    // Should still contain the empty-brief representation, not crash
    expect(env.input.prompt).toContain('brief=""');
  });
});

// ---------------------------------------------------------------------------
// parseReadinessVerdict
// ---------------------------------------------------------------------------

describe("parseReadinessVerdict (T6 — readiness gate)", () => {
  test("parses a clean READY verdict", () => {
    const verdict = parseReadinessVerdict("READINESS: ready");
    expect(verdict.ready).toBe(true);
    expect(verdict.gaps).toEqual([]);
  });

  test("parses READY with surrounding prose", () => {
    const text = `After careful analysis of the plan:

READINESS: ready

All tasks are well-defined.`;
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(true);
    expect(verdict.gaps).toEqual([]);
  });

  test("parses READY inside markdown fences", () => {
    const text = "```\nREADINESS: ready\n```";
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(true);
    expect(verdict.gaps).toEqual([]);
  });

  test("parses a BLOCKED verdict with gaps", () => {
    const text = `READINESS: blocked
gaps:
- T1: brief is vague — no clear acceptance criteria
- T3: depends on T99 which does not exist in the plan`;
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(false);
    expect(verdict.gaps).toHaveLength(2);
    expect(verdict.gaps[0]).toContain("T1");
    expect(verdict.gaps[1]).toContain("T3");
  });

  test("parses BLOCKED inside markdown fences", () => {
    const text = `\`\`\`
READINESS: blocked
gaps:
- T2: no agent pin
\`\`\``;
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(false);
    expect(verdict.gaps).toHaveLength(1);
    expect(verdict.gaps[0]).toContain("T2");
  });

  test("returns blocked with diagnostic when no READINESS header found", () => {
    const text = "The plan looks okay but I have some concerns.";
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(false);
    expect(verdict.gaps).toHaveLength(1);
    expect(verdict.gaps[0]).toContain("parseable READINESS verdict");
  });

  test("returns blocked with generic gap when BLOCKED but no gap lines", () => {
    const text = "READINESS: blocked\n\nNo specific details provided.";
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(false);
    expect(verdict.gaps).toHaveLength(1);
    expect(verdict.gaps[0]).toContain("listed no specific gaps");
  });

  test("case-insensitive header matching", () => {
    const verdict = parseReadinessVerdict("readiness: READY");
    expect(verdict.ready).toBe(true);
  });

  test("handles mixed-case blocked", () => {
    const text = `Readiness: Blocked
gaps:
- T1: missing agent`;
    const verdict = parseReadinessVerdict(text);
    expect(verdict.ready).toBe(false);
    expect(verdict.gaps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// initRunState — name persistence (T6 gap 1)
// ---------------------------------------------------------------------------

describe("initRunState persists task name (T6 gap 1)", () => {
  test("tasks with name have it on the RunTaskState", () => {
    const state = initRunState("cid-001", makeTasks());
    expect(state.tasks[0]?.name).toBe("Implement login form");
    expect(state.tasks[1]?.name).toBe("Build auth API");
    expect(state.tasks[2]?.name).toBe("Integration tests");
  });

  test("tasks with empty name do not carry the field", () => {
    const tasks: OrchestrationTask[] = [
      { taskId: "T1", name: "", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
    ];
    const state = initRunState("cid-002", tasks);
    // Empty name is falsy, so the spread omits the key
    expect(state.tasks[0]?.name).toBeUndefined();
  });

  test("existing run-states without name still work (additive)", () => {
    // Simulate a legacy serialised state without name
    const legacy: RunState = {
      correlationId: "cid-legacy",
      createdAt: "2024-01-01T00:00:00.000Z",
      tasks: [
        { taskId: "T1", agent: "software-teams-frontend", wave: 1, dependsOn: [], status: "pending" },
      ],
    };
    // Should be usable — name is optional
    expect(legacy.tasks[0]?.name).toBeUndefined();
    expect(legacy.tasks[0]?.taskId).toBe("T1");
  });
});
