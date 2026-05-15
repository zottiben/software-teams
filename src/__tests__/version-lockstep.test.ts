/**
 * Regression guard: `package.json` and `.claude-plugin/plugin.json`
 * versions MUST match.
 *
 * The publish workflow (`.github/workflows/publish.yml`) has a
 * lockstep check that fails the release if they disagree. That check
 * runs in CI AFTER push, which means every mismatched push wastes a
 * CI run and blocks the release until a follow-up commit lands. This
 * test catches the same mismatch locally during `bun test`, BEFORE
 * the push — so a release bump that forgets one of the two files
 * never reaches main.
 *
 * If you're updating versions, bump both files in the same commit:
 *   - package.json (the npm-publish version)
 *   - .claude-plugin/plugin.json (the Claude Code plugin manifest)
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

describe("version lockstep", () => {
  test("package.json and .claude-plugin/plugin.json carry the same version string", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    const plugin = JSON.parse(readFileSync(join(repoRoot, ".claude-plugin", "plugin.json"), "utf-8"));
    expect(pkg.version).toBeTruthy();
    expect(plugin.version).toBeTruthy();
    expect(plugin.version).toBe(pkg.version);
  });
});
