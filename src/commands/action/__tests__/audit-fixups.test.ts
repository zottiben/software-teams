import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

/**
 * audit-fixups.test.ts — verify that T3 audit fix-ups remain applied.
 *
 * Tests that stale paths (.software-teams/framework/agents, etc.) are gone
 * and new guard patterns are in place.
 */

describe("audit fix-ups (stale paths removed, guard patterns applied)", () => {
  test("src/commands/action/run.ts contains zero matches of '.software-teams/framework/agents'", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../run.ts")).text();
    const matches = source.match(/\.software-teams\/framework\/agents/g);
    expect(matches).toBeNull();
  });

  test("action/action.yml contains zero matches of '.software-teams/framework/agents'", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../../action/action.yml")).text();
    const matches = source.match(/\.software-teams\/framework\/agents/g);
    expect(matches).toBeNull();
  });

  test("action/action.yml does not contain legacy state.yaml reference (or only in legacy fallback)", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../../../action/action.yml")).text();
    const lines = source.split("\n");
    let hasStaleReference = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check if this line contains the legacy state path
      if (line.includes(".software-teams/config/state.yaml")) {
        // Allow it only if it's part of the legacy fallback check (! -f pattern)
        if (!line.includes("! -f") && !line.includes("test")) {
          hasStaleReference = true;
        }
      }
    }

    expect(hasStaleReference).toBe(false);
  });

  test("src/commands/action/bootstrap.ts contains the new guard pattern for needsInit", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../bootstrap.ts")).text();
    // Check for the pattern: needsInit = !existsSync(phaseBState) && !existsSync(legacyState)
    expect(source).toMatch(
      /needsInit\s*=\s*!existsSync\(phaseBState\)\s*&&\s*!existsSync\(legacyState\)/,
    );
  });

  test("src/commands/action/bootstrap.ts imports from node:fs and node:path correctly", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../bootstrap.ts")).text();
    expect(source).toMatch(/import.*existsSync.*from\s+["']node:fs/);
    expect(source).toMatch(/import.*join.*from\s+["']node:path/);
  });

  test("src/commands/action/bootstrap.ts defines phaseBState path correctly", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../bootstrap.ts")).text();
    expect(source).toMatch(/phaseBState\s*=.*\.software-teams\/state\.yaml/);
  });

  test("src/commands/action/bootstrap.ts defines legacyState path correctly", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../bootstrap.ts")).text();
    expect(source).toMatch(/legacyState\s*=.*\.software-teams\/config\/state\.yaml/);
  });
});
