import { describe, test, expect } from "bun:test";
import type { NodeEnvelope, ChangeRef } from "@websitelabs/software-teams";
import { initRunState, recordAgentResult, enumerateAgentResults } from "../transitions";
import type { OrchestrationTask, RunState } from "../shapes";

function makeTasks(): OrchestrationTask[] {
  return [
    { taskId: "T1", name: "Frontend", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
    { taskId: "T2", name: "Backend", agent: "software-teams-backend", wave: 1, dependsOn: [] },
    { taskId: "T3", name: "QA", agent: "software-teams-qa-tester", wave: 2, dependsOn: ["T1", "T2"] },
  ];
}

function makeEnvelope(opts: {
  correlationId: string;
  taskId: string;
  agentId: string;
  status: "ok" | "error" | "needs-input";
  changeRef?: ChangeRef;
}): NodeEnvelope {
  const env: NodeEnvelope = {
    correlationId: opts.correlationId,
    agentId: opts.agentId,
    status: opts.status,
    input: { prompt: "Task", context: { taskId: opts.taskId } },
    result: { text: opts.status === "ok" ? "Done" : "Failed" },
    artifacts: [],
  };
  if (opts.changeRef !== undefined) {
    return { ...env, changeRef: opts.changeRef };
  }
  return env;
}

describe("recordAgentResult — T8 aggregation transitions (T11, AC5, AC8)", () => {
  const CID = "run-agg-test-001";

  describe("basic status recording", () => {
    test("ok envelope sets task status to done", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" });
      const next = recordAgentResult(state, env);
      const task = next.tasks.find((t) => t.taskId === "T1");
      expect(task?.status).toBe("done");
    });

    test("error envelope sets task status to error", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "error" });
      const next = recordAgentResult(state, env);
      const task = next.tasks.find((t) => t.taskId === "T2");
      expect(task?.status).toBe("error");
    });

    test("needs-input envelope sets task status to needs-input", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "needs-input" });
      const next = recordAgentResult(state, env);
      const task = next.tasks.find((t) => t.taskId === "T3");
      expect(task?.status).toBe("needs-input");
    });

    test("unrelated tasks are not mutated", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" });
      const next = recordAgentResult(state, env);
      const t2 = next.tasks.find((t) => t.taskId === "T2");
      const t3 = next.tasks.find((t) => t.taskId === "T3");
      expect(t2?.status).toBe("pending");
      expect(t3?.status).toBe("pending");
    });
  });

  describe("changeRef recording", () => {
    test("changeRef from envelope is stored on the task state", () => {
      const state = initRunState(CID, makeTasks());
      const changeRef: ChangeRef = { kind: "format-patch", patchBase64: "cGF0Y2g=" };
      const env = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok", changeRef });
      const next = recordAgentResult(state, env);
      const task = next.tasks.find((t) => t.taskId === "T1");
      expect(task?.changeRef).toEqual(changeRef);
    });

    test("task without changeRef has no changeRef on state", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" });
      const next = recordAgentResult(state, env);
      const task = next.tasks.find((t) => t.taskId === "T1");
      expect(task?.changeRef).toBeUndefined();
    });
  });

  describe("idempotency — re-delivery is a no-op", () => {
    test("applying the same ok result twice leaves status as done (no double-count)", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" });
      const once = recordAgentResult(state, env);
      const twice = recordAgentResult(once, env);
      const task = twice.tasks.find((t) => t.taskId === "T1");
      expect(task?.status).toBe("done");
      expect(twice.tasks).toHaveLength(once.tasks.length);
    });

    test("applying error result after done result is idempotent — stays done", () => {
      const state = initRunState(CID, makeTasks());
      const okEnv = makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "ok" });
      const errEnv = makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "error" });
      const afterOk = recordAgentResult(state, okEnv);
      const afterErr = recordAgentResult(afterOk, errEnv);
      const task = afterErr.tasks.find((t) => t.taskId === "T2");
      expect(task?.status).toBe("done");
    });

    test("changeRef from first delivery is preserved on second delivery", () => {
      const state = initRunState(CID, makeTasks());
      const changeRef: ChangeRef = { kind: "format-patch", patchBase64: "Zmlyc3Q=" };
      const env = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok", changeRef });
      const once = recordAgentResult(state, env);
      const twice = recordAgentResult(once, env);
      const task = twice.tasks.find((t) => t.taskId === "T1");
      expect(task?.changeRef).toEqual(changeRef);
    });
  });

  describe("correlationId mismatch — no state change", () => {
    test("envelope with different correlationId is ignored", () => {
      const state = initRunState(CID, makeTasks());
      const env = makeEnvelope({ correlationId: "run-OTHER-999", taskId: "T1", agentId: "software-teams-frontend", status: "ok" });
      const next = recordAgentResult(state, env);
      expect(next.tasks).toEqual(state.tasks);
    });
  });

  describe("missing taskId in context — no state change", () => {
    test("envelope without taskId in context is ignored", () => {
      const state = initRunState(CID, makeTasks());
      const env: NodeEnvelope = {
        correlationId: CID,
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "no taskId", context: null },
        result: { text: "Done" },
        artifacts: [],
      };
      const next = recordAgentResult(state, env);
      expect(next.tasks).toEqual(state.tasks);
    });
  });
});

