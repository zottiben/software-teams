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
  describe("plan case - split format references", () => {
    test("plan prompt must contain split format keywords (verified via source)", async () => {
      // Read the run.ts source and verify the plan case contains split format references
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();

      // The plan case must reference split format
      expect(source).toMatch(/split format|SPLIT|Plan File Format/i);

      // The plan case must reference task_files
      expect(source).toMatch(/task_files/);

      // The plan case must reference .T{n}.md task file pattern
      expect(source).toMatch(/\.T\{?n?\}?\.md/);
    });

    test("plan prompt must NOT contain inline task detail template", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();

      // Should not have "### T1 " as an inline task detail heading (tasks belong in split files)
      // Note: the manifest table references like "| T1 |" are fine — we're checking for
      // inline detail headings that would indicate monolithic format
      expect(source).not.toMatch(/### T1 [^|]/);
    });
  });

  describe("refinement case - split format references", () => {
    test("refinement prompt references split plan format", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/SPLIT plan format|split format|task files/i);
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

    test("source still calls fenceUserInput for user-request planner fence", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/fenceUserInput\("user-request"/);
    });

    test("source imports fetchIssueTitleAndBody from github utils", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).toContain("fetchIssueTitleAndBody");
      expect(source).toMatch(/from\s+["'].*\/utils\/github["']/);
    });
  });
});
