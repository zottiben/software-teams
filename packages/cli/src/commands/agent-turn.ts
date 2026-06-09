/**
 * `agent-turn` verb — one specialist turn via `runAgentTurn`.
 *
 * Implements AC3 of plan 1-02-n8n-manual-cli: runs one specialist turn
 * (Task tool disabled) through the existing `runAgentTurn` engine and emits
 * the result envelope per the CLI-RECIPE.md contract (T1).
 *
 * This module is PURE WIRING — no execution logic lives here:
 *  - Input resolution: delegated to `readInputEnvelope` via `runVerb` (T2).
 *  - Output / exit-code: delegated to `writeResult` / `statusToExitCode` via `runVerb` (T2).
 *  - Turn execution: delegated to `runAgentTurn` (existing 1-01 engine,
 *    n8n/src/execution/single-turn.ts). That engine already handles:
 *    · Claude binary detection (fails fast with status:error on missing binary — R-01)
 *    · Agent spec resolution and prompt assembly
 *    · Task tool exclusion (SINGLE_TURN_ALLOWED_TOOLS)
 *    · NEEDS_INPUT marker detection (CONTRACT.md §5)
 *    · Exit-code → status mapping
 *
 * reuse-check: the only new code is `applyAgentOverride` + `makeAgentEngine`
 * (arg-wiring helpers) and the citty arg definitions. Zero engine logic.
 */

import { defineCommand } from "citty";
import { runVerb } from "./_envelope-io";
import { runAgentTurn } from "../../../n8n/src/execution/single-turn";
import type { NodeEnvelope } from "../contract/envelope";

// ─── Test stub support (env-gated, subprocess-level purity testing) ─────────
//
// When ST_CLI_TEST_STUB=1, agent-turn returns a deterministic envelope
// without calling the real `runAgentTurn`. This allows subprocess tests to
// verify json-purity and exit-code gates without the `claude` binary.

function getAgentTurnFn(): typeof runAgentTurn {
  if (process.env.ST_CLI_TEST_STUB === "1") {
    // Offline stub: no claude binary, no network.
    return async (env: NodeEnvelope): Promise<NodeEnvelope> => ({
      ...env,
      status: "ok",
      result: { text: "STUB: agent-turn completed" },
    });
  }
  // Real engine (production).
  return runAgentTurn;
}

/**
 * Apply an optional --agent flag override onto the envelope's agentId.
 *
 * Immutable: spreads a new envelope object; the original is never mutated.
 * Falsy overrides (undefined, empty string) are treated as "no override" —
 * the original envelope reference is returned unchanged.
 *
 * Design note: agentId defaults to the input envelope's own field (no --agent
 * flag required). The optional --agent is an ergonomic shorthand for ad-hoc
 * routing without constructing a new envelope — recorded as a deliberate
 * choice in the T3 report.
 *
 * Exported for unit testing.
 */
export function applyAgentOverride(
  env: NodeEnvelope,
  agentOverride: string | undefined,
): NodeEnvelope {
  if (!agentOverride) return env;
  return { ...env, agentId: agentOverride };
}

/**
 * Construct the engine function passed to `runVerb`.
 *
 * Applies the optional --agent override then delegates entirely to
 * `runAgentTurn` (or the stub when ST_CLI_TEST_STUB=1). This factory is the
 * boundary between arg-parsing and execution — the engine itself is never
 * re-implemented here.
 *
 * Exported for unit testing (allows tests to call the engine function directly
 * without going through `runVerb` / `process.exit`).
 */
export function makeAgentEngine(
  agentOverride: string | undefined,
): (env: NodeEnvelope) => Promise<NodeEnvelope> {
  const turnFn = getAgentTurnFn();
  return (env: NodeEnvelope) => turnFn(applyAgentOverride(env, agentOverride));
}

export const agentTurnCommand = defineCommand({
  meta: {
    name: "agent-turn",
    description:
      "Run one specialist turn via the existing single-turn engine (Task tool disabled). " +
      "Reads a NodeEnvelope from --envelope or stdin, calls runAgentTurn, and emits the " +
      "result envelope. Exit codes: 0 (ok/needs-input), 1 (error), 2 (bad input).",
  },
  args: {
    json: {
      type: "boolean",
      description:
        "Emit the result envelope as JSON on stdout; route all diagnostics to stderr " +
        "(json-purity-gate — R-09).",
      default: false,
    },
    envelope: {
      type: "string",
      description:
        "Inline input NodeEnvelope as JSON; takes precedence over stdin (§2 input resolution).",
    },
    agent: {
      type: "string",
      description:
        "Override the agentId from the input envelope. Optional — agentId defaults to " +
        "the envelope's own agentId field.",
    },
  },
  async run({ args }) {
    // runVerb handles: consola redirect (--json), readInputEnvelope,
    // error → exit 2, writeResult, and statusToExitCode exit.
    // Zero I/O logic lives in this verb.
    await runVerb(args, makeAgentEngine(args.agent));
  },
});
