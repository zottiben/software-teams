import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyFrameworkFiles } from "./copy-framework";

// All fixtures live in tmpdir. We pass `frameworkDirOverride` to
// copyFrameworkFiles so it never touches the real src/ tree (which would be
// catastrophic — `import.meta.dir/../framework` resolves to src/framework
// during tests, and the original test created sibling agents/+commands/ at
// src/agents+src/commands, accidentally overlapping with real source dirs
// after the plugin-tree promotion).

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-cf-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/**
 * Build a minimal package-shape fixture. After Phase A retired the
 * `framework/` wrapper, every subtree (templates, teams, hooks, stacks,
 * adapters, agents, commands, ...) lives directly at the package root.
 * Returns the package root so callers pass it as `packageRootOverride`.
 */
function makePackageFixture(): { packageRoot: string } {
  const packageRoot = makeTempDir();

  mkdirSync(join(packageRoot, "adapters"), { recursive: true });
  mkdirSync(join(packageRoot, "teams"), { recursive: true });
  mkdirSync(join(packageRoot, "templates"), { recursive: true });
  mkdirSync(join(packageRoot, "agents"), { recursive: true });
  mkdirSync(join(packageRoot, "commands"), { recursive: true });

  writeFileSync(join(packageRoot, "software-teams.md"), "# Software Teams Framework");
  writeFileSync(join(packageRoot, "teams", "engineering.md"), "# Engineering");
  writeFileSync(join(packageRoot, "adapters", "generic.yaml"), "dependency_install: npm install");
  writeFileSync(join(packageRoot, "adapters", "node.yaml"), "dependency_install: bun install");
  writeFileSync(join(packageRoot, "agents", "software-teams-planner.md"), "# Planner");
  writeFileSync(join(packageRoot, "commands", "create-plan.md"), "# Create Plan");

  return { packageRoot };
}

describe("copyFrameworkFiles", () => {
  test("copies framework files to .software-teams/framework/", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    expect(existsSync(join(dir, ".software-teams", "framework", "agents"))).toBe(true);
    expect(existsSync(join(dir, ".software-teams", "framework", "teams"))).toBe(true);
    expect(existsSync(join(dir, ".software-teams", "framework", "software-teams.md"))).toBe(true);
  });

  test("copies command stubs to .claude/commands/st/", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const commandsDir = join(dir, ".claude", "commands", "st");
    expect(existsSync(commandsDir)).toBe(true);
    expect(existsSync(join(commandsDir, "create-plan.md"))).toBe(true);
  });

  test("creates CLAUDE.md with routing header when not present", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const claudeMd = join(dir, ".claude", "CLAUDE.md");
    expect(existsSync(claudeMd)).toBe(true);
    const content = await Bun.file(claudeMd).text();
    expect(content).toContain("## Software Teams Workflow Routing");
  });

  test("does not overwrite existing CLAUDE.md that already has routing", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const original = "# My Project\n\n## Agent-First Default\n\nCustom routing content";
    writeFileSync(join(claudeDir, "CLAUDE.md"), original);

    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toBe(original);
  });

  test("appends routing to existing CLAUDE.md without routing header", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# My Project\n\nSome content.");

    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toContain("# My Project");
    expect(content).toContain("## Agent-First Default");
  });

  test("applies adapter config for the detected project type", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "node", false, false, packageRoot);

    const adapterPath = join(dir, ".software-teams", "config", "adapter.yaml");
    expect(existsSync(adapterPath)).toBe(true);
    const content = await Bun.file(adapterPath).text();
    expect(content).toContain("bun install");
  });

  test("copies command stubs to .software-teams/framework/commands/", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const frameworkCommandsDir = join(dir, ".software-teams", "framework", "commands");
    expect(existsSync(frameworkCommandsDir)).toBe(true);
    expect(existsSync(join(frameworkCommandsDir, "create-plan.md"))).toBe(true);
  });

  test("skips existing files when force=false", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const customPath = join(dir, ".software-teams", "framework", "software-teams.md");
    await Bun.write(customPath, "CUSTOM CONTENT");

    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const content = await Bun.file(customPath).text();
    expect(content).toBe("CUSTOM CONTENT");
  });

  test("overwrites existing files when force=true", async () => {
    const dir = makeTempDir();
    const { packageRoot } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, packageRoot);

    const customPath = join(dir, ".software-teams", "framework", "software-teams.md");
    await Bun.write(customPath, "CUSTOM CONTENT");

    await copyFrameworkFiles(dir, "generic", true, false, packageRoot);

    const content = await Bun.file(customPath).text();
    expect(content).not.toBe("CUSTOM CONTENT");
  });
});
