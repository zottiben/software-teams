/**
 * Unit tests for orchestrator-turn verb (T4 — plan 1-02-n8n-manual-cli).
 *
 * The adapter is mocked so no `claude` binary or network is required.
 * Tests assert:
 *   R-04 — wiring shape: the output envelope carries result.context.tasks
 *           (per-task NodeEnvelopes) and result.context.runState (serialised
 *           run state), with result.text holding a readable breakdown.
 *   R-05 — stable correlationId: the input envelope's id is reused verbatim
 *           and flows through every per-task envelope in result.context.tasks.
 *
 * Coverage (from T4 Verification checklist):
 *   ✓ ok path: status ok, waved breakdown in result.text, tasks in
 *     result.context.tasks, runState in result.context.runState
 *   ✓ correlationId carry-through: output and every per-task envelope use the
 *     input envelope's correlationId (R-05)
 *   ✓ needs-input path: status needs-input, exit 0 (AC7)
 *   ✓ error path (planEpic throws): status error, exit 1 (AC7)
 *   ✓ --epic override: epicOverride takes precedence over input.prompt
 *   ✓ no-epic path (empty input.prompt + no flag): status error
 */

import { describe, test, expect } from "bun:test";
import type { NodeEnvelope } from "../../../n8n/src/contract/envelope";
import type { AgentTurnAdapter } from "../../../n8n/src/orchestration/run-state";
import { runOrchestratorTurn } from "../orchestrator-turn";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeInputEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "run-abc-123",
    agentId: "software-teams-planner",
    status: "ok",
    input: {
      prompt: "Build a user-facing dashboard for project metrics",
      context: null,
    },
    result: { text: "" },
    artifacts: [],
    ...overrides,
  };
}

/**
 * A valid planner response payload — a JSON array of tasks.
 * Used by the mock adapter to simulate a successful planning turn.
 */
const PLANNER_TASK_JSON = JSON.stringify([
  {
    taskId: "T1",
    name: "Set up project scaffolding",
    agent: "software-teams-backend",
    wave: 1,
    dependsOn: [],
  },
  {
    taskId: "T2",
    name: "Build React dashboard UI",
    agent: "software-teams-frontend",
    wave: 2,
    dependsOn: ["T1"],
  },
]);

/**
 * Mock adapter that returns a successful planner breakdown.
 * The adapter contract matches `AgentTurnAdapter` (NodeEnvelope → Promise<NodeEnvelope>).
 */
function makeOkAdapter(): AgentTurnAdapter {
  return async (input: NodeEnvelope): Promise<NodeEnvelope> => ({
    correlationId: input.correlationId,
    agentId: input.agentId,
    status: "ok",
    input: input.input,
    result: { text: PLANNER_TASK_JSON },
    artifacts: [],
  });
}

/**
 * Mock adapter that returns a `needs-input` planner turn.
 */
function makeNeedsInputAdapter(question: string): AgentTurnAdapter {
  return async (input: NodeEnvelope): Promise<NodeEnvelope> => ({
    correlationId: input.correlationId,
    agentId: input.agentId,
    status: "needs-input",
    input: input.input,
    result: { text: question },
    artifacts: [],
  });
}

/**
 * Mock adapter that returns an `error` planner turn (planEpic will throw).
 */
function makeErrorAdapter(message: string): AgentTurnAdapter {
  return async (input: NodeEnvelope): Promise<NodeEnvelope> => ({
    correlationId: input.correlationId,
    agentId: input.agentId,
    status: "error",
    input: input.input,
    result: { text: message },
    artifacts: [],
  });
}

// ─── Helper to access the additive result.context extension ──────────────────
//
// CLI-RECIPE.md §6: result.context is an additive extension of the CONTRACT.md §1
// result shape (not in the TypeScript type; cast at access time).

interface ExtendedResult {
  text: string;
  context?: {
    tasks: NodeEnvelope[];
    runState: Record<string, unknown>;
  };
}

