/**
 * xAI (Grok) provider implementation.
 *
 * Thin wrapper around `openai-compat.ts` that:
 * - Validates XAI_API_KEY is set (fail-fast before any network call).
 * - Overrides the base URL to xAI's OpenAI-compatible endpoint.
 * - Satisfies the SpawnProvider signature from providers/types.ts.
 *
 * No additional quirks — xAI is OpenAI-compatible verbatim. Tool-calling shape
 * matches OpenAI exactly (confirmed for grok-4.3).
 *
 * TOOL EXECUTION LIMITATION (v1):
 * Tool-use translation is implemented in openai-compat.ts, but actual tool
 * execution (Read, Bash, Edit, etc.) is out of scope for Phase 1. If the model
 * returns tool_calls, spawnGrok returns exitCode 1 with a descriptive error
 * message. Use provider 'anthropic' for agents that require tool execution.
 *
 * Suitable for: planner, researcher, verifier, committer, qa-tester (review
 * mode). NOT suitable for: programmer (writes files via tools).
 */

import { requireApiKey, spawnOpenAICompat } from "./openai-compat.ts";
import type { SpawnProvider } from "./types.ts";

/** xAI OpenAI-compatible base URL. */
const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * Spawn an agent using the xAI (Grok) chat completions API.
 *
 * Streams text deltas to process.stdout (parity with spawnClaude).
 * Fails fast with MissingApiKeyError if XAI_API_KEY is not set.
 *
 * @see openai-compat.ts for the full streaming + tool-use translation logic.
 */
export const spawnGrok: SpawnProvider = async (prompt, opts) => {
  const apiKey = requireApiKey("XAI_API_KEY", "xai");

  return spawnOpenAICompat(prompt, {
    model: opts.model,
    apiKey,
    baseURL: XAI_BASE_URL,
    cwd: opts.cwd,
    allowedTools: opts.allowedTools,
    providerLabel: "xai",
  });
};
