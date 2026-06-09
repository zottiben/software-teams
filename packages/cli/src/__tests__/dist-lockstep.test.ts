/**
 * Regression guard: `dist/index.js` must be built, committed, and free of
 * empty-object stubs.
 *
 * The publish workflow (`.github/workflows/publish.yml`) has a lockstep check
 * that fails the release if dist/index.js is missing, out of sync, or contains
 * stub code. That check runs in CI AFTER push, which means every broken push
 * wastes a CI run and blocks the release. This test catches the same issues
 * locally during `bun test`, BEFORE the push — so a build that forgot to run
 * `bun run build` or a bundle corrupted by stub code never reaches main.
 *
 * Bun's bundler has shipped builds that emit empty `var {existsSync} =
 * (() => ({}))` stubs when imports cannot be resolved. Tests pass against
 * source, but these stubs break runtime, so we detect them here.
 *
 * If you're bumping the version, commit both files in the same commit:
 *   - Run `bun run build` to generate a fresh dist/index.js
 *   - Commit dist/index.js in the same commit as the version bump
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

describe("dist lockstep", () => {
  test("dist/index.js exists", () => {
    const distPath = join(repoRoot, "dist", "index.js");
    expect(existsSync(distPath)).toBe(true);
  });

  test("dist/index.js is git-tracked (committed)", () => {
    const distPath = "dist/index.js";
    // Check if file is in the git index (i.e. committed)
    try {
      execSync(`git ls-files --error-unmatch ${distPath}`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
      // If command succeeds, file is tracked
      expect(true).toBe(true);
    } catch {
      expect.unreachable("dist/index.js is not committed to git");
    }
  });

  test("dist/index.js is non-trivial in size (> 10KB)", () => {
    const distPath = join(repoRoot, "dist", "index.js");
    const stats = Bun.file(distPath);
    const size = stats.size ?? 0;
    expect(size).toBeGreaterThan(10 * 1024);
  });

  test("dist/index.js contains NO empty-object stubs (exact regex from publish.yml)", () => {
    const distPath = join(repoRoot, "dist", "index.js");
    const bundleContent = readFileSync(distPath, "utf-8");

    // The exact stub-detector regex from .github/workflows/publish.yml:
    // Matches literal source: = (() => ({}))
    const stubRegex = /= \(\(\) => \(\{\}\)\)/;

    expect(bundleContent).not.toMatch(stubRegex);
  });
});
