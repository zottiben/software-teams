/**
 * Unit tests for convert-agents.ts bw-compat frontmatter handling.
 *
 * Covers the four fixture categories required by T5:
 *   1. new-only  — `model_tier:` present → emits correct Anthropic `model:` in output
 *   2. legacy-only — `model:` (opus|sonnet|haiku) only → emits deprecation warning,
 *      still resolves the correct output `model:`
 *   3. both-present — `model_tier:` + `model:` → prefers `model_tier:`
 *   4. malformed  — unknown tier / missing both → throws with file path in message
 *
 * These tests exercise `validateAgentFrontmatter` and the
 * `TIER_TO_ANTHROPIC_MODEL` / `LEGACY_MODEL_TO_TIER` lookup tables
 * embedded in the converter, without invoking the filesystem.
 */

import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import { validateAgentFrontmatter } from "../utils/convert-agents.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrontmatter(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "software-teams-test",
    description: "Test agent",
    tools: ["Read", "Write"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. New-only shape: model_tier → translates to Anthropic model on output
// ---------------------------------------------------------------------------

describe("validateAgentFrontmatter — new shape (model_tier only)", () => {
  it("model_tier: large → sets model: opus", () => {
    const fm = makeFrontmatter({ model_tier: "large" });
    validateAgentFrontmatter(fm, "agents/test.md");
    expect(fm.model).toBe("opus");
  });

  it("model_tier: medium → sets model: sonnet", () => {
    const fm = makeFrontmatter({ model_tier: "medium" });
    validateAgentFrontmatter(fm, "agents/test.md");
    expect(fm.model).toBe("sonnet");
  });

  it("model_tier: small → sets model: haiku", () => {
    const fm = makeFrontmatter({ model_tier: "small" });
    validateAgentFrontmatter(fm, "agents/test.md");
    expect(fm.model).toBe("haiku");
  });

  it("does not emit a deprecation warning for new shape", () => {
    const warnSpy = spyOn(console, "warn");
    const fm = makeFrontmatter({ model_tier: "medium" });
    validateAgentFrontmatter(fm, "agents/new-shape-agent.md");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 2. Legacy-only shape: model: opus|sonnet|haiku → bw-compat + deprecation warn
// ---------------------------------------------------------------------------

describe("validateAgentFrontmatter — legacy shape (model: only)", () => {
  // Use unique file paths per test to bypass the one-time-per-session dedup set.
  it("model: opus → sets model_tier: large and keeps model: opus", () => {
    const fm = makeFrontmatter({ model: "opus" });
    validateAgentFrontmatter(fm, "agents/legacy-opus.md");
    expect(fm.model_tier).toBe("large");
    expect(fm.model).toBe("opus");
  });

  it("model: sonnet → sets model_tier: medium and keeps model: sonnet", () => {
    const fm = makeFrontmatter({ model: "sonnet" });
    validateAgentFrontmatter(fm, "agents/legacy-sonnet.md");
    expect(fm.model_tier).toBe("medium");
    expect(fm.model).toBe("sonnet");
  });

  it("model: haiku → sets model_tier: small and keeps model: haiku", () => {
    const fm = makeFrontmatter({ model: "haiku" });
    validateAgentFrontmatter(fm, "agents/legacy-haiku.md");
    expect(fm.model_tier).toBe("small");
    expect(fm.model).toBe("haiku");
  });

  it("emits a deprecation warning for legacy model: field", () => {
    const warnSpy = spyOn(console, "warn");
    const fm = makeFrontmatter({ model: "sonnet" });
    validateAgentFrontmatter(fm, "agents/legacy-warn-test.md");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("legacy `model: sonnet` frontmatter");
    expect(msg).toContain("model_tier");
    expect(msg).toContain("v0.7");
    warnSpy.mockRestore();
  });

  it("emits the warning at most once per file path per session", () => {
    const warnSpy = spyOn(console, "warn");
    const filePath = "agents/legacy-dedup-once.md";
    // First call
    validateAgentFrontmatter(makeFrontmatter({ model: "opus" }), filePath);
    // Second call with the same path
    validateAgentFrontmatter(makeFrontmatter({ model: "opus" }), filePath);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. Both-present shape: model_tier takes precedence, no warning
// ---------------------------------------------------------------------------

describe("validateAgentFrontmatter — both model_tier and model present", () => {
  it("prefers model_tier over model when both are present", () => {
    const fm = makeFrontmatter({ model_tier: "large", model: "sonnet" });
    validateAgentFrontmatter(fm, "agents/both-present.md");
    // model_tier: large → opus wins over the legacy 'sonnet'
    expect(fm.model).toBe("opus");
  });

  it("does not emit a deprecation warning when model_tier is present", () => {
    const warnSpy = spyOn(console, "warn");
    const fm = makeFrontmatter({ model_tier: "small", model: "haiku" });
    validateAgentFrontmatter(fm, "agents/both-no-warn.md");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4. Malformed cases → throw with file path in error message
// ---------------------------------------------------------------------------

describe("validateAgentFrontmatter — malformed cases", () => {
  it("throws when model_tier is an unknown value", () => {
    const fm = makeFrontmatter({ model_tier: "xlarge" });
    expect(() => validateAgentFrontmatter(fm, "agents/bad-tier.md")).toThrow(
      /unknown model_tier 'xlarge'/,
    );
    expect(() => validateAgentFrontmatter(makeFrontmatter({ model_tier: "xlarge" }), "agents/bad-tier-path.md")).toThrow(
      /agents\/bad-tier-path\.md/,
    );
  });

  it("throws when legacy model is an unknown value", () => {
    const fm = makeFrontmatter({ model: "gpt-4" });
    expect(() => validateAgentFrontmatter(fm, "agents/bad-model.md")).toThrow(
      /unknown legacy model 'gpt-4'/,
    );
    expect(() => validateAgentFrontmatter(makeFrontmatter({ model: "gpt-4" }), "agents/bad-model-path.md")).toThrow(
      /agents\/bad-model-path\.md/,
    );
  });

  it("throws when neither model nor model_tier is provided", () => {
    const fm = makeFrontmatter({});
    expect(() => validateAgentFrontmatter(fm, "agents/no-model.md")).toThrow(
      /missing required frontmatter field/,
    );
  });

  it("throws when name is missing, including file path in message", () => {
    const fm: Record<string, unknown> = {
      description: "desc",
      model_tier: "medium",
      tools: ["Read"],
    };
    expect(() => validateAgentFrontmatter(fm, "agents/no-name.md")).toThrow(
      /agents\/no-name\.md/,
    );
  });

  it("throws when tools is empty, including file path in message", () => {
    const fm = makeFrontmatter({ model_tier: "medium", tools: [] });
    expect(() => validateAgentFrontmatter(fm, "agents/empty-tools.md")).toThrow(
      /agents\/empty-tools\.md/,
    );
  });

  it("throws when tools contains non-strings", () => {
    const fm = makeFrontmatter({ model_tier: "medium", tools: [1, 2] });
    expect(() => validateAgentFrontmatter(fm, "agents/bad-tools.md")).toThrow(
      /agents\/bad-tools\.md/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Snapshot test — output model: values are byte-equivalent to pre-migration
// ---------------------------------------------------------------------------

describe("Tier → Anthropic model output equivalence (snapshot)", () => {
  /**
   * Before migration: `model: opus` in source → `model: opus` in .claude/agents.
   * After migration: `model_tier: large` in source → converter sets model=opus → same output.
   * This verifies R-07: the regression-safety round-trip produces identical output.
   */
  const snapshotCases: Array<{ tier: string; expectedModel: string }> = [
    { tier: "large", expectedModel: "opus" },
    { tier: "medium", expectedModel: "sonnet" },
    { tier: "small", expectedModel: "haiku" },
  ];

  for (const { tier, expectedModel } of snapshotCases) {
    it(`model_tier: ${tier} → output model: ${expectedModel} (byte-equivalent)`, () => {
      const fm = makeFrontmatter({ model_tier: tier });
      validateAgentFrontmatter(fm, `agents/snapshot-${tier}.md`);
      expect(fm.model).toBe(expectedModel);
    });
  }
});
