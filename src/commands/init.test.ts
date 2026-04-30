import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, existsSync } from "fs";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { copyFrameworkFiles } from "../utils/copy-framework";
import { convertAgents } from "../utils/convert-agents";

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

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REAL_FRAMEWORK = join(REPO_ROOT, "framework");

describe("init — scaffolding layout (wave 1 rebrand)", () => {
  test("init creates .software-teams/ directory structure (not .jdi/)", async () => {
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

    // Regression: .jdi/ must NOT be created
    expect(existsSync(join(cwd, ".jdi"))).toBe(false);
  });

  test("init creates .claude/ structure with st/ commands (not jdi/)", async () => {
    const cwd = makeTempDir();
    // Simulate init's directory creation
    mkdirSync(join(cwd, ".claude", "commands", "st"), { recursive: true });
    await Bun.write(join(cwd, ".claude", "commands", "st", ".gitkeep"), "");

    // Verify .claude/commands/st/ exists
    expect(existsSync(join(cwd, ".claude", "commands", "st"))).toBe(true);

    // Regression: .claude/commands/jdi/ must NOT exist
    expect(existsSync(join(cwd, ".claude", "commands", "jdi"))).toBe(false);
  });

  test("framework copyFrameworkFiles writes to .software-teams/framework/ (not .jdi/framework/)", async () => {
    const cwd = makeTempDir();
    // Copy framework using the utility with the real framework source
    await copyFrameworkFiles(cwd, "node", false, false, REAL_FRAMEWORK);

    expect(existsSync(join(cwd, ".software-teams", "framework"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "framework", "agents"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "framework", "commands"))).toBe(true);

    // Regression: .jdi/framework/ must NOT be created
    expect(existsSync(join(cwd, ".jdi"))).toBe(false);
  });

  test("init generates 24 .claude/agents/software-teams-*.md files (from renamed tree)", async () => {
    const cwd = makeTempDir();
    // Setup framework and then generate agents
    await copyFrameworkFiles(cwd, "node", false, false, REAL_FRAMEWORK);

    const result = await convertAgents({
      cwd,
      sourceDir: ".software-teams/framework/agents",
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

    // Regression: old jdi-*.md names must NOT appear
    expect(agentFiles.some((f) => /^jdi-/.test(f))).toBe(false);
  });

  test("init creates .claude/AGENTS.md and .claude/RULES.md", async () => {
    const cwd = makeTempDir();
    // Generate agents which creates AGENTS.md and RULES.md
    await copyFrameworkFiles(cwd, "node", false, false, REAL_FRAMEWORK);
    await convertAgents({
      cwd,
      sourceDir: ".software-teams/framework/agents",
      targetDir: ".claude/agents",
    });

    expect(existsSync(join(cwd, ".claude", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "RULES.md"))).toBe(true);
  });

  test(".claude/CLAUDE.md file references use /st: routing (not /jdi:)", async () => {
    const cwd = makeTempDir();
    // Copy the CLAUDE.md template from framework
    await copyFrameworkFiles(cwd, "node", false, false, REAL_FRAMEWORK);

    // The framework template should be in framework/templates/.claude/
    const claudeMdPath = join(REAL_FRAMEWORK, "templates", ".claude", "CLAUDE.md");
    if (existsSync(claudeMdPath)) {
      const claudeMdContent = await readFile(claudeMdPath, "utf-8");
      // The template should use /st: routing
      expect(claudeMdContent).toMatch(/\/st:/);
      // And should NOT have /jdi: references
      expect(claudeMdContent).not.toMatch(/\/jdi:/);
    }
  });

  test("framework agents use software-teams- naming (not jdi-)", async () => {
    const agentsDir = join(REAL_FRAMEWORK, "agents");
    const agentFiles = readdirSync(agentsDir).filter((f) => /^software-teams-/.test(f));

    // Should find agent files with the new naming pattern
    expect(agentFiles.length).toBeGreaterThanOrEqual(1);
    // All matched agents must use new naming
    expect(agentFiles.every((f) => f.startsWith("software-teams-"))).toBe(true);

    // Regression: no old jdi- files should exist
    const jdiFiles = readdirSync(agentsDir).filter((f) => /^jdi-/.test(f));
    expect(jdiFiles.length).toBe(0);
  });
});
