/**
 * orchestrator-turn verb — T4 of plan 1-02-n8n-manual-cli
 *
 * Takes an epic/goal (from the input envelope's `input.prompt`, or a `--epic` flag),
 * runs `planEpic` with the existing `runAgentTurn` injected as the adapter, and
 * emits an envelope whose:
 *   - `result.text`             carries the waved breakdown summary
 *   - `result.context.tasks`    carries ordered per-task NodeEnvelopes (canvas fan-out)
 *   - `result.context.runState` carries serialised run state
 *
 * Per CLI-RECIPE.md §6 (normative field layout pinned by T1).
 *
 * REUSE: `planEpic`, `serialiseRunState`, `AgentTurnAdapter` imported from
 * `n8n/src/orchestration/run-state.ts`. `runAgentTurn` imported from
 * `n8n/src/execution/single-turn.ts`. No wave-computation logic re-derived.
 *
 * Risks addressed:
 *   R-04 — adapter injected unchanged; the `runOrchestratorTurn` export lets unit
 *           tests verify the wiring shape with a mocked adapter (no claude binary).
 *   R-05 — stable correlationId: reuse the input envelope's id (always non-empty
 *           per invariants); defensive fallback to randomUUID() if somehow absent.
 */

import { defineCommand } from "citty";
import { randomUUID } from "node:crypto";
import { runVerb, stderrLog } from "./_envelope-io";
import {
  planEpic as realPlanEpic,
  serialiseRunState,
  type AgentTurnAdapter,
} from "../../../n8n/src/orchestration/run-state";
import { runAgentTurn } from "../../../n8n/src/execution/single-turn";
import type { NodeEnvelope } from "../../../n8n/src/contract/envelope";

// ─── Test stub support (env-gated, subprocess-level purity testing) ─────────
//
// When ST_CLI_TEST_STUB=1, orchestrator-turn returns a deterministic breakdown
// without calling the real `planEpic`. This allows subprocess tests to
// verify json-purity and exit-code gates without the `claude` binary.

function getPlanEpicFn() {
  if (process.env.ST_CLI_TEST_STUB === "1") {
    // Offline stub: deterministic breakdown, no claude binary, no network.
    return async (
      epic: string,
      correlationId: string,
      _adapter: AgentTurnAdapter,
    ) => ({
      correlationId,
      tasks: [
        {
          taskId: "T1",
          name: "Stub task from epic",
          agent: "software-teams-backend",
          wave: 1,
          dependsOn: [],
        },
      ],
      envelopes: [
        {
          correlationId,
          agentId: "software-teams-backend",
          status: "ok" as const,
          input: {
            prompt: "Stub task",
            context: null,
          },
          result: { text: "" },
          artifacts: [],
        },
      ],
      state: {
        correlationId,
        createdAt: new Date().toISOString(),
        tasks: [
          {
            taskId: "T1",
            agent: "software-teams-backend",
            wave: 1,
            dependsOn: [],
            status: "pending" as const,
          },
        ],
      },
    });
  }
  // Real engine (production).
  return realPlanEpic;
}

// ---------------------------------------------------------------------------
// Core engine — exported for unit testing with injected adapter (R-04)
// ---------------------------------------------------------------------------

/**
 * Run the orchestrator planning pass and produce the output envelope.
 *
 * Exported so unit tests can inject a mock adapter without the `claude` binary
 * (R-04: "T7 mocks the injected adapter so the wiring shape is asserted without
 * the binary"). The production command always injects `runAgentTurn`.
 *
 * @param inputEnvelope  the resolved input envelope
 * @param epicOverride   value of the `--epic` flag; falls back to `inputEnvelope.input.prompt`
 * @param adapter        single-turn adapter; defaults to `runAgentTurn` (injectable for tests)
 */
