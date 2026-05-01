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
});
