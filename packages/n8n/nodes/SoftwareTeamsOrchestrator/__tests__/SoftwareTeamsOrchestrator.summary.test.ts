import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import type {
  IExecuteFunctions,
  INodeExecutionData,
  IDataObject,
} from "n8n-workflow";
import {
  initRunState,
  recordAgentResult,
  serialiseRunState,
} from "../../../src/orchestration/run-state";
import type { OrchestrationTask } from "../../../src/orchestration/run-state";

beforeAll(() => {
  mock.module("../../src/execution/single-turn", () => ({
    runAgentTurn: async (env: NodeEnvelope) => ({
      ...env,
      status: "ok",
      result: { text: "mocked-plan" },
    }),
  }));
});

const TASKS: OrchestrationTask[] = [
  { taskId: "T1", name: "Build UI", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
  { taskId: "T2", name: "Add API", agent: "software-teams-backend", wave: 1, dependsOn: [] },
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
    result: { text: opts.status === "ok" ? "completed" : "failed" },
    artifacts: [],
  };
}

function makeItem(json: Record<string, unknown>): INodeExecutionData {
  return { json: json as IDataObject };
}

function makeSummaryContext(opts: {
  staticRuns: Record<string, unknown>;
  correlationIdParam?: string;
  upstreamItem?: INodeExecutionData;
}): IExecuteFunctions {
  const staticData: IDataObject = { runs: opts.staticRuns as IDataObject };
  const upstreamItems: INodeExecutionData[] = opts.upstreamItem ? [opts.upstreamItem] : [makeItem({})];

  return {
    getInputData: () => upstreamItems,
    getNodeParameter: (name: string) => {
      if (name === "operation") return "summary";
      if (name === "correlationId") return opts.correlationIdParam ?? "";
      if (name === "epic") return "";
      if (name === "model") return "claude-sonnet-4-5";
      return "";
    },
    getCredentials: async () => ({
      anthropicApiKey: "sk-test",
      githubToken: undefined,
    }),
    continueOnFail: () => false,
    getNode: () => ({ name: "SoftwareTeamsOrchestrator", type: "softwareTeamsOrchestrator" }),
    getWorkflowStaticData: (_scope: string) => staticData,
  } as unknown as IExecuteFunctions;
}

