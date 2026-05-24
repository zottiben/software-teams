/**
 * OpenAI provider implementation.
 *
 * Thin wrapper around `openai-compat.ts` that:
 * - Validates OPENAI_API_KEY is set (fail-fast before any network call).
 * - Uses the default OpenAI base URL (no override needed).
 * - Satisfies the SpawnProvider signature from providers/types.ts.
 *
 * TOOL EXECUTION LIMITATION (v1):
 * Tool-use translation (NormalisedToolCall <-> OpenAI tool_calls) is
 * implemented in openai-compat.ts, but actual tool execution (Read, Bash,
 * Edit, etc.) is out of scope for Phase 1. If the model returns tool_calls,
 * spawnOpenAI returns exitCode 1 with a descriptive error message telling
 * the user to use provider 'anthropic' for agents that require tool execution.
 *
 * Suitable for: planner, researcher, verifier, committer, qa-tester (review
 * mode). NOT suitable for: programmer (writes files via tools).
 *
 * Surface this limitation in README via T14.
 */

import { requireApiKey, spawnOpenAICompat } from "./openai-compat.ts";
import type { SpawnProvider } from "./types.ts";

/**
 * Spawn an agent using the OpenAI chat completions API.
 *
 * Streams text deltas to process.stdout (parity with spawnClaude).
 * Fails fast with MissingApiKeyError if OPENAI_API_KEY is not set.
 *
 * @see openai-compat.ts for the full streaming + tool-use translation logic.
 */
export const spawnOpenAI: SpawnProvider = async (prompt, opts) => {
  const apiKey = requireApiKey("OPENAI_API_KEY", "openai");

  return spawnOpenAICompat(prompt, {
    model: opts.model,
    apiKey,
    cwd: opts.cwd,
    allowedTools: opts.allowedTools,
    providerLabel: "openai",
  });
};
