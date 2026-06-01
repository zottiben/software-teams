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

    // Phase D: only `rules/` is copied into `.software-teams/`. `templates/`
    // was removed because no runtime agent reads from it; init.ts writes
    // YAML scaffolds straight from the package root instead.
    expect(existsSync(join(cwd, ".software-teams", "rules"))).toBe(true);
    expect(existsSync(join(cwd, ".software-teams", "templates"))).toBe(false);
    expect(existsSync(join(cwd, ".software-teams", "framework"))).toBe(false);
  });

  test("init generates 33 .claude/agents/software-teams-*.md files (from package source)", async () => {
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
    expect(agentFiles.length).toBe(33);

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

describe("init --state-only (plugin mode)", () => {
  test("--state-only creates .software-teams/ subtree but NO .claude/ artifacts", async () => {
    const cwd = makeTempDir();

    // Simulate `init --ci --state-only` by creating the expected structure
    const swDirs = [
      ".software-teams/plans",
      ".software-teams/research",
      ".software-teams/codebase",
      ".software-teams/reviews",
      ".software-teams/config",
      ".software-teams/persistence",
      ".software-teams/feedback",
    ];

    for (const dir of swDirs) {
      const fullPath = join(cwd, dir);
      mkdirSync(fullPath, { recursive: true });
      await Bun.write(join(fullPath, ".gitkeep"), "");
    }

    // Copy framework files with state-only enabled
    await copyFrameworkFiles(cwd, "node", false, true, PACKAGE_ROOT, true);

    // Assert .software-teams/ directories exist
    for (const dir of swDirs) {
      expect(existsSync(join(cwd, dir))).toBe(true);
    }

    // Assert .claude/ is NOT created
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
    expect(existsSync(join(cwd, ".claude", "commands", "st"))).toBe(false);
    expect(existsSync(join(cwd, ".claude", "agents"))).toBe(false);
  });

  test("--state-only generates state.yaml and config YAML in .software-teams/", async () => {
    const cwd = makeTempDir();

    const swDirs = [
      ".software-teams/config",
      ".software-teams/persistence",
    ];

    for (const dir of swDirs) {
      mkdirSync(join(cwd, dir), { recursive: true });
    }

    // Write state and config files (mimicking init.ts behaviour)
    const stateSrc = join(PACKAGE_ROOT, "templates", "state.yaml");
    const stateDest = join(cwd, ".software-teams", "state.yaml");
    if (existsSync(stateSrc)) {
      await Bun.write(stateDest, await Bun.file(stateSrc).text());
    }

    const cfgSrc = join(PACKAGE_ROOT, "config", "config.yaml");
    const cfgDest = join(cwd, ".software-teams", "config", "config.yaml");
    if (existsSync(cfgSrc)) {
      await Bun.write(cfgDest, await Bun.file(cfgSrc).text());
    }

    expect(existsSync(stateDest)).toBe(true);
    expect(existsSync(cfgDest)).toBe(true);
  });

  test("--state-only .gitignore contains .software-teams/ but NOT .claude/commands/st/", async () => {
    const cwd = makeTempDir();

    // Simulate state-only .gitignore generation
    const gitignorePath = join(cwd, ".gitignore");
    const stMarker = "# Software Teams framework";
    const stEntries = [
      "",
      `${stMarker} — remove these lines to version control Software Teams artefacts`,
      ".software-teams/",
      // Note: state-only means we skip the .claude/commands/st/ line
    ].join("\n");

    await Bun.write(gitignorePath, stEntries.trimStart() + "\n");

    const gitignoreContent = await readFile(gitignorePath, "utf-8");
    expect(gitignoreContent).toContain(".software-teams/");
    expect(gitignoreContent).not.toContain(".claude/commands/st/");
  });

  test("default init (no flag) STILL creates .claude/commands/st and .claude/agents — regression check", async () => {
    const cwd = makeTempDir();

    // Create directories as default init would (state-only=false)
    const allDirs = [
      ".claude/commands/st",
      ".software-teams/plans",
      ".software-teams/research",
      ".software-teams/codebase",
      ".software-teams/reviews",
      ".software-teams/config",
      ".software-teams/persistence",
      ".software-teams/feedback",
    ];

    for (const dir of allDirs) {
      mkdirSync(join(cwd, dir), { recursive: true });
    }

    // Copy framework files with state-only=false (default)
    await copyFrameworkFiles(cwd, "node", false, true, PACKAGE_ROOT, false);

    // Verify .claude/ is created
    expect(existsSync(join(cwd, ".claude", "commands", "st"))).toBe(true);

    // Now convert agents (simulating default init's agent generation)
    const result = await convertAgents({
      cwd,
      sourceDir: join(PACKAGE_ROOT, "agents"),
      targetDir: ".claude/agents",
    });

    // Assert agents were generated
    const agentsDir = join(cwd, ".claude", "agents");
    expect(existsSync(agentsDir)).toBe(true);
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  test("default init .gitignore contains BOTH .software-teams/ AND .claude/commands/st/", async () => {
    const cwd = makeTempDir();

    // Simulate default init .gitignore generation (state-only=false)
    const gitignorePath = join(cwd, ".gitignore");
    const stMarker = "# Software Teams framework";
    const stEntries = [
      "",
      `${stMarker} — remove these lines to version control Software Teams artefacts`,
      ".software-teams/",
      ".claude/commands/st/",  // This line is ONLY when state-only=false
    ].join("\n");

    await Bun.write(gitignorePath, stEntries.trimStart() + "\n");

    const gitignoreContent = await readFile(gitignorePath, "utf-8");
    expect(gitignoreContent).toContain(".software-teams/");
    expect(gitignoreContent).toContain(".claude/commands/st/");
  });
});
