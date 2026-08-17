import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectFrameworkChanges } from "../sync-framework";
import { copyFrameworkFiles, detectSkillChanges } from "../../utils/copy-framework";
import { convertAgents } from "../../utils/convert-agents";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-syncfw-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PACKAGE_ROOT = REPO_ROOT;

/**
 * Build a fixture with stale framework-owned native doctrine plus legacy
 * pre-1.0 rules and seeded state files.
 */
async function makeStaleFixture(): Promise<string> {
  const cwd = makeTempDir();
  mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
  mkdirSync(join(cwd, ".software-teams", "rules"), { recursive: true });
  await writeFile(join(cwd, ".claude", "rules", "software-teams.md"), "STALE doctrine\n");
  await writeFile(join(cwd, ".software-teams", "rules", "general.md"), "# General\n- Learned rule\n");

  // Project state files that MUST be preserved.
  await writeFile(join(cwd, ".software-teams", "project.yaml"), "name: fixture-project\n");
  await writeFile(join(cwd, ".software-teams", "requirements.yaml"), "requirements: []\n");
  await writeFile(join(cwd, ".software-teams", "roadmap.yaml"), "phases: []\n");
  await writeFile(
    join(cwd, ".software-teams", "state.yaml"),
    "current_plan: {phase: 1, plan: 1}\nstate: real-fixture-state\n",
  );

  return cwd;
}

describe("sync-framework — change detection", () => {
  test("detects missing and drifted files in stale snapshot", async () => {
    const cwd = await makeStaleFixture();
    const { missing, changed } = await detectFrameworkChanges(cwd, PACKAGE_ROOT);
    expect(missing).toEqual([]);
    expect(changed).toContain("software-teams.md");
  });

  test("detects missing native skills independently of rule drift", async () => {
    const cwd = makeTempDir();
    const { missing } = await detectSkillChanges(cwd, PACKAGE_ROOT);
    expect(missing).toContain(join("st-create-plan", "SKILL.md"));
  });

  test("returns empty arrays when rules and native skills match canonical", async () => {
    const cwd = makeTempDir();
    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    const rules = await detectFrameworkChanges(cwd, PACKAGE_ROOT);
    const skills = await detectSkillChanges(cwd, PACKAGE_ROOT);
    expect(rules).toEqual({ missing: [], changed: [] });
    expect(skills).toEqual({ missing: [], changed: [] });
  });
});

describe("sync-framework — orchestration", () => {
  test("copyFrameworkFiles + convertAgents refreshes snapshot end-to-end", async () => {
    const cwd = await makeStaleFixture();

    expect(await readFile(join(cwd, ".claude", "rules", "software-teams.md"), "utf-8")).toContain("STALE");

    // Run the same orchestration the CLI command runs (force=true so it
    // overwrites the stale file).
    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    const conv = await convertAgents({ cwd, sourceDir: join(PACKAGE_ROOT, "agents") });

    const refreshed = await readFile(join(cwd, ".claude", "rules", "software-teams.md"), "utf-8");
    expect(refreshed).not.toContain("STALE");
    expect(await readFile(join(cwd, ".claude", "rules", "general.md"), "utf-8")).toContain("Learned rule");
    expect(existsSync(join(cwd, ".software-teams", "rules"))).toBe(false);

    // Phase D: templates/ is no longer copied into `.software-teams/` —
    // verify the directory is absent post-refresh.
    expect(existsSync(join(cwd, ".software-teams", "templates"))).toBe(false);

    // convertAgents wrote the native subagent layer.
    expect(conv.errors).toEqual([]);
    expect(conv.written.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ".claude", "agents"))).toBe(true);
  });

  test("does not clobber project state files", async () => {
    const cwd = await makeStaleFixture();

    const beforeProject = await readFile(join(cwd, ".software-teams", "project.yaml"), "utf-8");
    const beforeReqs = await readFile(join(cwd, ".software-teams", "requirements.yaml"), "utf-8");
    const beforeRoadmap = await readFile(join(cwd, ".software-teams", "roadmap.yaml"), "utf-8");
    const beforeState = await readFile(join(cwd, ".software-teams", "state.yaml"), "utf-8");

    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    await convertAgents({ cwd, sourceDir: join(PACKAGE_ROOT, "agents") });

    expect(await readFile(join(cwd, ".software-teams", "project.yaml"), "utf-8")).toBe(beforeProject);
    expect(await readFile(join(cwd, ".software-teams", "requirements.yaml"), "utf-8")).toBe(beforeReqs);
    expect(await readFile(join(cwd, ".software-teams", "roadmap.yaml"), "utf-8")).toBe(beforeRoadmap);
    expect(await readFile(join(cwd, ".software-teams", "state.yaml"), "utf-8")).toBe(beforeState);
  });

  test("post-refresh: detectFrameworkChanges reports clean", async () => {
    const cwd = await makeStaleFixture();
    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    await convertAgents({ cwd });

    const { missing, changed } = await detectFrameworkChanges(cwd, PACKAGE_ROOT);
    expect(missing).toEqual([]);
    expect(changed).toEqual([]);
  });
});
