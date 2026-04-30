import { describe, test, expect } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { cp } from "fs/promises";
import { buildPlugin } from "./utils/build-plugin";

const REPO_ROOT = join(import.meta.dir, "..");

/**
 * Helper: recursively list all files in a directory with their content hashes.
 * Returns a map of relative path -> file content for easy diffing.
 */
function snapshotDirectory(dirPath: string): Record<string, string> {
  const snapshot: Record<string, string> = {};

  function walk(dir: string, prefix: string = "") {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else {
          const content = readFileSync(fullPath, "utf-8");
          snapshot[relPath] = content;
        }
      }
    } catch {
      // Directory may not exist or be inaccessible
    }
  }

  walk(dirPath);
  return snapshot;
}

/**
 * Helper: deep compare two snapshots, return list of differences
 */
function diffSnapshots(
  snapshot1: Record<string, string>,
  snapshot2: Record<string, string>,
): string[] {
  const diffs: string[] = [];
  const allKeys = new Set([...Object.keys(snapshot1), ...Object.keys(snapshot2)]);

  for (const key of allKeys) {
    const content1 = snapshot1[key];
    const content2 = snapshot2[key];

    if (content1 === undefined) {
      diffs.push(`Missing in first snapshot: ${key}`);
    } else if (content2 === undefined) {
      diffs.push(`Missing in second snapshot: ${key}`);
    } else if (content1 !== content2) {
      diffs.push(`Content differs: ${key}`);
    }
  }

  return diffs;
}

/**
 * DETERMINISM TEST OVERVIEW:
 *
 * This test verifies that the build-plugin generator is deterministic:
 * running it twice against the same source tree produces byte-identical
 * output (zero git diff). This is critical for CI — we need to detect
 * if the build step has non-deterministic behavior (e.g., timestamps,
 * random ordering, floating-point rounding).
 *
 * Execution plan:
 * 1. Create a temporary repo copy (safe isolation from the real tree).
 * 2. Run buildPlugin() once → snapshot agents/ + commands/ trees.
 * 3. Clean the output directories (agents/, commands/).
 * 4. Run buildPlugin() again → snapshot the same trees.
 * 5. Assert snapshots are identical (zero diffs).
 *
 * This is a structural surrogate for "CI runs the build and diffs against
 * committed content"; the full integration test is when the CI script
 * actually invokes `software-teams build-plugin` and `git diff --exit-code`.
 *
 * NOTE: This test does NOT verify correctness of the build output (that
 * is covered by plugin-manifest.test.ts and plugin-content-tree.test.ts),
 * only that two runs produce identical results.
 */
describe("plugin build determinism", () => {
  test("build-plugin produces identical output on two consecutive runs (deterministic)", async () => {
    // Create isolated temp repo copy
    let tempRepoRoot: string | null = null;
    try {
      tempRepoRoot = mkdtempSync(join(tmpdir(), "st-plugin-det-"));

      // Copy framework/ source
      const sourceFrameworkDir = join(REPO_ROOT, "framework");
      const tempFrameworkDir = join(tempRepoRoot, "framework");
      await cp(sourceFrameworkDir, tempFrameworkDir, { recursive: true });

      // Run build once
      const result1 = await buildPlugin({ repoRoot: tempRepoRoot });
      expect(result1.errors.length).toBe(0);

      // Snapshot the output
      const snapshot1_agents = snapshotDirectory(join(tempRepoRoot, "agents"));
      const snapshot1_commands = snapshotDirectory(join(tempRepoRoot, "commands"));

      // Clean the output directories (but keep the directories themselves)
      const agentsDir = join(tempRepoRoot, "agents");
      const commandsDir = join(tempRepoRoot, "commands");
      try {
        for (const file of readdirSync(agentsDir)) {
          rmSync(join(agentsDir, file), { recursive: true, force: true });
        }
        for (const file of readdirSync(commandsDir)) {
          rmSync(join(commandsDir, file), { recursive: true, force: true });
        }
      } catch {
        // Directories may not exist; skip
      }

      // Run build again
      const result2 = await buildPlugin({ repoRoot: tempRepoRoot });
      expect(result2.errors.length).toBe(0);

      // Snapshot the output again
      const snapshot2_agents = snapshotDirectory(join(tempRepoRoot, "agents"));
      const snapshot2_commands = snapshotDirectory(join(tempRepoRoot, "commands"));

      // Assert snapshots are identical
      const diffs_agents = diffSnapshots(snapshot1_agents, snapshot2_agents);
      const diffs_commands = diffSnapshots(snapshot1_commands, snapshot2_commands);

      if (diffs_agents.length > 0) {
        console.error("Agents diffs:", diffs_agents);
      }
      if (diffs_commands.length > 0) {
        console.error("Commands diffs:", diffs_commands);
      }

      expect(diffs_agents).toEqual([]);
      expect(diffs_commands).toEqual([]);
    } finally {
      if (tempRepoRoot) {
        rmSync(tempRepoRoot, { recursive: true, force: true });
      }
    }
  });

  test("build-plugin does not throw errors on valid input", async () => {
    const result = await buildPlugin({ repoRoot: REPO_ROOT });
    expect(result.errors.length).toBe(0);
    expect(result.agentsWritten.length).toBeGreaterThanOrEqual(24);
    expect(result.commandsWritten.length).toBeGreaterThanOrEqual(12);
  });

  test("build-plugin reports written files", async () => {
    const result = await buildPlugin({ repoRoot: REPO_ROOT });
    expect(result.agentsWritten).toBeDefined();
    expect(Array.isArray(result.agentsWritten)).toBe(true);
    expect(result.commandsWritten).toBeDefined();
    expect(Array.isArray(result.commandsWritten)).toBe(true);
  });

  test("build-plugin dry-run does not write files", async () => {
    let tempRepoRoot: string | null = null;
    try {
      tempRepoRoot = mkdtempSync(join(tmpdir(), "st-plugin-dry-"));

      // Copy framework/ source
      const sourceFrameworkDir = join(REPO_ROOT, "framework");
      const tempFrameworkDir = join(tempRepoRoot, "framework");
      await cp(sourceFrameworkDir, tempFrameworkDir, { recursive: true });

      // Run in dry-run mode
      const result = await buildPlugin({ repoRoot: tempRepoRoot, dryRun: true });
      expect(result.errors.length).toBe(0);

      // Verify no files were actually written (agents/ and commands/ should be empty)
      const agentsDir = join(tempRepoRoot, "agents");
      const commandsDir = join(tempRepoRoot, "commands");

      // These directories should not exist (buildPlugin creates them on write, not on dry-run)
      // If they do exist, they should be empty
      let agentsExist = false;
      let commandsExist = false;
      try {
        const agentFiles = readdirSync(agentsDir);
        agentsExist = agentFiles.length > 0;
      } catch {
        // Directory doesn't exist, which is fine for dry-run
      }
      try {
        const cmdFiles = readdirSync(commandsDir);
        commandsExist = cmdFiles.length > 0;
      } catch {
        // Directory doesn't exist, which is fine for dry-run
      }

      // Dry-run should not create files
      expect(agentsExist).toBe(false);
      expect(commandsExist).toBe(false);
    } finally {
      if (tempRepoRoot) {
        rmSync(tempRepoRoot, { recursive: true, force: true });
      }
    }
  });
});
