import { describe, test, expect } from "bun:test";
import type { NodeEnvelope, ChangeRef } from "@websitelabs/software-teams";
import type {
  IExecuteFunctions,
  IDataObject,
} from "n8n-workflow";
import { initRunState, recordAgentResult, enumerateAgentResults } from "../transitions";
import { readRunState, writeRunState } from "../global-store";
import type { OrchestrationTask } from "../shapes";

class FaithfulStaticDataHost {
  private readonly globalStore: Record<string, unknown> = {};
  private readonly nodeStores: Map<string, Record<string, unknown>> = new Map();

  resolve(scope: string, nodeName: string): Record<string, unknown> {
    if (scope === "global") {
      return this.globalStore;
    }
    const existing = this.nodeStores.get(nodeName);
    if (existing !== undefined) {
      return existing;
    }
    const fresh: Record<string, unknown> = {};
    this.nodeStores.set(nodeName, fresh);
    return fresh;
  }
}

const TASKS: OrchestrationTask[] = [
  { taskId: "T1", name: "Backend", agent: "software-teams-backend", wave: 1, dependsOn: [] },
  { taskId: "T2", name: "Frontend", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
  { taskId: "T3", name: "QA", agent: "software-teams-qa-tester", wave: 2, dependsOn: ["T1", "T2"] },
];

const CHANGE_REFS: Record<string, ChangeRef> = {
  T1: { kind: "format-patch", patchBase64: "YmFja2VuZA==" },
  T2: { kind: "format-patch", patchBase64: "ZnJvbnRlbmQ=" },
};

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
    input: { prompt: "do it", context: { taskId: opts.taskId } },
    result: { text: opts.status === "ok" ? "done" : "blocked" },
    artifacts: [],
  };
  return opts.changeRef !== undefined ? { ...base, changeRef: opts.changeRef } : base;
}

function persistFromNode(host: FaithfulStaticDataHost, nodeName: string, env: NodeEnvelope): void {
  const store = host.resolve("global", nodeName);
  const state = readRunState(store, env.correlationId);
  if (state === null) {
    return;
  }
  writeRunState(store, env.correlationId, recordAgentResult(state, env));
}

function summaryContext(opts: {
  host: FaithfulStaticDataHost;
  nodeName: string;
  correlationId: string;
}): IExecuteFunctions {
  return {
    getInputData: () => [{ json: {} as IDataObject }],
    getNodeParameter: (name: string) => {
      if (name === "operation") return "summary";
      if (name === "correlationId") return opts.correlationId;
      return "";
    },
    getCredentials: async () => ({ anthropicApiKey: "sk-test", githubToken: undefined }),
    continueOnFail: () => false,
    getNode: () => ({ name: opts.nodeName, type: "softwareTeamsOrchestrator" }),
    getWorkflowStaticData: (scope: string) => opts.host.resolve(scope, opts.nodeName),
  } as unknown as IExecuteFunctions;
}

