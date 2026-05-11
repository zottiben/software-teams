import { describe, test, expect } from "bun:test";
import { buildRulesBlock } from "../../../utils/prompt-builder";

/**
 * run.ts (formerly action.ts) builds prompts inline in its switch cases.
 * These tests verify the key invariant phrases that must appear in the
 * prompt templates by testing the shared building blocks used by run.ts.
 *
 * The plan case prompt references "split format" / "Plan File Format" / "SPLIT" inline.
 * The refinement case prompt references "SPLIT plan format" inline.
 * The implement case uses buildRulesBlock from prompt-builder.
 *
 * Since the inline strings in run.ts are string literals within a command handler
 * (not easily importable), we verify the shared functions and document the expected
 * invariants for the inline strings here.
 */

describe("action run command prompt invariants", () => {
  // Phase 2 migration note: the plan-path and refinement prompts now live in
  // `router-prompts.ts` (the helper that `buildRouterPrompt` returns). The
  // assertions below moved with them — the broader prompt-shape invariants
  // for every flow live in `router-prompts.test.ts`. These cases keep the
  // narrow source-presence guards so a future refactor can't silently delete
  // the SPLIT-format and task-file instructions.
  describe("plan case - plan-format references", () => {
    test("router-prompts source drives the planner toward three-tier (canonical Software Teams plan shape)", async () => {
      const source = await Bun.file(new URL("../router-prompts.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/three-tier/i);
      expect(source).toMatch(/Tier Decision Rule/i);
      expect(source).toContain("spec.md");
      expect(source).toContain("orchestration.md");
      expect(source).toMatch(/\.T\{?n?\}?\.md/);
      expect(source).toContain("task_files");
    });

    test("run.ts must NOT contain inline task detail template (no monolithic plan format leaked back)", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).not.toMatch(/### T1 [^|]/);
    });
  });

  describe("refinement case - in-place plan edits", () => {
    test("router-prompts source keeps refinement → in-place edit + tier-preservation guidance", async () => {
      const source = await Bun.file(new URL("../router-prompts.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/update them in place/i);
      expect(source).toMatch(/do NOT switch tiers/);
    });
  });

  describe("implement case - rules", () => {
    test("implement case uses buildRulesBlock", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toContain("buildRulesBlock");
    });

    test("buildRulesBlock output contains rules header", () => {
      const block = buildRulesBlock("typescript").join("\n");
      expect(block).toContain("## Rules");
    });
  });

  describe("label-trigger path", () => {
    test("source defines --event-type arg in citty args block", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/"event-type":\s*\{/);
    });

    test("source defines ALLOWED_EVENT_TYPES allow-list with 'issue_labeled'", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/ALLOWED_EVENT_TYPES\s*=\s*new\s+Set\(\["issue_labeled"\]\)/);
    });

    test("source validates event-type against allow-list and exits non-zero on unknown value", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      // Check for validation logic that rejects unknown event types
      expect(source).toMatch(/ALLOWED_EVENT_TYPES\.has\(args\["event-type"\]\)/);
      // Check that it calls process.exit(1) on validation failure
      expect(source).toMatch(/process\.exit\(1\)/);
    });

    test("source contains branch for args['event-type'] === 'issue_labeled'", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/args\["event-type"\]\s*===\s*"issue_labeled"/);
    });

    test("label-triggered branch calls fetchIssueTitleAndBody", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      // Verify the function is imported
      expect(source).toMatch(/fetchIssueTitleAndBody/);
      // Verify it's called (looking for the actual invocation)
      expect(source).toMatch(/await\s+fetchIssueTitleAndBody\(/);
    });

    test("label-triggered branch calls sanitizeUserInput on the synthetic description", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      // Check that sanitizeUserInput is called after the fetch
      expect(source).toMatch(/sanitizeUserInput\(/);
    });

    test("router-prompts module fences the user-request block (sanitizes user-controlled content)", async () => {
      // After phase 5 cleanup the action runner no longer builds prompts
      // directly — every per-flow prompt lives in router-prompts.ts, which is
      // where `fenceUserInput("user-request", …)` now belongs.
      const source = await Bun.file(new URL("../router-prompts.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/fenceUserInput\("user-request"/);
    });

    test("source imports fetchIssueTitleAndBody from github utils", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toContain("fetchIssueTitleAndBody");
      expect(source).toMatch(/from\s+["'].*\/utils\/github["']/);
    });
  });

  describe("parent-Claude model pin (cost control)", () => {
    test("defines ACTION_MODEL backed by SOFTWARE_TEAMS_MODEL env var", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      // Constant lives at module scope so all three spawnClaude call sites share it.
      expect(source).toMatch(/const\s+ACTION_MODEL\s*=\s*process\.env\.SOFTWARE_TEAMS_MODEL\s*\|\|\s*["']claude-sonnet-4-6["']/);
    });

    test("every spawnClaude call in the action runner threads model: ACTION_MODEL", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      const spawnCalls = source.match(/await\s+spawnClaude\([\s\S]*?\)\s*;/g) ?? [];
      expect(spawnCalls.length).toBeGreaterThanOrEqual(3); // label plan, comment-driven, full-flow impl
      for (const call of spawnCalls) {
        expect(call).toMatch(/model:\s*ACTION_MODEL/);
      }
    });
  });

  describe("trigger phrase", () => {
    test("parseComment regex matches the 'Hey Software Teams' trigger (spaced or hyphenated)", async () => {
      // Locked-in source guard — parseComment regex is internal, so verify
      // via source text. The `software[\s-]?teams` segment accepts both
      // "Hey Software Teams" (user-friendly spaced form) and
      // "Hey software-teams" (legacy hyphenated form).
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      const re = source.match(/hey\\s\+software\[\\s-\]\?teams\\s\+\(\.\+\)/);
      expect(re).not.toBeNull();
    });

    test("thinking placeholder uses the chat-like header, not the legacy brand format", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toContain("🧠 Working on it...");
      expect(source).not.toMatch(/🧠 Software Teams <sup>thinking<\/sup>/);
    });

    test("approval message points users to the 'Hey Software Teams' trigger", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/Hey Software Teams implement/);
    });
  });
});
