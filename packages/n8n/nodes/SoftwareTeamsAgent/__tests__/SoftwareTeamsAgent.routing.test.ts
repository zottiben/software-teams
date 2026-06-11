import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import type {
  IExecuteFunctions,
  INodeExecutionData,
  IDataObject,
} from "n8n-workflow";

const MOCK_RESULT: NodeEnvelope = {
  correlationId: "run-routing-001",
  agentId: "software-teams-frontend",
  status: "ok",
  input: { prompt: "do the thing", context: null },
  result: { text: "done" },
  artifacts: [],
};

beforeAll(() => {
  mock.module("../../../src/execution/single-turn", () => ({
    runAgentTurn: async (env: NodeEnvelope) => ({
      ...env,
      status: "ok",
      result: { text: "mocked" },
    }),
  }));
});

function makeItem(json: Record<string, unknown>): INodeExecutionData {
  return { json: json as IDataObject };
}

function makeMockContext(opts: {
  items: INodeExecutionData[];
  specialist: string;
  continueOnFail?: boolean;
}): IExecuteFunctions {
  const nodeParams: Record<string, string> = {
    specialist: opts.specialist,
    prompt: "do the thing",
    context: "",
    model: "claude-sonnet-4-5",
  };

  return {
    getInputData: () => opts.items,
    getNodeParameter: (name: string) => nodeParams[name] ?? "",
    getCredentials: async () => ({
      anthropicApiKey: "sk-test",
      githubToken: undefined,
    }),
    continueOnFail: () => opts.continueOnFail ?? false,
    getNode: () => ({ name: "SoftwareTeamsAgent", type: "softwareTeamsAgent" }),
    getWorkflowStaticData: () => ({}),
  } as unknown as IExecuteFunctions;
}

function makeEnvelope(agentId: string, correlationId = "run-routing-001"): Record<string, unknown> {
  return {
    correlationId,
    agentId,
    status: "ok",
    input: { prompt: "upstream task", context: null },
    result: { text: "upstream done" },
    artifacts: [],
  };
}

describe("SoftwareTeamsAgent routing (AC8, AC9 — T7)", () => {
  describe("matched agentId: item is processed and emitted", () => {
    test("item tagged with the node's configured specialist is emitted", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const item = makeItem(makeEnvelope("software-teams-frontend"));
      const ctx = makeMockContext({
        items: [item],
        specialist: "software-teams-frontend",
      });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData).toBeDefined();
      expect(returnData!.length).toBe(1);
      expect(returnData![0]!.json["correlationId"]).toBe("run-routing-001");
    });

    test("matched item agentId in emitted envelope is the configured specialist", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const item = makeItem(makeEnvelope("software-teams-backend"));
      const ctx = makeMockContext({
        items: [item],
        specialist: "software-teams-backend",
      });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
      expect(returnData![0]!.json["agentId"]).toBe("software-teams-backend");
    });
  });

  describe("non-matched agentId: item is NOT processed and NOT emitted (AC8)", () => {
    test("item tagged agentId=Y skipped when node configured for specialist=X", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const item = makeItem(makeEnvelope("software-teams-backend"));
      const ctx = makeMockContext({
        items: [item],
        specialist: "software-teams-frontend",
      });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(0);
    });

    test("non-matched item with a different agentId is never in returnData", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const item = makeItem(makeEnvelope("software-teams-qa-tester"));
      const ctx = makeMockContext({
        items: [item],
        specialist: "software-teams-programmer",
      });

      const result = await node.execute.call(ctx);
      expect(result[0]!.length).toBe(0);
    });
  });

  describe("mixed batch: only matched item is emitted (routing matrix)", () => {
    test("two items, one matching one not — only the matched item is emitted", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const matchedItem = makeItem(makeEnvelope("software-teams-frontend", "run-match"));
      const skippedItem = makeItem(makeEnvelope("software-teams-backend", "run-skip"));

      const ctx = makeMockContext({
        items: [matchedItem, skippedItem],
        specialist: "software-teams-frontend",
      });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
      expect(returnData![0]!.json["correlationId"]).toBe("run-match");
    });
  });

  describe("no agentId: back-compat (AC9)", () => {
    test("item with no agentId field is processed exactly as today (no skip)", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const freshItem = makeItem({
        someArbitraryKey: "some-value",
      });

      const ctx = makeMockContext({
        items: [freshItem],
        specialist: "software-teams-frontend",
      });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
    });

    test("item with empty agentId string is processed (not skipped)", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const item = makeItem({ agentId: "" });
      const ctx = makeMockContext({
        items: [item],
        specialist: "software-teams-frontend",
      });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
    });

    test("no-input item list (zero items triggers itemCount=1 path) — processes once", async () => {
      const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
      const node = new SoftwareTeamsAgent();

      const ctx = makeMockContext({ items: [], specialist: "software-teams-programmer" });

      const result = await node.execute.call(ctx);
      const returnData = result[0];
      expect(returnData!.length).toBe(1);
    });
  });
});