function getResultContext(env: NodeEnvelope) {
  return (env.result as ExtendedResult).context;
}

// ─── R-04: wiring shape ──────────────────────────────────────────────────────

describe("runOrchestratorTurn — ok path (R-04 wiring shape)", () => {
  test("status is 'ok' on a successful planning turn", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeOkAdapter(),
    );
    expect(result.status).toBe("ok");
  });

  test("result.text contains a human-readable waved breakdown", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeOkAdapter(),
    );
    expect(result.result.text).toContain("Wave 1");
    expect(result.result.text).toContain("Wave 2");
    expect(result.result.text).toContain("T1");
    expect(result.result.text).toContain("T2");
    expect(result.result.text).toContain("software-teams-backend");
    expect(result.result.text).toContain("software-teams-frontend");
  });

  test("result.text includes dependency info for wave-2 task", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeOkAdapter(),
    );
    // T2 depends on T1 — should appear in the breakdown
    expect(result.result.text).toContain("deps: T1");
  });

  test("result.context.tasks is an array of per-task NodeEnvelopes", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeOkAdapter(),
    );
    const ctx = getResultContext(result);
    expect(ctx).toBeDefined();
    expect(Array.isArray(ctx!.tasks)).toBe(true);
    expect(ctx!.tasks).toHaveLength(2);
  });

  test("result.context.tasks items are valid NodeEnvelopes with correct agentId", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeOkAdapter(),
    );
    const ctx = getResultContext(result)!;
    const task1 = ctx.tasks[0]!;
    const task2 = ctx.tasks[1]!;
    // Each task envelope must be a valid NodeEnvelope shape
    expect(typeof task1.correlationId).toBe("string");
    expect(typeof task1.agentId).toBe("string");
    expect(task1.status).toBe("ok");
    // agentId carries the specialist assigned to each task
    expect(task1.agentId).toBe("software-teams-backend"); // T1
    expect(task2.agentId).toBe("software-teams-frontend"); // T2
  });

  test("result.context.runState is a serialised run state with tasks and correlationId", async () => {
    const inputEnv = makeInputEnvelope();
    const result = await runOrchestratorTurn(inputEnv, undefined, makeOkAdapter());
    const ctx = getResultContext(result)!;
    expect(typeof ctx.runState).toBe("object");
    expect(ctx.runState.correlationId).toBe(inputEnv.correlationId);
    expect(Array.isArray(ctx.runState.tasks)).toBe(true);
    expect((ctx.runState.tasks as unknown[]).length).toBe(2);
  });

  test("result.context.runState tasks are all initially pending", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeOkAdapter(),
    );
    const ctx = getResultContext(result)!;
    const tasks = ctx.runState.tasks as Array<{ status: string }>;
    for (const t of tasks) {
      expect(t.status).toBe("pending");
    }
  });

  test("artifacts from the input envelope are carried through unchanged", async () => {
    const input = makeInputEnvelope({
      artifacts: [{ type: "pr", url: "https://github.com/org/repo/pull/1" }],
    });
    const result = await runOrchestratorTurn(input, undefined, makeOkAdapter());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.url).toBe(
      "https://github.com/org/repo/pull/1",
    );
  });
});

// ─── R-05: stable correlationId ─────────────────────────────────────────────

