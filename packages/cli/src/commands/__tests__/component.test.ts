/**
 * component.test.ts — Integration tests for the `software-teams component` CLI.
 *
 * Exercises the three public subcommands (get, list, validate) plus the
 * legacy plural-command retirement assertion via Bun.spawn against the built
 * dist/index.js. All tests accept the pre-T11 exit-code contract for validate.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
import { join } from "node:path";

// Paths
const REPO_ROOT = join(import.meta.dir, "../../..");
const DIST_INDEX = join(REPO_ROOT, "dist-test/index.js");

/**
 * Helper: spawn the CLI synchronously and return the result.
 *
 * NODE_ENV is scrubbed because the test-only bundle was built while
 * `NODE_ENV=test` was in the parent's env (bun test sets that). Bun's
 * bundler inlines `process.env` truthy checks at build time, so the bundled
 * consola binding goes silent under NODE_ENV=test, swallowing the CLI's
 * table output and any errors. Force it back to a non-test value at spawn.
 */
function runCLI(args: string[]) {
  const env = { ...process.env, NODE_ENV: "production" } as Record<string, string>;
  const result = spawnSync(["bun", "run", DIST_INDEX, ...args], {
    cwd: REPO_ROOT,
    env,
  });

  const stdout = result.stdout ? Buffer.from(result.stdout).toString("utf-8") : "";
  const stderr = result.stderr ? Buffer.from(result.stderr).toString("utf-8") : "";
  const exitCode = result.exitCode ?? 0;

  return {
    exitCode,
    stdout,
    stderr,
    combined: stdout + stderr,
  };
}

describe("software-teams component CLI", () => {
  /**
   * Build a test-only bundle before running any CLI tests.
   *
   * IMPORTANT: outdir is `dist-test/`, NOT `dist/`. The canonical `dist/` is
   * produced by `bun run build` (with the package's pinned `--target=node`)
   * and is what `npm publish` ships. Overwriting it here would replace the
   * publish artefact with a default-target build whose Bun.build() inherits
   * a different __require shim on Linux CI — that's how 0.2.0–0.2.3 shipped
   * broken bundles despite passing the publish-time smoke tests.
   */
  beforeAll(async () => {
    // Bun bakes `process.env.NODE_ENV` into the bundle at build time. Inside
    // `bun test` the parent's NODE_ENV is "test", which (via consola's level
    // detection) silences all CLI output and breaks every assertion below.
    // Pin to "production" via `define` so the bundled consola behaves the
    // same as it does in a normal user install.
    const buildResult = await Bun.build({
      entrypoints: [join(REPO_ROOT, "src", "index.ts")],
      outdir: join(REPO_ROOT, "dist-test"),
      format: "esm",
      target: "bun",
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
    });

    if (!buildResult.success) {
      throw new Error("Build failed before CLI tests");
    }
  });

  describe("component list", () => {
    test("exits 0 and prints component rows (table format)", () => {
      const result = runCLI(["component", "list"]);
      expect(result.exitCode).toBe(0);

      // Count components by matching rows whose category column is one of the
      // canonical categories.
      const lines = result.stdout.split("\n").filter(Boolean);
      const categoryKeywords = [
        "meta",
        "execution",
        "planning",
        "quality",
        "hooks",
        "stacks",
      ];
      let componentCount = 0;
      for (const line of lines) {
        if (categoryKeywords.some((cat) => line.includes(cat))) {
          componentCount++;
        }
      }

      expect(componentCount).toBeGreaterThanOrEqual(20);

      // Verify component names are in the output.
      expect(result.stdout).toContain("Verify");
      expect(result.stdout).toContain("AgentBase");
    });

    test("exits 0 with --json flag and parses as valid JSON (registry surface)", () => {
      const result = runCLI(["component", "list", "--json"]);
      expect(result.exitCode).toBe(0);

      const registry = JSON.parse(result.stdout);
      const keys = Object.keys(registry);
      // Phase C added hooks/ + stacks/ components on top of the 16-module
      // 3-01 baseline, so the count is no longer fixed; assert at-least.
      expect(keys.length).toBeGreaterThanOrEqual(16);

      // Verify some known components exist (3-01 + Phase C samples).
      expect(keys).toContain("Verify");
      expect(keys).toContain("AgentBase");
      expect(keys).toContain("PreCommit");
      expect(keys).toContain("PhpLaravel");
    });
  });

  describe("component get", () => {
    test("exits 0 and returns non-empty body for known component", () => {
      const result = runCLI(["component", "get", "Verify"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);

      // Verify includes content from the Verify component (check for characteristic text).
      expect(result.stdout).toContain("Determine scope");
    });

    test("exits 0 with section argument and returns shorter body", () => {
      const fullResult = runCLI(["component", "get", "Verify"]);
      const sectionResult = runCLI(["component", "get", "Verify", "Task"]);

      expect(sectionResult.exitCode).toBe(0);
      expect(sectionResult.stdout.length).toBeGreaterThan(0);

      // Section output should be shorter than full component output.
      expect(sectionResult.stdout.length).toBeLessThan(fullResult.stdout.length);
    });

    test("exits 1 with unknown component and stderr contains helpful error", () => {
      const result = runCLI(["component", "get", "UnknownThing"]);
      expect(result.exitCode).toBe(1);

      // Expect a helpful error message in stderr (likely includes "Did you mean").
      expect(result.stderr.toLowerCase()).toMatch(/did you mean|unknown|not found|error/i);
    });

    test("exits 0 with --json flag and returns valid JSON structure", () => {
      const result = runCLI(["component", "get", "Verify", "--json"]);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("name");
      expect(output).toHaveProperty("body");
      expect(output.name).toBe("Verify");
      expect(typeof output.body).toBe("string");
      expect(output.body.length).toBeGreaterThan(0);
    });

    test("exits 0 with --json and section, and includes section in output", () => {
      const result = runCLI(["component", "get", "Verify", "Task", "--json"]);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("section");
      expect(output.section).toBe("Task");
    });
  });

  describe("component validate", () => {
    test("exits 0 on a clean corpus and reports the registry section", () => {
      const result = runCLI(["component", "validate"]);

      // The validator scans @ST: tags across the corpus. The current corpus
      // has no broken refs, so the command exits 0 with a "validated cleanly"
      // message. (This test was originally written when the corpus had
      // intentional broken refs; updated after those were resolved.)
      expect(result.exitCode).toBe(0);
      expect(result.combined).toMatch(/[Rr]egistry/i);
    });
  });

  describe("legacy plural command retirement", () => {
    test("components (plural) exits non-zero with Unknown command error", () => {
      const result = runCLI(["components"]);
      expect(result.exitCode).not.toBe(0);

      // Verify the error mentions the command is unknown.
      const output = result.combined.toLowerCase();
      expect(output).toMatch(/unknown|command|unrecognized/i);
    });
  });
});
