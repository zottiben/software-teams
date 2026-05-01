import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { convertAgents } from "../utils/convert-agents";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-sync-idem-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const REPO_ROOT = join(import.meta.dir, "..", "..");

async function makeFixtureCwd(): Promise<string> {
  const cwd = makeTempDir();
  // agents/ + templates/ both live at the repo root after Phase A retired the
  // `framework/` wrapper.
  await Bun.$`ln -s ${join(REPO_ROOT, "agents")} ${join(cwd, "agents")}`.quiet();
  await Bun.$`ln -s ${join(REPO_ROOT, "templates")} ${join(cwd, "templates")}`.quiet();
  return cwd;
}

describe("sync-agents — idempotency (wave-1 integration)", () => {
  test("running sync-agents twice produces zero diffs in .claude/agents/", async () => {
    const cwd = await makeFixtureCwd();

    // First run
    const result1 = await convertAgents({ cwd });
    expect(result1.errors).toEqual([]);

    const agentsDir = join(cwd, ".claude", "agents");
    const firstRunSnapshot: Record<string, string> = {};
    for (const f of readdirSync(agentsDir)) {
      firstRunSnapshot[f] = await readFile(join(agentsDir, f), "utf-8");
    }

    // Second run (idempotency check)
    const result2 = await convertAgents({ cwd });
    expect(result2.errors).toEqual([]);

    const secondRunFiles = readdirSync(agentsDir);
    expect(secondRunFiles.length).toBe(Object.keys(firstRunSnapshot).length);

    for (const f of secondRunFiles) {
      const secondContent = await readFile(join(agentsDir, f), "utf-8");
      expect(secondContent).toBe(firstRunSnapshot[f]);
    }
  });

  test("running sync-agents twice produces zero diffs in .claude/AGENTS.md", async () => {
    const cwd = await makeFixtureCwd();

    await convertAgents({ cwd });
    const agentsMdFirstRun = await readFile(join(cwd, ".claude", "AGENTS.md"), "utf-8");

    await convertAgents({ cwd });
    const agentsMdSecondRun = await readFile(join(cwd, ".claude", "AGENTS.md"), "utf-8");

    expect(agentsMdSecondRun).toBe(agentsMdFirstRun);
  });

  test("running sync-agents twice produces zero diffs in .claude/RULES.md", async () => {
    const cwd = await makeFixtureCwd();

    await convertAgents({ cwd });
    const rulesMdFirstRun = await readFile(join(cwd, ".claude", "RULES.md"), "utf-8");

    await convertAgents({ cwd });
    const rulesMdSecondRun = await readFile(join(cwd, ".claude", "RULES.md"), "utf-8");

    expect(rulesMdSecondRun).toBe(rulesMdFirstRun);
  });
});