describe("runOrchestratorTurn — correlationId stability (R-05)", () => {
  test("output envelope reuses the input envelope's correlationId", async () => {
    const input = makeInputEnvelope({ correlationId: "stable-run-xyz" });
    const result = await runOrchestratorTurn(input, undefined, makeOkAdapter());
    expect(result.correlationId).toBe("stable-run-xyz");
  });

  test("every per-task envelope in result.context.tasks carries the same correlationId", async () => {
    const input = makeInputEnvelope({ correlationId: "stable-run-xyz" });
    const result = await runOrchestratorTurn(input, undefined, makeOkAdapter());
    const ctx = getResultContext(result)!;
    for (const taskEnv of ctx.tasks) {
      expect(taskEnv.correlationId).toBe("stable-run-xyz");
    }
  });

  test("result.context.runState carries the same correlationId", async () => {
    const input = makeInputEnvelope({ correlationId: "stable-run-xyz" });
    const result = await runOrchestratorTurn(input, undefined, makeOkAdapter());
    const ctx = getResultContext(result)!;
    expect(ctx.runState.correlationId).toBe("stable-run-xyz");
  });

  test("plannerEnvelope passed to adapter carries the same correlationId", async () => {
    // Verify the adapter receives the correct correlationId so planEpic's
    // injected adapter propagates the stable id (R-04 + R-05 wiring check).
    const capturedCorrelationIds: string[] = [];
    const capturingAdapter: AgentTurnAdapter = async (
      input: NodeEnvelope,
    ): Promise<NodeEnvelope> => {
      capturedCorrelationIds.push(input.correlationId);
      return {
        correlationId: input.correlationId,
        agentId: input.agentId,
        status: "ok",
        input: input.input,
        result: { text: PLANNER_TASK_JSON },
        artifacts: [],
      };
    };

    const inputEnv = makeInputEnvelope({ correlationId: "run-captured-001" });
    await runOrchestratorTurn(inputEnv, undefined, capturingAdapter);
    // The adapter must have been called with the input envelope's correlationId
    expect(capturedCorrelationIds).toHaveLength(1);
    expect(capturedCorrelationIds[0]).toBe("run-captured-001");
  });
});

// ─── needs-input path ────────────────────────────────────────────────────────

describe("runOrchestratorTurn — needs-input path", () => {
  test("returns status 'needs-input' when the planner asks for human input", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeNeedsInputAdapter("What is the target deployment environment?"),
    );
    expect(result.status).toBe("needs-input");
  });

  test("result.text carries the planner's question verbatim", async () => {
    const question = "What is the target deployment environment?";
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeNeedsInputAdapter(question),
    );
    expect(result.result.text).toBe(question);
  });

  test("correlationId is preserved on needs-input response (R-05)", async () => {
    const input = makeInputEnvelope({ correlationId: "needs-input-run" });
    const result = await runOrchestratorTurn(
      input,
      undefined,
      makeNeedsInputAdapter("Which database?"),
    );
    expect(result.correlationId).toBe("needs-input-run");
  });

  test("needs-input maps to exit code 0 (AC7 — valid HITL park outcome)", async () => {
    // statusToExitCode is tested in _envelope-io.test.ts; here we confirm the status
    // returned by runOrchestratorTurn is 'needs-input' (which maps to exit 0).
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeNeedsInputAdapter("some question"),
    );
    // 'needs-input' → exit 0 per CLI-RECIPE.md §4
    expect(["ok", "needs-input"]).toContain(result.status);
  });
});

// ─── error path ─────────────────────────────────────────────────────────────

