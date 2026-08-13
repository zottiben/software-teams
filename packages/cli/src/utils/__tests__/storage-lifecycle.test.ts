import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SoftwareTeamsStorage } from "../../storage";
import { loadPersistedState, savePersistedState } from "../storage-lifecycle";

const dirs: string[] = [];
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-storage-rules-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memoryStorage(initial: Record<string, string> = {}): SoftwareTeamsStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async load(key) { return values.get(key) ?? null; },
    async save(key, content) { values.set(key, content); },
  } as SoftwareTeamsStorage & { values: Map<string, string> };
}

describe("persisted native rules", () => {
  test("hydrates stored rule bodies into path-scoped .claude/rules files", async () => {
    const cwd = fixture();
    const storage = memoryStorage({ "rules-frontend": "# Frontend\n- Use tokens" });
    const result = await loadPersistedState(cwd, storage);
    expect(result.rulesPath).toBe(join(cwd, ".claude", "rules"));
    const content = readFileSync(join(cwd, ".claude", "rules", "frontend.md"), "utf8");
    expect(content).toContain("paths:");
    expect(content).toContain("Use tokens");
  });

  test("saves native rule content under the compatible storage key", async () => {
    const cwd = fixture();
    const storage = memoryStorage({ "rules-testing": "# Testing\n- Run focused tests" });
    await loadPersistedState(cwd, storage);
    storage.values.delete("rules-testing");
    const result = await savePersistedState(cwd, storage);
    expect(result.rulesSaved).toBe(true);
    expect(storage.values.get("rules-testing")).toContain("Run focused tests");
  });
});
