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
 * Build a fixture cwd that contains a partial `.software-teams/framework/` snapshot —
 * a couple of stale files and a few missing ones — so refresh-detection has
 * something to find. State files (PROJECT.yaml etc.) are seeded so we can
 * verify the writer never clobbers them.
 */
async function makeStaleFixture(): Promise<string> {
  const cwd = makeTempDir();
  mkdirSync(join(cwd, ".software-teams", "framework", "agents"), { recursive: true });
  mkdirSync(join(cwd, ".software-teams", "config"), { recursive: true });

  // A stale agent file that differs from canonical.
  await writeFile(
    join(cwd, ".software-teams", "framework", "agents", "software-teams-programmer.md"),
    "STALE — older snapshot content\n",
  );
  // A stale top-level file.
  await writeFile(
    join(cwd, ".software-teams", "framework", "software-teams.md"),
    "STALE software-teams.md — pre-T7 doctrine snapshot\n",
  );

  // Project state files that MUST be preserved.
  await writeFile(join(cwd, ".software-teams", "PROJECT.yaml"), "name: fixture-project\n");
  await writeFile(
    join(cwd, ".software-teams", "REQUIREMENTS.yaml"),
    "requirements: []\n",
  );
  await writeFile(join(cwd, ".software-teams", "ROADMAP.yaml"), "phases: []\n");
  await writeFile(
    join(cwd, ".software-teams", "config", "state.yaml"),
    "current_plan: {phase: 1, plan: 1}\nstate: real-fixture-state\n",
  );

  return cwd;
}

describe("sync-framework — change detection", () => {
  test("detects missing and drifted files in stale snapshot", async () => {
    const cwd = await makeStaleFixture();
    const { missing, changed } = await detectFrameworkChanges(cwd, PACKAGE_ROOT);
    // We seeded only two files into the stale snapshot, so most of the tree
    // is missing.
    expect(missing.length).toBeGreaterThan(20);
    // The two seeded files differ from canonical.
    expect(changed).toContain("agents/software-teams-programmer.md");
    expect(changed).toContain("software-teams.md");
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
    const staleAgentBefore = await readFile(
      join(cwd, ".software-teams", "framework", "agents", "software-teams-programmer.md"),
      "utf-8",
    );
    expect(staleAgentBefore).toContain("STALE");

    // Run the same orchestration the CLI command runs (force=true so it
    // overwrites the stale file).
    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    const conv = await convertAgents({ cwd });

    // Snapshot updated.
    const refreshedAgent = await readFile(
      join(cwd, ".software-teams", "framework", "agents", "software-teams-programmer.md"),
      "utf-8",
    );
    expect(refreshedAgent).not.toContain("STALE");
    expect(refreshedAgent).toContain("name: software-teams-programmer");
    expect(refreshedAgent).toContain("model:");
    expect(refreshedAgent).toContain("tools:");

    // software-teams.md no longer carries the old "non-negotiable platform constraint"
    // wording (T7 doctrine polish).
    const jdiDoc = await readFile(
      join(cwd, ".software-teams", "framework", "software-teams.md"),
      "utf-8",
    );
    expect(jdiDoc).not.toContain("non-negotiable platform constraint");

    // T9 templates exist in the refreshed snapshot.
    for (const t of [
      "SPEC.md",
      "ORCHESTRATION.md",
      "PLAN-TASK-AGENT.md",
      "RULES.md",
      "README.md",
    ]) {
      expect(
        existsSync(join(cwd, ".software-teams", "framework", "templates", t)),
        `expected template ${t} to be present after refresh`,
      ).toBe(true);
    }

    // AGENTS-MODELS.md exists.
    expect(
      existsSync(join(cwd, ".software-teams", "framework", "agents", "AGENTS-MODELS.md")),
    ).toBe(true);

    // convertAgents wrote the native subagent layer.
    expect(conv.errors).toEqual([]);
    expect(conv.written.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ".claude", "agents"))).toBe(true);
  });

  test("does not clobber project state files", async () => {
    const cwd = await makeStaleFixture();

    const beforeProject = await readFile(join(cwd, ".software-teams", "PROJECT.yaml"), "utf-8");
    const beforeReqs = await readFile(join(cwd, ".software-teams", "REQUIREMENTS.yaml"), "utf-8");
    const beforeRoadmap = await readFile(join(cwd, ".software-teams", "ROADMAP.yaml"), "utf-8");
    const beforeState = await readFile(
      join(cwd, ".software-teams", "config", "state.yaml"),
      "utf-8",
    );

    await copyFrameworkFiles(cwd, "node", true, false, PACKAGE_ROOT);
    await convertAgents({ cwd });

    expect(await readFile(join(cwd, ".software-teams", "PROJECT.yaml"), "utf-8")).toBe(beforeProject);
    expect(await readFile(join(cwd, ".software-teams", "REQUIREMENTS.yaml"), "utf-8")).toBe(beforeReqs);
    expect(await readFile(join(cwd, ".software-teams", "ROADMAP.yaml"), "utf-8")).toBe(beforeRoadmap);
    expect(await readFile(join(cwd, ".software-teams", "config", "state.yaml"), "utf-8")).toBe(
      beforeState,
    );
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