describe("runOrchestratorTurn — error path (planEpic throws)", () => {
  test("returns status 'error' when the planner turn errors", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeErrorAdapter("Planner model unavailable"),
    );
    expect(result.status).toBe("error");
  });

  test("result.text contains the error message", async () => {
    const result = await runOrchestratorTurn(
      makeInputEnvelope(),
      undefined,
      makeErrorAdapter("Planner model unavailable"),
    );
    expect(result.result.text).toContain("Planner");
  });

  test("correlationId is preserved on error response (R-05)", async () => {
    const input = makeInputEnvelope({ correlationId: "error-run-id" });
    const result = await runOrchestratorTurn(
      input,
      undefined,
      makeErrorAdapter("failed"),
    );
    expect(result.correlationId).toBe("error-run-id");
  });

  test("does not crash (returns an error envelope, not an unhandled exception)", async () => {
    // planEpic throws when the planner returns status: error
    let threw = false;
    let result: NodeEnvelope | undefined;
    try {
      result = await runOrchestratorTurn(
        makeInputEnvelope(),
        undefined,
        makeErrorAdapter("boom"),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("error");
  });

  test("a thrown adapter error also yields status 'error' without crashing", async () => {
    const throwingAdapter: AgentTurnAdapter = async () => {
      throw new Error("Network timeout");
    };
    let threw = false;
    let result: NodeEnvelope | undefined;
    try {
      result = await runOrchestratorTurn(
        makeInputEnvelope(),
        undefined,
        throwingAdapter,
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("error");
    expect(result?.result.text).toContain("Network timeout");
  });
});

// ─── --epic override ─────────────────────────────────────────────────────────

describe("runOrchestratorTurn — --epic override", () => {
  test("epicOverride is passed to the planner adapter (not input.prompt)", async () => {
    const capturedPrompts: string[] = [];
    const capturingAdapter: AgentTurnAdapter = async (
      input: NodeEnvelope,
    ): Promise<NodeEnvelope> => {
      capturedPrompts.push(input.input.prompt);
      return {
        correlationId: input.correlationId,
        agentId: input.agentId,
        status: "ok",
        input: input.input,
        result: { text: PLANNER_TASK_JSON },
        artifacts: [],
      };
    };

    const inputEnv = makeInputEnvelope({
      input: { prompt: "old prompt from envelope", context: null },
    });
    await runOrchestratorTurn(inputEnv, "override epic text", capturingAdapter);

    // The planner prompt should contain the override, not the envelope prompt
    expect(capturedPrompts[0]).toContain("override epic text");
    expect(capturedPrompts[0]).not.toContain("old prompt from envelope");
  });

  test("input.prompt is used when epicOverride is undefined", async () => {
    const capturedPrompts: string[] = [];
    const capturingAdapter: AgentTurnAdapter = async (
      input: NodeEnvelope,
    ): Promise<NodeEnvelope> => {
      capturedPrompts.push(input.input.prompt);
      return {
        correlationId: input.correlationId,
        agentId: input.agentId,
        status: "ok",
        input: input.input,
        result: { text: PLANNER_TASK_JSON },
        artifacts: [],
      };
    };

    const inputEnv = makeInputEnvelope({
      input: { prompt: "Build the payment service", context: null },
    });
    await runOrchestratorTurn(inputEnv, undefined, capturingAdapter);

    expect(capturedPrompts[0]).toContain("Build the payment service");
  });

  test("empty string epicOverride falls back to input.prompt", async () => {
    const capturedPrompts: string[] = [];
    const capturingAdapter: AgentTurnAdapter = async (
      input: NodeEnvelope,
    ): Promise<NodeEnvelope> => {
      capturedPrompts.push(input.input.prompt);
      return {
        correlationId: input.correlationId,
        agentId: input.agentId,
        status: "ok",
        input: input.input,
        result: { text: PLANNER_TASK_JSON },
        artifacts: [],
      };
    };

    const inputEnv = makeInputEnvelope({
      input: { prompt: "Build from envelope", context: null },
    });
    await runOrchestratorTurn(inputEnv, "", capturingAdapter);

    expect(capturedPrompts[0]).toContain("Build from envelope");
  });
});

// ─── no-epic edge case ───────────────────────────────────────────────────────

describe("runOrchestratorTurn — no epic provided", () => {
  test("returns status 'error' when both epicOverride and input.prompt are empty", async () => {
    const input = makeInputEnvelope({
      input: { prompt: "", context: null },
    });
    // Use a dummy adapter that should never be called
    const neverCalledAdapter: AgentTurnAdapter = async () => {
      throw new Error("Adapter must not be called when no epic is present");
    };
    const result = await runOrchestratorTurn(input, undefined, neverCalledAdapter);
    expect(result.status).toBe("error");
    expect(result.result.text).toContain("No epic provided");
  });
});