describe("SoftwareTeamsOrchestrator summary mode (AC10, AC11 — T7)", () => {
  const CID = "run-summary-test-001";

  describe("summary mode: reads run-state and emits per-agent human summary", () => {
    test("emits exactly one item in summary mode", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const s1 = recordAgentResult(state, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" }));
      const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "ok" }));
      const s3 = recordAgentResult(s2, makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "ok" }));

      const runs: Record<string, unknown> = { [CID]: serialiseRunState(s3) };
      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
    });

    test("emitted item has operation='summary' and correlationId", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const runs: Record<string, unknown> = { [CID]: serialiseRunState(state) };
      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });

      const result = await node.execute.call(ctx);
      const item = result[0]![0]!;
      expect(item.json["operation"]).toBe("summary");
      expect(item.json["correlationId"]).toBe(CID);
    });

    test("summary text names each agent's work", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const s1 = recordAgentResult(state, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" }));
      const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "ok" }));
      const runs: Record<string, unknown> = { [CID]: serialiseRunState(s2) };
      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });

      const result = await node.execute.call(ctx);
      const summary = result[0]![0]!.json["summary"] as string;
      expect(summary).toContain("software-teams-frontend");
      expect(summary).toContain("software-teams-backend");
      expect(summary).toContain("T1");
      expect(summary).toContain("T2");
    });

    test("agentResults array contains one entry per task", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const runs: Record<string, unknown> = { [CID]: serialiseRunState(state) };
      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });

      const result = await node.execute.call(ctx);
      const agentResults = result[0]![0]!.json["agentResults"] as unknown[];
      expect(Array.isArray(agentResults)).toBeTrue();
      expect(agentResults.length).toBe(TASKS.length);
    });

    test("full run — summary reports all done", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const s1 = recordAgentResult(state, makeEnvelope({ correlationId: CID, taskId: "T1", agentId: "software-teams-frontend", status: "ok" }));
      const s2 = recordAgentResult(s1, makeEnvelope({ correlationId: CID, taskId: "T2", agentId: "software-teams-backend", status: "ok" }));
      const s3 = recordAgentResult(s2, makeEnvelope({ correlationId: CID, taskId: "T3", agentId: "software-teams-qa-tester", status: "ok" }));
      const runs: Record<string, unknown> = { [CID]: serialiseRunState(s3) };
      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });

      const result = await node.execute.call(ctx);
      const summary = result[0]![0]!.json["summary"] as string;
      expect(summary).toContain("done");
      expect(summary).toContain("complete");
    });
  });

  describe("correlationId resolution: upstream envelope takes precedence", () => {
    test("resolves correlationId from upstream NodeEnvelope when present", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const runs: Record<string, unknown> = { [CID]: serialiseRunState(state) };

      const upstreamEnvelopeItem = makeItem({
        correlationId: CID,
        agentId: "software-teams-frontend",
        status: "ok",
        input: { prompt: "p", context: null },
        result: { text: "r" },
        artifacts: [],
      });

      const ctx = makeSummaryContext({
        staticRuns: runs,
        correlationIdParam: "should-be-ignored",
        upstreamItem: upstreamEnvelopeItem,
      });

      const result = await node.execute.call(ctx);
      const item = result[0]![0]!;
      expect(item.json["correlationId"]).toBe(CID);
    });
  });

  describe("empty / absent run-state: graceful summary, no throw (AC10)", () => {
    test("empty runs object — summary emitted without throwing", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const ctx = makeSummaryContext({ staticRuns: {}, correlationIdParam: "nonexistent-id" });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
    });

    test("absent run-state yields a non-empty summary string (not a throw)", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const ctx = makeSummaryContext({ staticRuns: {}, correlationIdParam: "nonexistent-id" });

      const result = await node.execute.call(ctx);
      const summary = result[0]![0]!.json["summary"] as string;
      expect(typeof summary).toBe("string");
      expect(summary.length).toBeGreaterThan(0);
    });

    test("absent run-state summary mentions 'No run-state' message", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const ctx = makeSummaryContext({ staticRuns: {}, correlationIdParam: "ghost-run" });

      const result = await node.execute.call(ctx);
      const summary = result[0]![0]!.json["summary"] as string;
      expect(summary.toLowerCase()).toContain("no run-state");
    });

    test("agentResults is an empty array when no run-state found", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const ctx = makeSummaryContext({ staticRuns: {}, correlationIdParam: "ghost-run" });

      const result = await node.execute.call(ctx);
      const agentResults = result[0]![0]!.json["agentResults"] as unknown[];
      expect(Array.isArray(agentResults)).toBeTrue();
      expect(agentResults.length).toBe(0);
    });
  });

  describe("DAG-safe: no Agent→Orchestrator return edge (AC11)", () => {
    test("summary path does NOT write back to runs[correlationId]", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const serialised = serialiseRunState(state);
      const runs: Record<string, unknown> = { [CID]: serialised };

      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });
      await node.execute.call(ctx);

      expect(JSON.stringify(runs[CID])).toBe(JSON.stringify(serialised));
    });

    test("summary output item has no 'agentId' field (not masquerading as an agent envelope)", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const state = initRunState(CID, TASKS);
      const runs: Record<string, unknown> = { [CID]: serialiseRunState(state) };
      const ctx = makeSummaryContext({ staticRuns: runs, correlationIdParam: CID });

      const result = await node.execute.call(ctx);
      const item = result[0]![0]!;
      expect(item.json["agentId"]).toBeUndefined();
    });
  });

  describe("plan mode: behaves as before (back-compat, AC11)", () => {
    test("operation='plan' node description still includes 'plan' option", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const opProp = node.description.properties.find((p) => p.name === "operation");
      expect(opProp).toBeDefined();
      const options = (opProp as { options: Array<{ value: string }> }).options;
      const values = options.map((o) => o.value);
      expect(values).toContain("plan");
      expect(values).toContain("summary");
    });

    test("'plan' is the default operation", async () => {
      const { SoftwareTeamsOrchestrator } = await import("../SoftwareTeamsOrchestrator.node");
      const node = new SoftwareTeamsOrchestrator();

      const opProp = node.description.properties.find((p) => p.name === "operation");
      expect((opProp as { default: string }).default).toBe("plan");
    });
  });
});
