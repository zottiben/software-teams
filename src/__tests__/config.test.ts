/**
 * Unit tests for src/utils/providers/config.ts
 *
 * Covers:
 * - Legacy bare-string entries (opus/sonnet/haiku) → bw-compat proof
 * - Extended object entries { provider, model_tier }
 * - Active profile switch (balanced → quality)
 * - Override taking precedence over profile entry
 * - Unknown provider error
 * - Unknown tier error
 * - Malformed entry errors
 * - Missing-agent fallback
 * - TIER_MODEL_MAP exports (T6/T9 contract)
 * - Loading the shipped config.yaml resolves every agent to anthropic
 *
 * No real I/O during normal test runs — tests inject config via _invalidateConfigCache
 * + a temporary YAML fixture written to a temp path and process.cwd() override.
 *
 * Simpler approach: we mock loadConfig() by testing normaliseEntry-equivalent
 * paths through resolveAgentProfile with controlled module state.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  TIER_MODEL_MAP,
  _invalidateConfigCache,
  loadConfig,
  resolveAgentProfile,
} from "../utils/providers/config.ts";

import {
  MalformedProfileError,
  UnknownProviderError,
  UnknownTierError,
} from "../utils/providers/errors.ts";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** Write a YAML config file to a temp dir and return the dir path. */
function writeTempConfig(yaml: string): string {
  const dir = join(tmpdir(), `st-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "config.yaml"), yaml, "utf8");
  return dir;
}

/** Override process.cwd() for the duration of a test. */
let _cwdOverride: string | null = null;
const _origCwd = process.cwd.bind(process);

function setCwd(dir: string): void {
  _cwdOverride = dir;
  process.cwd = () => _cwdOverride!;
}

function restoreCwd(): void {
  _cwdOverride = null;
  process.cwd = _origCwd;
}

// ---------------------------------------------------------------------------
// TIER_MODEL_MAP contract
// ---------------------------------------------------------------------------

describe("TIER_MODEL_MAP", () => {
  it("exports a map with all four providers", () => {
    expect(TIER_MODEL_MAP).toHaveProperty("anthropic");
    expect(TIER_MODEL_MAP).toHaveProperty("openai");
    expect(TIER_MODEL_MAP).toHaveProperty("xai");
    expect(TIER_MODEL_MAP).toHaveProperty("moonshot");
  });

  it("anthropic: large=claude-opus-4-7, medium=claude-sonnet-4-5, small=claude-haiku-3-5", () => {
    expect(TIER_MODEL_MAP.anthropic.large).toBe("claude-opus-4-7");
    expect(TIER_MODEL_MAP.anthropic.medium).toBe("claude-sonnet-4-5");
    expect(TIER_MODEL_MAP.anthropic.small).toBe("claude-haiku-3-5");
  });

  it("openai: large=gpt-4o, medium=gpt-4o-mini, small=gpt-4o-mini (alias)", () => {
    expect(TIER_MODEL_MAP.openai.large).toBe("gpt-4o");
    expect(TIER_MODEL_MAP.openai.medium).toBe("gpt-4o-mini");
    expect(TIER_MODEL_MAP.openai.small).toBe("gpt-4o-mini");
  });

  it("xai: large=grok-4.3, medium=grok-3-mini-beta, small=grok-3-mini-beta (alias)", () => {
    expect(TIER_MODEL_MAP.xai.large).toBe("grok-4.3");
    expect(TIER_MODEL_MAP.xai.medium).toBe("grok-3-mini-beta");
    expect(TIER_MODEL_MAP.xai.small).toBe("grok-3-mini-beta");
  });

  it("moonshot: large=kimi-k2.6, medium=kimi-k2.5, small=kimi-k2.5 (alias)", () => {
    expect(TIER_MODEL_MAP.moonshot.large).toBe("kimi-k2.6");
    expect(TIER_MODEL_MAP.moonshot.medium).toBe("kimi-k2.5");
    expect(TIER_MODEL_MAP.moonshot.small).toBe("kimi-k2.5");
  });
});

// ---------------------------------------------------------------------------
// Backward-compatibility: legacy bare strings
// ---------------------------------------------------------------------------

describe("legacy bare-string profile entries (bw-compat)", () => {
  let tempDir: string;

  beforeEach(() => {
    _invalidateConfigCache();
  });

  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("'opus' resolves to { provider: anthropic, modelTier: large, model: claude-opus-4-7 }", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    expect(result.provider).toBe("anthropic");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("'sonnet' resolves to { provider: anthropic, modelTier: medium, model: claude-sonnet-4-5 }", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      programmer: sonnet
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("programmer");
    expect(result.provider).toBe("anthropic");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("claude-sonnet-4-5");
  });

  it("'haiku' resolves to { provider: anthropic, modelTier: small, model: claude-haiku-3-5 }", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      verifier: haiku
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("verifier");
    expect(result.provider).toBe("anthropic");
    expect(result.modelTier).toBe("small");
    expect(result.model).toBe("claude-haiku-3-5");
  });

  it("all agents in the shipped config.yaml resolve to anthropic (regression-safety check)", () => {
    // Use the ACTUAL shipped config.yaml — restore the real cwd.
    restoreCwd();
    _invalidateConfigCache();

    const config = loadConfig();
    const models = config.models;
    expect(models).toBeDefined();

    const activeProfile = models!.profile ?? "balanced";
    const profiles = models!.profiles ?? {};
    const profileEntries = profiles[activeProfile] ?? {};

    // Every agent in the shipped config uses legacy bare strings → anthropic.
    for (const [agent, entry] of Object.entries(profileEntries)) {
      const result = resolveAgentProfile(agent);
      expect(result.provider).toBe("anthropic");
    }
  });
});

// ---------------------------------------------------------------------------
// Extended object form
// ---------------------------------------------------------------------------

describe("extended object profile entries { provider, model_tier }", () => {
  let tempDir: string;

  beforeEach(() => {
    _invalidateConfigCache();
  });

  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("resolves openai large to gpt-4o", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner:
        provider: openai
        model_tier: large
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    expect(result.provider).toBe("openai");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("gpt-4o");
  });

  it("resolves xai medium to grok-3-mini-beta", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      programmer:
        provider: xai
        model_tier: medium
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("programmer");
    expect(result.provider).toBe("xai");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("grok-3-mini-beta");
  });

  it("resolves moonshot large to kimi-k2.6", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      researcher:
        provider: moonshot
        model_tier: large
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("researcher");
    expect(result.provider).toBe("moonshot");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("kimi-k2.6");
  });
});

// ---------------------------------------------------------------------------
// Active profile switch
// ---------------------------------------------------------------------------

describe("active profile switching", () => {
  let tempDir: string;

  beforeEach(() => {
    _invalidateConfigCache();
  });

  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("uses the quality profile when models.profile=quality", () => {
    tempDir = writeTempConfig(`
models:
  profile: quality
  profiles:
    balanced:
      planner: sonnet
    quality:
      planner: opus
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("uses the balanced profile when models.profile=balanced", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: sonnet
    quality:
      planner: opus
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("claude-sonnet-4-5");
  });

  it("defaults to balanced when models.profile is absent", () => {
    tempDir = writeTempConfig(`
models:
  profiles:
    balanced:
      planner: haiku
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    expect(result.modelTier).toBe("small");
    expect(result.model).toBe("claude-haiku-3-5");
  });
});

// ---------------------------------------------------------------------------
// Override precedence
// ---------------------------------------------------------------------------

describe("override taking precedence over profile entry", () => {
  let tempDir: string;

  beforeEach(() => {
    _invalidateConfigCache();
  });

  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("override wins over the profile entry", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: haiku
  overrides:
    planner: opus
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    // Override (opus → large) wins over profile (haiku → small).
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("null override does NOT win (falls through to profile)", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
  overrides:
    planner: null
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    // null override → fall through to profile (opus → large).
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("override works with extended object form", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: haiku
  overrides:
    planner:
      provider: openai
      model_tier: large
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("planner");
    expect(result.provider).toBe("openai");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// Error cases: unknown provider, unknown tier, malformed entry
// ---------------------------------------------------------------------------

describe("error cases", () => {
  let tempDir: string;

  beforeEach(() => {
    _invalidateConfigCache();
  });

  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("unknown provider throws UnknownProviderError", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner:
        provider: groq
        model_tier: large
`);
    setCwd(tempDir);
    expect(() => resolveAgentProfile("planner")).toThrow(UnknownProviderError);
  });

  it("unknown model_tier throws UnknownTierError", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner:
        provider: openai
        model_tier: ultra
`);
    setCwd(tempDir);
    expect(() => resolveAgentProfile("planner")).toThrow(UnknownTierError);
  });

  it("malformed entry (number) throws MalformedProfileError", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: 42
`);
    setCwd(tempDir);
    expect(() => resolveAgentProfile("planner")).toThrow(MalformedProfileError);
  });

  it("malformed entry (unknown bare string) throws MalformedProfileError", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: turbo
`);
    setCwd(tempDir);
    expect(() => resolveAgentProfile("planner")).toThrow(MalformedProfileError);
  });

  it("object missing model_tier throws MalformedProfileError", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner:
        provider: openai
`);
    setCwd(tempDir);
    expect(() => resolveAgentProfile("planner")).toThrow(MalformedProfileError);
  });
});

