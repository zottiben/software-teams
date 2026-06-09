/**
 * Unit tests for the `agent-turn` verb (T3 of plan 1-02-n8n-manual-cli).
 *
 * Scope:
 *  - `applyAgentOverride`: pure function — no mocking needed.
 *  - `makeAgentEngine`: verifies the engine function calls `runAgentTurn` with
 *    the correct (possibly overridden) envelope. `runAgentTurn` is mocked via
 *    `mock.module` — no `claude` binary is invoked, no network calls occur.
 *  - contract-conformance: correlationId and artifacts carry-through.
 *
 * Out of scope (covered by T2 tests and T7/T9 integration tests):
 *  - runVerb lifecycle (input resolution, writeResult, exit codes)
 *  - json-purity-gate (subprocess byte-for-byte stdout assertion)
 *  - exit-code-gate (subprocess exit-code assertion)
 *  - Task tool exclusion (asserted by the existing single-turn engine tests)
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { NodeEnvelope } from "../../contract/envelope";

// ── Mock `runAgentTurn` before importing the module under test ────────────────
// `mock.module` is hoisted by Bun's test runner before ESM imports, ensuring
// the agent-turn module receives the mock when it imports single-turn.ts.
// This prevents any attempt to spawn the `claude` binary (no binary, no network).

const mockRunAgentTurn = mock(async (env: NodeEnvelope): Promise<NodeEnvelope> => ({
  ...env,
  status: "ok",
  result: { text: "mocked agent response" },
}));

mock.module("../../../../n8n/src/execution/single-turn", () => ({
  runAgentTurn: mockRunAgentTurn,
  SINGLE_TURN_ALLOWED_TOOLS: [],
}));

// Static import — Bun hoists `mock.module` before ESM imports, so the module
// under test will receive the mock when it resolves single-turn.ts.
import { applyAgentOverride, makeAgentEngine } from "../agent-turn";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "test-run-001",
    agentId: "software-teams-backend",
    status: "ok",
    input: { prompt: "Do the thing", context: null },
    result: { text: "Done." },
    artifacts: [],
    ...overrides,
  };
}

// ─── applyAgentOverride ───────────────────────────────────────────────────────

describe("applyAgentOverride", () => {
  test("returns the same reference when agentOverride is undefined", () => {
    const env = makeEnvelope();
    expect(applyAgentOverride(env, undefined)).toBe(env);
  });

  test("returns the same reference when agentOverride is an empty string (falsy → no override)", () => {
    const env = makeEnvelope();
    expect(applyAgentOverride(env, "")).toBe(env);
  });

  test("overrides agentId when a non-empty override is provided", () => {
    const env = makeEnvelope({ agentId: "software-teams-backend" });
    const result = applyAgentOverride(env, "software-teams-frontend");
    expect(result.agentId).toBe("software-teams-frontend");
  });

  test("returns a NEW envelope object — does not mutate the original", () => {
    const env = makeEnvelope({ agentId: "original" });
    const result = applyAgentOverride(env, "override");
    expect(result).not.toBe(env);
    expect(env.agentId).toBe("original"); // original is unchanged
  });

  test("preserves all other fields when overriding agentId", () => {
    const env = makeEnvelope({ agentId: "old-agent", status: "needs-input" });
    const result = applyAgentOverride(env, "new-agent");
    expect(result.correlationId).toBe(env.correlationId);
    expect(result.status).toBe("needs-input");
    expect(result.input).toBe(env.input);
    expect(result.result).toBe(env.result);
    expect(result.artifacts).toBe(env.artifacts);
  });
});

// ─── makeAgentEngine — reuse-check gate ──────────────────────────────────────
// Verifies that the engine function is pure wiring: it calls runAgentTurn
// exactly once with the (possibly overridden) envelope. No engine logic is
// re-implemented in agent-turn.ts itself.

describe("makeAgentEngine — engine call (reuse-check gate)", () => {
  beforeEach(() => {
    mockRunAgentTurn.mockClear();
  });

  test("calls runAgentTurn exactly once with the input envelope (no override)", async () => {
    const env = makeEnvelope();
    await makeAgentEngine(undefined)(env);
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    expect(mockRunAgentTurn).toHaveBeenCalledWith(env);
  });

  test("passes the original envelope reference unchanged when no agent override", async () => {
    const env = makeEnvelope({ agentId: "software-teams-qa-tester" });
    await makeAgentEngine(undefined)(env);
    const calledWith = mockRunAgentTurn.mock.calls[0]![0] as NodeEnvelope;
    expect(calledWith).toBe(env); // same reference — no copy was made
  });

  test("calls runAgentTurn with overridden agentId when --agent is set", async () => {
    const env = makeEnvelope({ agentId: "software-teams-backend" });
    await makeAgentEngine("software-teams-frontend")(env);
    expect(mockRunAgentTurn).toHaveBeenCalledTimes(1);
    const calledWith = mockRunAgentTurn.mock.calls[0]![0] as NodeEnvelope;
    expect(calledWith.agentId).toBe("software-teams-frontend");
  });

  test("returns the envelope from runAgentTurn (pass-through — no result mutation)", async () => {
    const env = makeEnvelope();
    const expected: NodeEnvelope = {
      ...env,
      status: "ok",
      result: { text: "specialist work complete" },
    };
    mockRunAgentTurn.mockResolvedValueOnce(expected);
    const result = await makeAgentEngine(undefined)(env);
    expect(result).toBe(expected);
  });

  test("propagates status:error from engine (e.g. missing claude binary → exit 1 via runVerb)", async () => {
    const env = makeEnvelope();
    const errorEnv: NodeEnvelope = {
      ...env,
      status: "error",
      result: {
        text:
          "Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code " +
          "and ensure the binary is on PATH.",
      },
    };
    mockRunAgentTurn.mockResolvedValueOnce(errorEnv);
    const result = await makeAgentEngine(undefined)(env);
    expect(result.status).toBe("error");
    expect(result.result.text).toContain("Claude CLI not found");
  });

  test("propagates status:needs-input (HITL park — exit 0 via runVerb, not an error)", async () => {
    const env = makeEnvelope();
    const needsInputEnv: NodeEnvelope = {
      ...env,
      status: "needs-input",
      result: { text: "Waiting for human approval on the migration plan." },
    };
    mockRunAgentTurn.mockResolvedValueOnce(needsInputEnv);
    const result = await makeAgentEngine(undefined)(env);
    expect(result.status).toBe("needs-input");
  });
});

// ─── contract-conformance — correlationId and artifacts carry-through ─────────

describe("contract-conformance — correlationId and artifacts carry-through", () => {
  beforeEach(() => {
    mockRunAgentTurn.mockClear();
  });

  test("correlationId from the input envelope is forwarded to runAgentTurn", async () => {
    const env = makeEnvelope({ correlationId: "unique-session-abc123" });
    mockRunAgentTurn.mockImplementationOnce(async (e: NodeEnvelope) => ({
      ...e,
      status: "ok" as const,
      result: { text: "done" },
    }));
    const result = await makeAgentEngine(undefined)(env);
    expect(result.correlationId).toBe("unique-session-abc123");
  });

  test("correlationId is preserved when --agent override is applied", async () => {
    const env = makeEnvelope({ correlationId: "run-xyz", agentId: "agent-a" });
    mockRunAgentTurn.mockImplementationOnce(async (e: NodeEnvelope) => ({
      ...e,
      status: "ok" as const,
      result: { text: "done" },
    }));
    const result = await makeAgentEngine("agent-b")(env);
    expect(result.correlationId).toBe("run-xyz");
    // agentId override is applied
    const calledWith = mockRunAgentTurn.mock.calls[0]![0] as NodeEnvelope;
    expect(calledWith.agentId).toBe("agent-b");
  });

  test("artifacts array is forwarded to runAgentTurn and not dropped", async () => {
    const env = makeEnvelope({
      artifacts: [{ type: "pr", url: "https://github.com/org/repo/pull/42" }],
    });
    mockRunAgentTurn.mockImplementationOnce(async (e: NodeEnvelope) => ({
      ...e,
      status: "ok" as const,
      result: { text: "done" },
    }));
    const result = await makeAgentEngine(undefined)(env);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.url).toBe("https://github.com/org/repo/pull/42");
  });

  test("empty artifacts array is preserved (never undefined)", async () => {
    const env = makeEnvelope({ artifacts: [] });
    mockRunAgentTurn.mockImplementationOnce(async (e: NodeEnvelope) => ({
      ...e,
      status: "ok" as const,
      result: { text: "done" },
    }));
    const result = await makeAgentEngine(undefined)(env);
    expect(Array.isArray(result.artifacts)).toBe(true);
    expect(result.artifacts).toHaveLength(0);
  });
});
