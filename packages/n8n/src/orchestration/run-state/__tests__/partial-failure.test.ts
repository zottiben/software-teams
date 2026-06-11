import { describe, test, expect } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import { initRunState, recordAgentResult, summarise, enumerateAgentResults } from "../transitions";
import { writeRunState, readRunState } from "../global-store";
import type { OrchestrationTask } from "../shapes";

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
}): NodeEnvelope {
  return {
    correlationId: opts.correlationId,
    agentId: opts.agentId,
    status: opts.status,
    input: { prompt: "task", context: { taskId: opts.taskId } },
    result: { text: opts.status === "ok" ? "done" : "blocked" },
    artifacts: [],
  };
}

describe("partial-failure aggregation across the shared store (R-05)", () => {
  const CID = "run-partial-001";

  function aggregateMixed(): Record<string, unknown> {
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const seeded = readRunState(store, CID)!;
    const s1 = recordAgentResult(seeded, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok" }));
    const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-frontend", status: "error" }));
    const s3 = recordAgentResult(s2, makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "needs-input" }));
    writeRunState(store, CID, s3);
    return store;
  }

  test("a mix of done / error / needs-input aggregates into the shared store correctly", () => {
    const runState = readRunState(aggregateMixed(), CID)!;
    const results = enumerateAgentResults(runState);
    expect(results.find((r) => r.taskId === "T1")?.status).toBe("done");
    expect(results.find((r) => r.taskId === "T2")?.status).toBe("error");
    expect(results.find((r) => r.taskId === "T3")?.status).toBe("needs-input");
  });

  test("summarise reports the run as resumable (not complete) when work remains", () => {
    const runState = readRunState(aggregateMixed(), CID)!;
    const summary = summarise(runState);
    expect(summary.complete).toBeFalse();
    expect(summary.resumable).toBeTrue();
    expect(summary.done).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.needsInput).toBe(1);
  });

  test("a fully-done run reports complete and not resumable", () => {
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const seeded = readRunState(store, CID)!;
    const s1 = recordAgentResult(seeded, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok" }));
    const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-frontend", status: "ok" }));
    const s3 = recordAgentResult(s2, makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "ok" }));
    writeRunState(store, CID, s3);

    const summary = summarise(readRunState(store, CID)!);
    expect(summary.complete).toBeTrue();
    expect(summary.resumable).toBeFalse();
    expect(summary.done).toBe(3);
  });

  test("an all-pending seeded run (no agent has run) is resumable, not complete", () => {
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const summary = summarise(readRunState(store, CID)!);
    expect(summary.complete).toBeFalse();
    expect(summary.resumable).toBeTrue();
    expect(summary.pending).toBe(3);
  });
});