describe("enumerateAgentResults — forward-aggregation accessor (T11, AC8)", () => {
  const CID = "run-enum-test-001";

  test("returns all tasks when none have a changeRef", () => {
    const state = initRunState(CID, makeTasks());
    const results = enumerateAgentResults(state);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.changeRef).toBeUndefined();
    }
  });

  test("returns full set including tasks with changeRef", () => {
    const tasks = makeTasks();
    const state = initRunState(CID, tasks);

    const changeRef: ChangeRef = { kind: "format-patch", patchBase64: "ZW51bQ==" };
    const env1 = makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok", changeRef });
    const env2 = makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "ok" });

    const s1 = recordAgentResult(state, env1);
    const s2 = recordAgentResult(s1, env2);
    const results = enumerateAgentResults(s2);

    expect(results).toHaveLength(3);

    const r1 = results.find((r) => r.taskId === "T1");
    expect(r1?.status).toBe("done");
    expect(r1?.changeRef).toEqual(changeRef);

    const r2 = results.find((r) => r.taskId === "T2");
    expect(r2?.status).toBe("done");
    expect(r2?.changeRef).toBeUndefined();

    const r3 = results.find((r) => r.taskId === "T3");
    expect(r3?.status).toBe("pending");
  });

  test("agent field is carried from the task definition", () => {
    const state = initRunState(CID, makeTasks());
    const results = enumerateAgentResults(state);
    expect(results.find((r) => r.taskId === "T1")?.agent).toBe("software-teams-frontend");
    expect(results.find((r) => r.taskId === "T2")?.agent).toBe("software-teams-backend");
    expect(results.find((r) => r.taskId === "T3")?.agent).toBe("software-teams-qa-tester");
  });

  test("all results after full run have done status and changeRefs where applicable", () => {
    const tasks = makeTasks();
    const state = initRunState(CID, tasks);

    const cr1: ChangeRef = { kind: "format-patch", patchBase64: "Y3IxCg==" };
    const cr2: ChangeRef = { kind: "format-patch", patchBase64: "Y3IyCg==" };

    const s1 = recordAgentResult(state, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok", changeRef: cr1 }));
    const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "ok", changeRef: cr2 }));
    const s3 = recordAgentResult(s2, makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "ok" }));

    const results = enumerateAgentResults(s3);
    const changeRefs = results.filter((r) => r.changeRef !== undefined).map((r) => r.changeRef);
    expect(changeRefs).toHaveLength(2);
    expect(changeRefs).toContainEqual(cr1);
    expect(changeRefs).toContainEqual(cr2);
  });
});
