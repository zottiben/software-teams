import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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
 * Build a minimal package-shape fixture with both `framework/` (config-style
 * files) and the plugin tree (`agents/` + `commands/`) at the package root.
 * Returns the path to `framework/` so callers can pass it as
 * `frameworkDirOverride`.
 */
function makePackageFixture(): { packageRoot: string; frameworkDir: string } {
  const packageRoot = makeTempDir();
  const frameworkDir = join(packageRoot, "framework");
  mkdirSync(join(frameworkDir, "components", "meta"), { recursive: true });
  mkdirSync(join(frameworkDir, "adapters"), { recursive: true });
  mkdirSync(join(frameworkDir, "teams"), { recursive: true });
  mkdirSync(join(frameworkDir, "templates"), { recursive: true });

  writeFileSync(join(frameworkDir, "software-teams.md"), "# Software Teams Framework");
  writeFileSync(join(frameworkDir, "components", "meta", "AgentBase.md"), "# AgentBase");
  writeFileSync(join(frameworkDir, "teams", "engineering.md"), "# Engineering");
  writeFileSync(join(frameworkDir, "adapters", "generic.yaml"), "dependency_install: npm install");
  writeFileSync(join(frameworkDir, "adapters", "node.yaml"), "dependency_install: bun install");

  // Plugin tree at the package root (sibling of framework/)
  const agentsDir = join(packageRoot, "agents");
  const commandsDir = join(packageRoot, "commands");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(join(agentsDir, "software-teams-planner.md"), "# Planner");
  writeFileSync(join(commandsDir, "create-plan.md"), "# Create Plan");

  return { packageRoot, frameworkDir };
}

describe("copyFrameworkFiles", () => {
  test("copies framework files to .software-teams/framework/", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    expect(existsSync(join(dir, ".software-teams", "framework", "agents"))).toBe(true);
    expect(existsSync(join(dir, ".software-teams", "framework", "components"))).toBe(true);
    expect(existsSync(join(dir, ".software-teams", "framework", "software-teams.md"))).toBe(true);
  });

  test("copies command stubs to .claude/commands/st/", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const commandsDir = join(dir, ".claude", "commands", "st");
    expect(existsSync(commandsDir)).toBe(true);
    expect(existsSync(join(commandsDir, "create-plan.md"))).toBe(true);
  });

  test("creates CLAUDE.md with routing header when not present", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

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

    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toBe(original);
  });

  test("appends routing to existing CLAUDE.md without routing header", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# My Project\n\nSome content.");

    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toContain("# My Project");
    expect(content).toContain("## Agent-First Default");
  });

  test("applies adapter config for the detected project type", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "node", false, false, frameworkDir);

    const adapterPath = join(dir, ".software-teams", "config", "adapter.yaml");
    expect(existsSync(adapterPath)).toBe(true);
    const content = await Bun.file(adapterPath).text();
    expect(content).toContain("bun install");
  });

  test("copies command stubs to .software-teams/framework/commands/", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const frameworkCommandsDir = join(dir, ".software-teams", "framework", "commands");
    expect(existsSync(frameworkCommandsDir)).toBe(true);
    expect(existsSync(join(frameworkCommandsDir, "create-plan.md"))).toBe(true);
  });

  test("skips existing files when force=false", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const customPath = join(dir, ".software-teams", "framework", "software-teams.md");
    await Bun.write(customPath, "CUSTOM CONTENT");

    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const content = await Bun.file(customPath).text();
    expect(content).toBe("CUSTOM CONTENT");
  });

  test("overwrites existing files when force=true", async () => {
    const dir = makeTempDir();
    const { frameworkDir } = makePackageFixture();
    await copyFrameworkFiles(dir, "generic", false, false, frameworkDir);

    const customPath = join(dir, ".software-teams", "framework", "software-teams.md");
    await Bun.write(customPath, "CUSTOM CONTENT");

    await copyFrameworkFiles(dir, "generic", true, false, frameworkDir);

    const content = await Bun.file(customPath).text();
    expect(content).not.toBe("CUSTOM CONTENT");
  });
});