export async function runOrchestratorTurn(
  inputEnvelope: NodeEnvelope,
  epicOverride: string | undefined,
  adapter: AgentTurnAdapter = runAgentTurn,
): Promise<NodeEnvelope> {
  // R-05: reuse the input envelope's correlationId when present (invariants guarantee
  // it is a non-empty string, but we keep the defensive fallback for safety).
  const correlationId =
    typeof inputEnvelope.correlationId === "string" &&
    inputEnvelope.correlationId.trim().length > 0
      ? inputEnvelope.correlationId
      : randomUUID();

  // Derive epic: --epic flag takes precedence over envelope's input.prompt.
  const epic = epicOverride?.trim() || inputEnvelope.input.prompt;

  if (!epic) {
    return {
      correlationId,
      agentId: inputEnvelope.agentId,
      status: "error",
      input: inputEnvelope.input,
      result: {
        text: "No epic provided: supply --epic <text> or set input.prompt on the input envelope",
      },
      artifacts: [...inputEnvelope.artifacts],
    };
  }

  stderrLog.info(
    `orchestrator-turn: planning epic (correlationId=${correlationId})`,
  );

  const planEpic = getPlanEpicFn();
  const planResultOrError = await planEpic(epic, correlationId, adapter).catch((err) => ({
    _error: err instanceof Error ? err.message : String(err),
  }));
  if ("_error" in planResultOrError) {
    return {
      correlationId,
      agentId: inputEnvelope.agentId,
      status: "error",
      input: inputEnvelope.input,
      result: {
        text: planResultOrError._error,
      },
      artifacts: [...inputEnvelope.artifacts],
    };
  }
  const planResult = planResultOrError;

  if (planResult.plannerNeedsInput) {
    return {
      correlationId,
      agentId: inputEnvelope.agentId,
      status: "needs-input",
      input: inputEnvelope.input,
      result: { text: planResult.plannerNeedsInput.result.text },
      artifacts: [...inputEnvelope.artifacts],
    };
  }

  // Build a human-readable waved breakdown for result.text.
  const tasksByWave = new Map<number, typeof planResult.tasks>();
  for (const task of planResult.tasks) {
    const bucket = tasksByWave.get(task.wave) ?? [];
    bucket.push(task);
    tasksByWave.set(task.wave, bucket);
  }
  const waves = [...tasksByWave.keys()].sort((a, b) => a - b);
  const lines: string[] = [
    `Epic breakdown: ${planResult.tasks.length} task(s) across ${waves.length} wave(s)`,
    "",
  ];
  for (const wave of waves) {
    lines.push(`Wave ${wave}:`);
    for (const task of tasksByWave.get(wave)!) {
      const deps =
        task.dependsOn.length > 0
          ? ` (deps: ${task.dependsOn.join(", ")})`
          : "";
      lines.push(`  [${task.taskId}] ${task.name} → ${task.agent}${deps}`);
    }
  }
  const breakdownText = lines.join("\n");

  // Assemble output envelope per CLI-RECIPE.md §6 (normative layout).
  // `result.context` is an additive extension of the CONTRACT.md §1 `result`
  // shape — the §1 invariants assert required fields, not a closed shape, so this
  // passes `contract-conformance` unchanged.
  return {
    correlationId,
    agentId: inputEnvelope.agentId,
    status: "ok",
    input: inputEnvelope.input,
    result: {
      text: breakdownText,
      context: {
        tasks: planResult.envelopes,        // ordered per-task NodeEnvelopes (canvas fan-out)
        runState: serialiseRunState(planResult.state), // serialised initial run state
      },
    } as NodeEnvelope["result"],
    artifacts: [...inputEnvelope.artifacts],
  };
}

// ---------------------------------------------------------------------------
// CLI verb definition
// ---------------------------------------------------------------------------

export const orchestratorTurnCommand = defineCommand({
  meta: {
    name: "orchestrator-turn",
    description:
      "Run the planner for an epic/goal and emit a waved task breakdown + per-task envelopes (no-install n8n recipe)",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description:
        "Emit pure NodeEnvelope JSON on stdout — required for n8n Execute Command nodes (§3 stdout purity)",
    },
    envelope: {
      type: "string",
      description:
        "Input NodeEnvelope JSON inline (takes precedence over stdin — §2 escape hatch)",
    },
    epic: {
      type: "string",
      description:
        "Epic/goal text; falls back to the input envelope's input.prompt when omitted",
    },
  },
  async run({ args }) {
    const epicOverride = args.epic as string | undefined;

    // runVerb handles: stdout purity redirect (--json), input resolution (§2),
    // writeResult (§3), process.exit with statusToExitCode (§4).
    await runVerb(args, (inputEnvelope: NodeEnvelope) =>
      runOrchestratorTurn(inputEnvelope, epicOverride),
    );
  },
});