// ---------------------------------------------------------------------------
// Missing-agent fallback
// ---------------------------------------------------------------------------

describe("missing-agent fallback", () => {
  let tempDir: string;

  beforeEach(() => {
    _invalidateConfigCache();
  });

  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("agent absent from profile falls back to { provider: anthropic, modelTier: medium }", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
`);
    setCwd(tempDir);
    // 'unknown-agent' has no profile entry.
    const result = resolveAgentProfile("unknown-agent");
    expect(result.provider).toBe("anthropic");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("claude-sonnet-4-5");
  });

  it("uses frontmatterTier when agent not in profile but frontmatter provided", () => {
    tempDir = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced: {}
`);
    setCwd(tempDir);
    const result = resolveAgentProfile("new-agent", { frontmatterTier: "large" });
    expect(result.provider).toBe("anthropic");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("global default when config file is missing (no I/O error)", () => {
    // Point cwd at a dir with no config subdirectory.
    const emptyDir = join(tmpdir(), `st-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    setCwd(emptyDir);
    _invalidateConfigCache();
    const result = resolveAgentProfile("any-agent");
    expect(result.provider).toBe("anthropic");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("claude-sonnet-4-5");
  });
});

// ---------------------------------------------------------------------------
// Regression-safety: shipped config.yaml → all agents resolve to anthropic
// ---------------------------------------------------------------------------

describe("regression-safety: shipped config.yaml (bw-compat proof)", () => {
  beforeEach(() => {
    restoreCwd(); // use the real cwd (project root)
    _invalidateConfigCache();
  });

  afterEach(() => {
    _invalidateConfigCache();
  });

  it("planner resolves to anthropic with the shipped balanced profile", () => {
    const result = resolveAgentProfile("planner");
    expect(result.provider).toBe("anthropic");
  });

  it("programmer resolves to anthropic with the shipped balanced profile", () => {
    const result = resolveAgentProfile("programmer");
    expect(result.provider).toBe("anthropic");
  });

  it("verifier resolves to anthropic with the shipped balanced profile", () => {
    const result = resolveAgentProfile("verifier");
    expect(result.provider).toBe("anthropic");
  });

  it("researcher resolves to anthropic with the shipped balanced profile", () => {
    const result = resolveAgentProfile("researcher");
    expect(result.provider).toBe("anthropic");
  });

  it("balanced profile: planner=opus → large", () => {
    const result = resolveAgentProfile("planner");
    expect(result.modelTier).toBe("large");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("balanced profile: programmer=sonnet → medium", () => {
    const result = resolveAgentProfile("programmer");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("claude-sonnet-4-5");
  });

  it("balanced profile: verifier=sonnet → medium", () => {
    const result = resolveAgentProfile("verifier");
    expect(result.modelTier).toBe("medium");
    expect(result.model).toBe("claude-sonnet-4-5");
  });
});

// ---------------------------------------------------------------------------
// Cache: no I/O at module load
// ---------------------------------------------------------------------------

describe("config cache behaviour", () => {
  afterEach(() => {
    restoreCwd();
    _invalidateConfigCache();
  });

  it("_invalidateConfigCache forces a re-read on next call", () => {
    const tempDir1 = writeTempConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
`);
    setCwd(tempDir1);
    _invalidateConfigCache();

    const result1 = resolveAgentProfile("planner");
    expect(result1.modelTier).toBe("large");

    // Write a different config to the same location.
    writeFileSync(join(tempDir1, "config", "config.yaml"), `
models:
  profile: balanced
  profiles:
    balanced:
      planner: haiku
`, "utf8");

    // Without invalidation, cache would return the old result.
    _invalidateConfigCache();
    const result2 = resolveAgentProfile("planner");
    expect(result2.modelTier).toBe("small");
  });
});
