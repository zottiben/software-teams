/**
 * Config reader and profile resolver for multi-provider LLM routing.
 *
 * Implements:
 * - `loadConfig()` — read and cache `config/config.yaml` (invalidates on mtime change)
 * - `resolveAgentProfile(agent, opts?)` — resolve an agent name to a `ResolvedProfile`
 * - `TIER_MODEL_MAP` — tier→concrete-model table (exported for T6/T9)
 *
 * Bw-compat rules:
 * - Bare string `opus|sonnet|haiku` → `{ provider: anthropic, model_tier: large|medium|small }`.
 * - Object form requires both `provider` and `model_tier`.
 * - Unknown profile shape throws `MalformedProfileError`.
 * - Unknown provider throws `UnknownProviderError`.
 * - Unknown model_tier throws `UnknownTierError`.
 * - Missing agent → fallback to `{ provider: 'anthropic', model_tier: 'medium' }`.
 *
 * No I/O at module load — only on first `resolveAgentProfile()` call.
 */

import { readFileSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

import {
  MalformedProfileError,
  UnknownProviderError,
  UnknownTierError,
} from "./errors.ts";
import type { ModelTier, Provider, ResolvedProfile } from "./types.ts";

// ---------------------------------------------------------------------------
// Tier → concrete model mapping (T1 authoritative table, 2026-current names)
// Exported so T6/T9 can consume without re-defining.
// ---------------------------------------------------------------------------

/**
 * Maps (provider, tier) → concrete model ID.
 *
 * Notes:
 * - OpenAI, xAI, Moonshot: `small` aliases `medium` (no distinct small model).
 * - The resolver emits a one-time INFO log when the alias fires (arch §5).
 */
export const TIER_MODEL_MAP: Record<Provider, Record<ModelTier, string>> = {
  anthropic: {
    large: "claude-opus-4-7",
    medium: "claude-sonnet-4-5",
    small: "claude-haiku-3-5",
  },
  openai: {
    large: "gpt-4o",
    medium: "gpt-4o-mini",
    small: "gpt-4o-mini", // aliased to medium (arch §5)
  },
  xai: {
    large: "grok-4.3",
    medium: "grok-3-mini-beta",
    small: "grok-3-mini-beta", // aliased to medium (arch §5)
  },
  moonshot: {
    large: "kimi-k2.6",
    medium: "kimi-k2.5",
    small: "kimi-k2.5", // aliased to medium (arch §5)
  },
};

// Providers where small and medium resolve to the same model (for the alias log).
const SMALL_MEDIUM_ALIAS_PROVIDERS = new Set<Provider>(["openai", "xai", "moonshot"]);

// Track per-process alias log state to avoid log spam.
const _aliasSeen = new Set<string>();

function logAlias(provider: Provider, tier: ModelTier, model: string): void {
  const key = `${provider}:${tier}`;
  if (!_aliasSeen.has(key)) {
    _aliasSeen.add(key);
    console.info(
      `[providers] tier '${tier}' on provider '${provider}' resolves to ${model} (same as medium)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Legacy bare-string normalisation
// ---------------------------------------------------------------------------

/** Legacy model name → tier. Covers old naming (opus|sonnet|haiku) from pre-T5 configs. */
const LEGACY_NAME_MAP: Record<string, ModelTier> = {
  opus: "large",
  sonnet: "medium",
  haiku: "small",
};

const VALID_PROVIDERS = new Set<Provider>(["anthropic", "openai", "xai", "moonshot"]);
const VALID_TIERS = new Set<ModelTier>(["large", "medium", "small"]);

// ---------------------------------------------------------------------------
// Raw config shape (what we read from YAML)
// ---------------------------------------------------------------------------

type RawProfileEntry = string | { provider: string; model_tier: string };

interface RawModelsBlock {
  profile?: string;
  profiles?: Record<string, Record<string, RawProfileEntry>>;
  overrides?: Record<string, RawProfileEntry | null>;
}

interface RawConfig {
  models?: RawModelsBlock;
}

// ---------------------------------------------------------------------------
// Config cache (mtime-invalidated)
// ---------------------------------------------------------------------------

interface ConfigCache {
  config: RawConfig;
  mtime: number;
  path: string;
}

let _cache: ConfigCache | null = null;

/** Resolve the path to config/config.yaml from the working directory. */
function configPath(): string {
  return resolve(process.cwd(), "config", "config.yaml");
}

/**
 * Load (and cache) `config/config.yaml`. Cache is invalidated when the file's
 * mtime changes. No I/O occurs at module load — only on first call.
 *
 * Returns an empty object if the file does not exist; all resolutions then
 * fall through to defaults (R-01 invariant: missing config → anthropic/medium).
 */
export function loadConfig(): RawConfig {
  const path = configPath();

  // Check mtime before reading to allow cache invalidation.
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    // File not found — return empty; all resolutions fall back to defaults.
    return {};
  }

  if (_cache && _cache.path === path && _cache.mtime === mtime) {
    return _cache.config;
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const config = (parseYaml(raw) ?? {}) as RawConfig;
  _cache = { config, mtime, path };
  return config;
}

// ---------------------------------------------------------------------------
// Profile entry normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a raw profile entry (bare string or object) to `{ provider, tier }`.
 * Throws `MalformedProfileError`, `UnknownProviderError`, or `UnknownTierError`
 * on invalid input.
 */
function normaliseEntry(
  entry: RawProfileEntry,
  agent: string,
): { provider: Provider; tier: ModelTier } {
  if (typeof entry === "string") {
    // Legacy bare string: opus | sonnet | haiku
    const legacy = LEGACY_NAME_MAP[entry.toLowerCase()];
    if (legacy) {
      return { provider: "anthropic", tier: legacy };
    }
    // Accept tier names directly (large|medium|small) with anthropic default.
    if (VALID_TIERS.has(entry as ModelTier)) {
      return { provider: "anthropic", tier: entry as ModelTier };
    }
    throw new MalformedProfileError(agent);
  }

  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const { provider: rawProvider, model_tier: rawTier } = entry;

    if (!rawProvider || !rawTier) {
      throw new MalformedProfileError(agent);
    }

    if (!VALID_PROVIDERS.has(rawProvider as Provider)) {
      throw new UnknownProviderError(rawProvider);
    }

    if (!VALID_TIERS.has(rawTier as ModelTier)) {
      throw new UnknownTierError(rawTier);
    }

    return {
      provider: rawProvider as Provider,
      tier: rawTier as ModelTier,
    };
  }

  throw new MalformedProfileError(agent);
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve an agent name to a concrete `ResolvedProfile`.
 *
 * Resolution order (deterministic, fail-fast):
 * 1. `models.overrides.<agent>` (non-null) — highest precedence.
 * 2. `models.profiles.<active>.<agent>` (active profile from `models.profile`).
 * 3. Caller-supplied `frontmatterTier` with `provider: anthropic`.
 * 4. Hardcoded default: `{ provider: anthropic, model_tier: medium }`.
 *
 * The active profile name defaults to `balanced` if `models.profile` is absent.
 */
export function resolveAgentProfile(
  agent: string,
  opts?: { frontmatterTier?: ModelTier },
): ResolvedProfile {
  const config = loadConfig();
  const models = config.models ?? {};

  const activeProfileName = models.profile ?? "balanced";

  // Step 1: Check overrides first (highest precedence).
  const overrides = models.overrides ?? {};
  const override = overrides[agent];
  if (override !== undefined && override !== null) {
    const { provider, tier } = normaliseEntry(override, agent);
    return buildProfile(provider, tier);
  }

  // Step 2: Check the active profile.
  const profiles = models.profiles ?? {};
  const activeProfile = profiles[activeProfileName] ?? {};
  const profileEntry = activeProfile[agent];
  if (profileEntry !== undefined && profileEntry !== null) {
    const { provider, tier } = normaliseEntry(profileEntry, agent);
    return buildProfile(provider, tier);
  }

  // Step 3: Caller-supplied frontmatter tier (agent spec `model_tier` field).
  if (opts?.frontmatterTier) {
    return buildProfile("anthropic", opts.frontmatterTier);
  }

  // Step 4: Global default — safest option, matches existing user behaviour.
  return buildProfile("anthropic", "medium");
}

/**
 * Map `(provider, tier)` → concrete model ID and return a `ResolvedProfile`.
 * Emits the one-time tier-collapse alias log for providers that alias small=medium.
 */
function buildProfile(provider: Provider, tier: ModelTier): ResolvedProfile {
  const model = TIER_MODEL_MAP[provider][tier];

  // Emit alias log when small collapses to medium on non-Anthropic providers.
  if (tier === "small" && SMALL_MEDIUM_ALIAS_PROVIDERS.has(provider)) {
    logAlias(provider, tier, model);
  }

  return { provider, modelTier: tier, model };
}

/**
 * Invalidate the config cache. For use in tests or after config hot-reload.
 * Not part of the public production API.
 */
export function _invalidateConfigCache(): void {
  _cache = null;
}
