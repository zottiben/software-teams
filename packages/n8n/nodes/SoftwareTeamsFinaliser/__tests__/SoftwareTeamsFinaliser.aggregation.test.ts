import { describe, test, expect } from "bun:test";
import type { NodeEnvelope, ChangeRef } from "@websitelabs/software-teams";
import { initRunState, recordAgentResult, enumerateAgentResults } from "../../../src/orchestration/run-state/transitions";
import { writeRunState, readRunState } from "../../../src/orchestration/run-state/global-store";
import type { OrchestrationTask } from "../../../src/orchestration/run-state/shapes";

const TASKS: OrchestrationTask[] = [
  { taskId: "T1", name: "Backend", agent: "software-teams-backend", wave: 1, dependsOn: [] },
  { taskId: "T2", name: "Frontend", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
  { taskId: "T3", name: "QA", agent: "software-teams-qa-tester", wave: 2, dependsOn: ["T1", "T2"] },
];

function makeEnvelope(opts: {
  correlationId: string;
  taskId: string;
  agentId: string;
  status: "ok" | "error" | "needs-input";
  changeRef?: ChangeRef;
}): NodeEnvelope {
  const base: NodeEnvelope = {
    correlationId: opts.correlationId,
    agentId: opts.agentId,
    status: opts.status,
    input: { prompt: "task", context: { taskId: opts.taskId } },
    result: { text: opts.status === "ok" ? "done" : "failed" },
    artifacts: [],
  };
  return opts.changeRef !== undefined ? { ...base, changeRef: opts.changeRef } : base;
}

describe("Finaliser reads the SHARED global store and merges every changeRef (AC4)", () => {
  const CID = "run-finaliser-agg-001";

  function aggregateAllAgents(): Record<string, unknown> {
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const seeded = readRunState(store, CID)!;
    const s1 = recordAgentResult(seeded, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok", changeRef: { kind: "format-patch", patchBase64: "YmU=" } }));
    const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-frontend", status: "ok", changeRef: { kind: "format-patch", patchBase64: "ZmU=" } }));
    const s3 = recordAgentResult(s2, makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "ok" }));
    writeRunState(store, CID, s3);
    return store;
  }

  test("the Finaliser read-path (readRunState on the shared store) returns the aggregated run, not null", () => {
    const store = aggregateAllAgents();
    expect(readRunState(store, CID)).not.toBeNull();
  });

  test("enumerateAgentResults yields every agent's changeRef for the merge set", () => {
    const store = aggregateAllAgents();
    const runState = readRunState(store, CID)!;
    const changeRefs = enumerateAgentResults(runState)
      .filter((r) => r.changeRef !== undefined)
      .map((r) => r.changeRef!);
    expect(changeRefs).toHaveLength(2);
    expect(changeRefs).toContainEqual({ kind: "format-patch", patchBase64: "YmU=" });
    expect(changeRefs).toContainEqual({ kind: "format-patch", patchBase64: "ZmU=" });
  });

  test("the merge set covers every task even when one carries no changeRef", () => {
    const store = aggregateAllAgents();
    const runState = readRunState(store, CID)!;
    const results = enumerateAgentResults(runState);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.taskId === "T3")?.changeRef).toBeUndefined();
    expect(results.find((r) => r.taskId === "T3")?.status).toBe("done");
  });

  test("a truly-empty global store (zero agents ran) returns null — the genuine-empty guard remains", () => {
    const emptyStore: Record<string, unknown> = {};
    expect(readRunState(emptyStore, "never-seeded")).toBeNull();
  });

  test("the Finaliser does NOT depend on a per-node store: a fresh empty node store has no run, but the shared store does", () => {
    const sharedStore = aggregateAllAgents();
    const isolatedNodeStore: Record<string, unknown> = {};
    expect(readRunState(isolatedNodeStore, CID)).toBeNull();
    expect(readRunState(sharedStore, CID)).not.toBeNull();
  });

  test("R-02: the aggregated run-state carries no credential material the Finaliser would surface", () => {
    const store = aggregateAllAgents();
    const serialised = JSON.stringify(store);
    expect(serialised).not.toMatch(/ghp_[a-zA-Z0-9]+/);
    expect(serialised).not.toContain("anthropicApiKey");
    expect(serialised).not.toContain("githubToken");
    expect(serialised).not.toContain("x-access-token");
  });
});
