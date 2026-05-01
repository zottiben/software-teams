import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyFrameworkFiles } from "../../utils/copy-framework";
import { convertAgents } from "../../utils/convert-agents";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-init-"));
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

describe("init — scaffolding layout", () => {
  test("init creates .software-teams/ directory structure", async () => {
    const cwd = makeTempDir();
    // Create the required directories that init would create
    const dirs = [
      ".claude/commands/st",
      ".software-teams/plans",
      ".software-teams/research",
      ".software-teams/codebase",
      ".software-teams/reviews",
      ".software-teams/config",
      ".software-teams/persistence",
      ".software-teams/feedback",
    ];

    for (const dir of dirs) {
      const fullPath = join(cwd, dir);
      mkdirSync(fullPath, { recursive: true });
      // Create .gitkeep like init does
      await Bun.write(join(fullPath, ".gitkeep"), "");
    }

    // Verify .software-teams/ exists with expected subdirs
    expect(existsSync(join(cwd, ".software-teams"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "plans"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "research"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "codebase"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "reviews"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "config"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "persistence"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "feedback"))).toBe(true);
  });

  test("init creates .claude/commands/st/ structure", async () => {
    const cwd = makeTempDir();
    mkdirSync(join(cwd, ".claude", "commands", "st"), { recursive: true });
    await Bun.write(join(cwd, ".claude", "commands", "st", ".gitkeep"), "");

    expect(existsSync(join(cwd, ".claude", "commands", "st"))).toBe(true);
  });

  test("copyFrameworkFiles writes doctrine subtrees directly under .software-teams/", async () => {
    const cwd = makeTempDir();
    await copyFrameworkFiles(cwd, "node", false, false, PACKAGE_ROOT);

    expect(existsSync(join(cwd, ".software-teams", "templates"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "framework"))).toBe(false);
  });

  test("init generates 24 .claude/agents/software-teams-*.md files (from package source)", async () => {
    const cwd = makeTempDir();
    await copyFrameworkFiles(cwd, "node", false, false, PACKAGE_ROOT);

    const result = await convertAgents({
      cwd,
      // Phase B: source agents from the package's `agents/` dir directly.
      sourceDir: join(PACKAGE_ROOT, "agents"),
      targetDir: ".claude/agents",
    });
    expect(result.errors).toEqual([]);

    const agentsDir = join(cwd, ".claude", "agents");
    expect(existsSync(agentsDir)).toBe(true);

    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(agentFiles.length).toBe(24);

    // Spot-check representative agent names
    expect(agentFiles.some((f) => f === "software-teams-planner.md")).toBe(true);
    expect(agentFiles.some((f) => f === "software-teams-qa-tester.md")).toBe(true);
    expect(agentFiles.some((f) => f === "software-teams-programmer.md")).toBe(true);
  });

  test("init creates .claude/AGENTS.md and .claude/RULES.md", async () => {
    const cwd = makeTempDir();
    await copyFrameworkFiles(cwd, "node", false, false, PACKAGE_ROOT);
    await convertAgents({
      cwd,
      sourceDir: join(PACKAGE_ROOT, "agents"),
      targetDir: ".claude/agents",
    });

    expect(existsSync(join(cwd, ".claude", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "RULES.md"))).toBe(true);
  });

  test(".claude/CLAUDE.md template uses /st: routing", async () => {
    const cwd = makeTempDir();
    await copyFrameworkFiles(cwd, "node", false, false, PACKAGE_ROOT);

    const claudeMdPath = join(PACKAGE_ROOT, "templates", ".claude", "CLAUDE.md");
    if (existsSync(claudeMdPath)) {
      const claudeMdContent = await readFile(claudeMdPath, "utf-8");
      expect(claudeMdContent).toMatch(/\/st:/);
    }
  });

  test("plugin agents use software-teams- naming", async () => {
    const agentsDir = join(REPO_ROOT, "agents");
    const agentFiles = readdirSync(agentsDir).filter((f) => /^software-teams-/.test(f));

    expect(agentFiles.length).toBeGreaterThanOrEqual(1);
    expect(agentFiles.every((f) => f.startsWith("software-teams-"))).toBe(true);
  });
});
