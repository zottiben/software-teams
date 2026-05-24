/**
 * Moonshot (Kimi) provider implementation.
 *
 * Thin wrapper around `openai-compat.ts` that:
 * - Validates MOONSHOT_API_KEY is set (fail-fast before any network call).
 * - Overrides the base URL to Moonshot's OpenAI-compatible endpoint.
 * - Enforces Moonshot-specific API constraints (see below).
 * - Satisfies the SpawnProvider signature from providers/types.ts.
 *
 * MOONSHOT-SPECIFIC CONSTRAINTS:
 * 1. tool_choice — Moonshot does NOT support `tool_choice: "required"`. The
 *    shared openai-compat.ts factory does not forward tool_choice, so the API
 *    defaults to "auto". This is the correct behaviour; no additional handling
 *    is required. If a future caller adds tool_choice to SpawnProvider opts,
 *    this wrapper MUST clamp "required" → "auto" and throw MoonshotToolChoiceError
 *    (already defined in errors.ts) to surface the limitation.
 *
 * 2. Temperature — Moonshot clamps temperature to [0, 1]; kimi-k2 series has
 *    fixed recommended temperatures (1.0 for thinking variants, 0.6 otherwise).
 *    This wrapper hardcodes 0.6 for the standard kimi-k2 tier and emits a
 *    one-time INFO log explaining that caller-supplied temperature is not
 *    forwarded. Temperature is not currently a SpawnProvider option, so no
 *    caller value can be silently overridden.
 *
 * TOOL EXECUTION LIMITATION (v1):
 * Tool-use translation is implemented in openai-compat.ts, but actual tool
 * execution (Read, Bash, Edit, etc.) is out of scope for Phase 1. If the model
 * returns tool_calls, spawnKimi returns exitCode 1 with a descriptive error
 * message. Use provider 'anthropic' for agents that require tool execution.
 *
 * Suitable for: planner, researcher, verifier, committer, qa-tester (review
 * mode). NOT suitable for: programmer (writes files via tools).
 */

import { requireApiKey, spawnOpenAICompat } from "./openai-compat.ts";
import type { SpawnProvider } from "./types.ts";

/** Moonshot OpenAI-compatible base URL. */
const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";

/**
 * Fixed temperature for standard kimi-k2 models (non-thinking variants).
 * Moonshot requires this to be in [0, 1]; 0.6 is the recommended value for
 * kimi-k2.5 and kimi-k2.6.
 */
const MOONSHOT_TEMPERATURE = 0.6;

/** Emit the temperature info log at most once per process. */
let _tempInfoLogged = false;

/**
 * Spawn an agent using the Moonshot (Kimi) chat completions API.
 *
 * Streams text deltas to process.stdout (parity with spawnClaude).
 * Fails fast with MissingApiKeyError if MOONSHOT_API_KEY is not set.
 *
 * Temperature is hardcoded to 0.6 per Moonshot kimi-k2 requirements.
 * tool_choice defaults to "auto" (Moonshot does not support "required").
 *
 * @see openai-compat.ts for the full streaming + tool-use translation logic.
 */
export const spawnKimi: SpawnProvider = async (prompt, opts) => {
  const apiKey = requireApiKey("MOONSHOT_API_KEY", "moonshot");

  if (!_tempInfoLogged) {
    _tempInfoLogged = true;
    process.stderr.write(
      `[providers/moonshot] Temperature hardcoded to ${MOONSHOT_TEMPERATURE} per kimi-k2 series requirements. Caller-supplied temperature is not forwarded.\n`,
    );
  }

  return spawnOpenAICompat(prompt, {
    model: opts.model,
    apiKey,
    baseURL: MOONSHOT_BASE_URL,
    cwd: opts.cwd,
    allowedTools: opts.allowedTools,
    providerLabel: "moonshot",
    temperature: MOONSHOT_TEMPERATURE,
  });
};
