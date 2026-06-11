import { describe, test, expect } from "bun:test";
import type { NodeEnvelope, ChangeRef } from "@websitelabs/software-teams";
import type { IExecuteFunctions, IDataObject } from "n8n-workflow";
import { initRunState, recordAgentResult } from "../transitions";
import { readRunState, writeRunState } from "../global-store";
import { serialiseRunState } from "../persistence";
import type { OrchestrationTask } from "../shapes";

const ANTHROPIC_API_KEY = "sk-ant-secret-DO-NOT-LEAK-0123456789";
const GITHUB_TOKEN = "ghp_secretTokenDoNotLeak0123456789ABCDEF";
const TOKEN_BEARING_URL = `https://x-access-token:${GITHUB_TOKEN}@github.com/acme/widgets.git`;

const SECRETS: ReadonlyArray<string> = [
  ANTHROPIC_API_KEY,
  GITHUB_TOKEN,
  TOKEN_BEARING_URL,
  "x-access-token:",
];

const TASKS: OrchestrationTask[] = [
  { taskId: "T1", name: "Backend", agent: "software-teams-backend", wave: 1, dependsOn: [] },
  { taskId: "T2", name: "Frontend", agent: "software-teams-frontend", wave: 1, dependsOn: [] },
];

const CHANGE_REFS: Record<string, ChangeRef> = {
  T1: { kind: "format-patch", patchBase64: "YmFja2VuZA==" },
  T2: { kind: "format-patch", patchBase64: "ZnJvbnRlbmQ=" },
};

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

function makeEnvelope(opts: {
  correlationId: string;
  taskId: string;
  agentId: string;
  changeRef?: ChangeRef;
}): NodeEnvelope {
  const base: NodeEnvelope = {
    correlationId: opts.correlationId,
    agentId: opts.agentId,
    status: "ok",
    input: { prompt: "do it", context: { taskId: opts.taskId } },
    result: { text: "done" },
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
    getCredentials: async () => ({
      anthropicApiKey: ANTHROPIC_API_KEY,
      githubToken: GITHUB_TOKEN,
    }),
    continueOnFail: () => false,
    getNode: () => ({ name: opts.nodeName, type: "softwareTeamsOrchestrator" }),
    getWorkflowStaticData: (scope: string) => opts.host.resolve(scope, opts.nodeName),
  } as unknown as IExecuteFunctions;
}

function assertNoSecret(haystack: string): void {
  for (const secret of SECRETS) {
    expect(haystack).not.toContain(secret);
  }
}

function aggregatedRun(host: FaithfulStaticDataHost, cid: string): void {
  writeRunState(host.resolve("global", "Orchestrator"), cid, initRunState(cid, TASKS));
  persistFromNode(host, "Agent: Backend", makeEnvelope({ correlationId: cid, taskId: "T1", agentId: "software-teams-backend", changeRef: CHANGE_REFS.T1 }));
  persistFromNode(host, "Agent: Frontend", makeEnvelope({ correlationId: cid, taskId: "T2", agentId: "software-teams-frontend", changeRef: CHANGE_REFS.T2 }));
}

describe("secret-safety gate — no credential aggregates into the shared surfaces (R-02, AC12)", () => {
  const CID = "run-secret-001";

  test("serialised run-state carries no ANTHROPIC_API_KEY / githubToken / token-bearing URL", () => {
    const host = new FaithfulStaticDataHost();
    aggregatedRun(host, CID);
    const state = readRunState(host.resolve("global", "Software Teams Finaliser"), CID)!;
    assertNoSecret(JSON.stringify(serialiseRunState(state)));
  });

  test("the global static-data store holds no credential after agents persist forward", () => {
    const host = new FaithfulStaticDataHost();
    aggregatedRun(host, CID);
    assertNoSecret(JSON.stringify(host.resolve("global", "any-node")));
  });

  test("the Orchestrator summary envelope leaks no credential even with secret-bearing credentials", async () => {
    const host = new FaithfulStaticDataHost();
    aggregatedRun(host, CID);

    const { SoftwareTeamsOrchestrator } = await import(
      "../../../../nodes/SoftwareTeamsOrchestrator/SoftwareTeamsOrchestrator.node"
    );
    const node = new SoftwareTeamsOrchestrator();
    const ctx = summaryContext({ host, nodeName: "Orchestrator: Run Summary", correlationId: CID });
    const out = (await node.execute.call(ctx))[0]![0]!.json;

    assertNoSecret(JSON.stringify(out));
    assertNoSecret(JSON.stringify(host.resolve("global", "Orchestrator: Run Summary")));
  });

  test("the gate FAILS if a credential is introduced into the aggregation surface", () => {
    const host = new FaithfulStaticDataHost();
    aggregatedRun(host, CID);
    const store = host.resolve("global", "Software Teams Finaliser");
    const leaked = serialiseRunState(readRunState(store, CID)!);
    store["runs"] = { [CID]: { ...leaked, leakedCloneUrl: TOKEN_BEARING_URL } };
    expect(() => assertNoSecret(JSON.stringify(host.resolve("global", "x")))).toThrow();
  });
});
