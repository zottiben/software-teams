/**
 * Provider dispatcher — `spawnAgent`.
 *
 * Resolves the active provider profile for a given agent, then delegates to
 * the matching SpawnProvider function. The Anthropic path routes directly to
 * the unchanged `spawnClaude` (R-01 invariant).
 *
 * All four provider slots are now live: anthropic (spawnClaude), openai
 * (spawnOpenAI), xai/spawnGrok, and moonshot/spawnKimi. T9 completes Phase 2
 * provider registration.
 */

import { spawnClaude } from "./claude.ts";
import {
  UnknownProviderError,
} from "./providers/errors.ts";
import { resolveAgentProfile } from "./providers/config.ts";
import { spawnOpenAI } from "./providers/openai.ts";
import { spawnGrok } from "./providers/xai.ts";
import { spawnKimi } from "./providers/moonshot.ts";
import type {
  Provider,
  ResolvedProfile,
  SpawnAgentOptions,
  SpawnAgentResult,
  SpawnProvider,
} from "./providers/types.ts";

// Re-export types so callers can import from a single entry point.
export type {
  ModelTier,
  NormalisedToolCall,
  NormalisedToolDef,
  NormalisedToolResult,
  Provider,
  ResolvedProfile,
  SpawnAgentOptions,
  SpawnAgentResult,
  SpawnProvider,
} from "./providers/types.ts";

// Re-export config utilities for downstream consumers (T6/T9).
export { TIER_MODEL_MAP, resolveAgentProfile } from "./providers/config.ts";

export {
  MalformedProfileError,
  MissingApiKeyError,
  MoonshotToolChoiceError,
  ProviderError,
  ProviderNotImplementedError,
  UnknownAgentError,
  UnknownProviderError,
  UnknownTierError,
} from "./providers/errors.ts";

// ---------------------------------------------------------------------------
// Anthropic provider — delegates to unchanged spawnClaude (R-01 invariant)
// ---------------------------------------------------------------------------

const anthropicProvider: SpawnProvider = (prompt, opts) =>
  spawnClaude(prompt, opts);

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<Provider, SpawnProvider> = {
  anthropic: anthropicProvider,
  openai: spawnOpenAI,
  xai: spawnGrok,
  moonshot: spawnKimi,
};

// ---------------------------------------------------------------------------
// Profile resolution — wired to the real config reader (T4)
// ---------------------------------------------------------------------------

/**
 * Resolve the agent's provider profile via `providers/config.ts`.
 *
 * Delegates fully to `resolveAgentProfile` which reads `config/config.yaml`,
 * applies legacy bw-compat normalisation, and falls back to
 * `{ provider: 'anthropic', model_tier: 'medium' }` for unknown agents.
 *
 * The R-01 invariant is preserved: with no config changes and
 * `ANTHROPIC_API_KEY` set, every call still routes to `spawnClaude`.
 */
function resolveProfile(agent: string): ResolvedProfile {
  return resolveAgentProfile(agent);
}

// ---------------------------------------------------------------------------
// Dispatcher entry point
// ---------------------------------------------------------------------------

/**
 * Spawn an agent using the configured provider.
 *
 * Resolution algorithm:
 * 1. `resolveProfile(agent)` → `ResolvedProfile` (T4 wires the real reader).
 * 2. Look up provider in `PROVIDERS` registry.
 * 3. Validate the provider is known; throw `UnknownProviderError` if not.
 * 4. Delegate to the provider's `SpawnProvider` function.
 *
 * With no config changes and `ANTHROPIC_API_KEY` set, every call routes
 * through `spawnClaude` unchanged (R-01 invariant).
 */
export async function spawnAgent(
  opts: SpawnAgentOptions,
): Promise<SpawnAgentResult> {
  const profile = resolveProfile(opts.agent);
  const { provider, model } = profile;

  const providerFn = PROVIDERS[provider];
  if (!providerFn) {
    throw new UnknownProviderError(provider);
  }

  return providerFn(opts.prompt, {
    cwd: opts.cwd,
    allowedTools: opts.allowedTools,
    model,
    permissionMode: opts.permissionMode,
  });
}
