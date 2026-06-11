import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { IExecuteFunctions, INodeExecutionData, IDataObject } from "n8n-workflow";
import { initRunState } from "../../../src/orchestration/run-state/transitions";
import { writeRunState, readRunState } from "../../../src/orchestration/run-state/global-store";
import type { OrchestrationTask } from "../../../src/orchestration/run-state/shapes";

beforeAll(() => {
  mock.module("../../../src/execution/single-turn", () => ({
    runAgentTurn: async (env: NodeEnvelope) => ({
      ...env,
      status: "ok",
      result: { text: "implemented" },
    }),
  }));
});

const TASKS: OrchestrationTask[] = [
  { taskId: "T1", name: "Backend", agent: "software-teams-backend", wave: 1, dependsOn: [] },
];

function fanOutItem(taskId: string, agentId: string, correlationId: string): INodeExecutionData {
  return {
    json: {
      correlationId,
      agentId,
      status: "ok",
      input: { prompt: "do it", context: { taskId } },
      result: { text: "" },
      artifacts: [],
    } as unknown as IDataObject,
  };
}

function agentContext(opts: {
  store: Record<string, unknown>;
  nodeName: string;
  specialist: string;
  items: INodeExecutionData[];
}): IExecuteFunctions {
  return {
    getInputData: () => opts.items,
    getNodeParameter: (name: string) => {
      if (name === "specialist") return opts.specialist;
      if (name === "prompt") return "do it";
      if (name === "context") return "";
      if (name === "model") return "claude-sonnet-4-5";
      return "";
    },
    getCredentials: async () => ({ anthropicApiKey: "sk-test", githubToken: undefined }),
    continueOnFail: () => false,
    getNode: () => ({ name: opts.nodeName, type: "softwareTeamsAgent" }),
    getWorkflowStaticData: (scope: string) => {
      expect(scope).toBe("global");
      return opts.store;
    },
  } as unknown as IExecuteFunctions;
}

describe("Agent forward-persist uses the SHARED global store (AC2/AC5)", () => {
  const CID = "run-agent-fp-001";

  test("the Agent node reads workflow static data with the 'global' scope (not 'node')", async () => {
    const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
    const node = new SoftwareTeamsAgent();
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const ctx = agentContext({ store, nodeName: "Agent: Backend", specialist: "software-teams-backend", items: [fanOutItem("T1", "software-teams-backend", CID)] });
    await node.execute.call(ctx);
  });

  test("the wire emit is preserved — the Agent still emits its NodeEnvelope forward (AC5)", async () => {
    const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
    const node = new SoftwareTeamsAgent();
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const ctx = agentContext({ store, nodeName: "Agent: Backend", specialist: "software-teams-backend", items: [fanOutItem("T1", "software-teams-backend", CID)] });

    const result = await node.execute.call(ctx);
    const emitted = result[0]![0]!.json as unknown as NodeEnvelope;
    expect(emitted.correlationId).toBe(CID);
    expect(emitted.agentId).toBe("software-teams-backend");
    for (const key of ["correlationId", "agentId", "status", "input", "result", "artifacts"]) {
      expect(emitted).toHaveProperty(key);
    }
  });

  test("an unseeded run is a safe no-op persist — the Agent does not throw and the store stays empty", async () => {
    const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
    const node = new SoftwareTeamsAgent();
    const store: Record<string, unknown> = {};
    const ctx = agentContext({ store, nodeName: "Agent: Backend", specialist: "software-teams-backend", items: [fanOutItem("T1", "software-teams-backend", "ghost-run")] });

    const result = await node.execute.call(ctx);
    expect(result[0]!.length).toBe(1);
    expect(readRunState(store, "ghost-run")).toBeNull();
  });

  test("AC2 — the terminal envelope retains its taskId so the forward-persist can key on it", async () => {
    const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
    const node = new SoftwareTeamsAgent();
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const ctx = agentContext({ store, nodeName: "Agent: Backend", specialist: "software-teams-backend", items: [fanOutItem("T1", "software-teams-backend", CID)] });

    const emitted = (await node.execute.call(ctx))[0]![0]!.json as unknown as NodeEnvelope;
    const context = emitted.input.context as Record<string, unknown> | null;

    expect(context?.["taskId"]).toBe("T1");
  });

  test("AC2 — after a fan-out task the global run-state records that task as terminal (keyed by correlationId+taskId)", async () => {
    const { SoftwareTeamsAgent } = await import("../SoftwareTeamsAgent.node");
    const node = new SoftwareTeamsAgent();
    const store: Record<string, unknown> = {};
    writeRunState(store, CID, initRunState(CID, TASKS));
    const ctx = agentContext({ store, nodeName: "Agent: Backend", specialist: "software-teams-backend", items: [fanOutItem("T1", "software-teams-backend", CID)] });

    await node.execute.call(ctx);

    const persisted = readRunState(store, CID)!;
    expect(persisted.tasks.find((t) => t.taskId === "T1")?.status).toBe("done");
  });
});