describe("aggregation-fidelity gate — distinct per-node static data (R-26, AC6)", () => {
  const CID = "run-fidelity-001";

  describe("the host double models n8n per-node isolation faithfully (R-26)", () => {
    test("'node' scope returns DISTINCT objects for distinct node names", () => {
      const host = new FaithfulStaticDataHost();
      const a = host.resolve("node", "Agent: Backend");
      const b = host.resolve("node", "Agent: Frontend");
      a["seen"] = true;
      expect(b["seen"]).toBeUndefined();
      expect(a).not.toBe(b);
    });

    test("'global' scope returns ONE shared object across distinct node names", () => {
      const host = new FaithfulStaticDataHost();
      const a = host.resolve("global", "Agent: Backend");
      const b = host.resolve("global", "Orchestrator");
      a["seen"] = true;
      expect(b["seen"]).toBe(true);
      expect(a).toBe(b);
    });

    test("a 'node'-scoped read can NEVER see what a different node wrote (the Gap A root cause)", () => {
      const host = new FaithfulStaticDataHost();
      writeRunState(host.resolve("node", "Agent: Backend"), CID, initRunState(CID, TASKS));
      expect(readRunState(host.resolve("node", "Software Teams Finaliser"), CID)).toBeNull();
    });
  });

  describe("Gap A works FORWARD across DISTINCT nodes via the shared 'global' store", () => {
    test("two distinct Agent nodes persist forward into the SAME global run-state the Finaliser reads", () => {
      const host = new FaithfulStaticDataHost();
      writeRunState(host.resolve("global", "Orchestrator"), CID, initRunState(CID, TASKS));

      persistFromNode(host, "Agent: Backend", makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok", changeRef: CHANGE_REFS.T1 }));
      persistFromNode(host, "Agent: Frontend", makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-frontend", status: "ok", changeRef: CHANGE_REFS.T2 }));

      const aggregated = readRunState(host.resolve("global", "Software Teams Finaliser"), CID)!;
      const results = enumerateAgentResults(aggregated);
      expect(results.find((r) => r.taskId === "T1")?.status).toBe("done");
      expect(results.find((r) => r.taskId === "T2")?.status).toBe("done");
      const changeRefs = results.filter((r) => r.changeRef !== undefined).map((r) => r.changeRef);
      expect(changeRefs).toHaveLength(2);
    });

    test("the summary Orchestrator (a DISTINCT node) reports each specialist — NOT 'No run-state found'", async () => {
      const host = new FaithfulStaticDataHost();
      writeRunState(host.resolve("global", "Orchestrator"), CID, initRunState(CID, TASKS));
      persistFromNode(host, "Agent: Backend", makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok" }));
      persistFromNode(host, "Agent: Frontend", makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-frontend", status: "ok" }));

      const { SoftwareTeamsOrchestrator } = await import(
        "../../../../nodes/SoftwareTeamsOrchestrator/SoftwareTeamsOrchestrator.node"
      );
      const node = new SoftwareTeamsOrchestrator();
      const ctx = summaryContext({ host, nodeName: "Orchestrator: Run Summary", correlationId: CID });
      const summary = (await node.execute.call(ctx))[0]![0]!.json["summary"] as string;

      expect(summary).toContain("software-teams-backend");
      expect(summary).toContain("software-teams-frontend");
      expect(summary.toLowerCase()).not.toContain("no run-state found");
    });
  });

  describe("the gate FAILS on a regression to per-node isolation (the forbidden mock)", () => {
    test("a 'node'-scoped read of the global-aggregated run-state finds NOTHING; the 'global' read finds it", () => {
      const host = new FaithfulStaticDataHost();
      writeRunState(host.resolve("global", "Orchestrator"), CID, initRunState(CID, TASKS));
      persistFromNode(host, "Agent: Backend", makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok" }));

      expect(readRunState(host.resolve("node", "Software Teams Finaliser"), CID)).toBeNull();
      expect(readRunState(host.resolve("global", "Software Teams Finaliser"), CID)).not.toBeNull();
    });

    test("the summary node reading a per-node-isolated store would report 'No run-state found' (the regression signature)", async () => {
      const host = new FaithfulStaticDataHost();
      writeRunState(host.resolve("node", "Agent: Backend"), CID, recordAgentResult(initRunState(CID, TASKS), makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-backend", status: "ok" })));

      const { SoftwareTeamsOrchestrator } = await import(
        "../../../../nodes/SoftwareTeamsOrchestrator/SoftwareTeamsOrchestrator.node"
      );
      const node = new SoftwareTeamsOrchestrator();
      const ctx = summaryContext({ host, nodeName: "Orchestrator: Run Summary", correlationId: CID });
      const summary = (await node.execute.call(ctx))[0]![0]!.json["summary"] as string;
      expect(summary.toLowerCase()).toContain("no run-state found");
    });
  });
});
