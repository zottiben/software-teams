import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectFrameworkChanges } from "./sync-framework";
import { copyFrameworkFiles } from "../utils/copy-framework";
import { convertAgents } from "../utils/convert-agents";

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

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PACKAGE_ROOT = REPO_ROOT;

/**
 * Build a fixture cwd with a partial Phase-B `.software-teams/` snapshot —
 * a couple of stale doctrine files plus seeded state files — so
 * refresh-detection has something to find. State files (project.yaml etc.)
 * are seeded so we can verify the writer never clobbers them.
 */
async function makeStaleFixture(): Promise<string> {
  const cwd = makeTempDir();
  mkdirSync(join(cwd, ".software-teams", "templates"), { recursive: true });
  mkdirSync(join(cwd, ".software-teams", "rules"), { recursive: true });

  // A stale template file that differs from canonical.
  await writeFile(
    join(cwd, ".software-teams", "templates", "PLAN.md"),
    "STALE — older snapshot content\n",
  );
  // A stale rules file (commits.md exists in the package's rules/ post-Phase D).
  await writeFile(
    join(cwd, ".software-teams", "rules", "commits.md"),
    "STALE commit rules — pre-refresh snapshot\n",
  );

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
    // We seeded only two files into the stale snapshot, so most of the
    // doctrine tree is missing.
    expect(missing.length).toBeGreaterThan(5);
    // The seeded files differ from canonical.
    expect(changed).toContain("templates/PLAN.md");
    expect(changed).toContain("rules/commits.md");
  });

  test("returns empty arrays when snapshot matches canonical", async () => {
    const cwd = makeTempDir();
    // Populate the snapshot from canonical first.
    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    const { missing, changed } = await detectFrameworkChanges(cwd, PACKAGE_ROOT);
    expect(missing).toEqual([]);
    expect(changed).toEqual([]);
  });
});

describe("sync-framework — orchestration", () => {
  test("copyFrameworkFiles + convertAgents refreshes snapshot end-to-end", async () => {
    const cwd = await makeStaleFixture();

    // Confirm pre-state: stale content present.
    const staleBefore = await readFile(
      join(cwd, ".software-teams", "templates", "PLAN.md"),
      "utf-8",
    );
    expect(staleBefore).toContain("STALE");

    // Run the same orchestration the CLI command runs (force=true so it
    // overwrites the stale file).
    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    const conv = await convertAgents({ cwd, sourceDir: join(PACKAGE_ROOT, "agents") });

    // Snapshot updated.
    const refreshed = await readFile(
      join(cwd, ".software-teams", "templates", "PLAN.md"),
      "utf-8",
    );
    expect(refreshed).not.toContain("STALE");

    // Three-tier templates exist post-refresh.
    for (const t of ["SPEC.md", "ORCHESTRATION.md", "PLAN-TASK-AGENT.md", "RULES.md"]) {
      expect(
        existsSync(join(cwd, ".software-teams", "templates", t)),
        `expected template ${t} to be present after refresh`,
      ).toBe(true);
    }

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
