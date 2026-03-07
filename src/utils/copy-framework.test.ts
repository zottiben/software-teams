import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { copyFrameworkFiles } from "./copy-framework";

let tempDir: string;

// The framework source is resolved via import.meta.dir in copy-framework.ts
// which points to src/utils/../framework = src/framework during tests.
// Since the actual framework is at the project root, we need to create a
// symlink or just test with the real project root structure.
//
// For isolated testing, we create a minimal framework source structure
// that matches what import.meta.dir resolves to during test execution.
const frameworkSourceDir = join(import.meta.dir, "../framework");

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "jdi-test-"));
  return tempDir;
}

function setupFrameworkSource() {
  // Create a minimal framework directory at the path copy-framework.ts expects
  if (!existsSync(frameworkSourceDir)) {
    mkdirSync(join(frameworkSourceDir, "agents"), { recursive: true });
    mkdirSync(join(frameworkSourceDir, "components", "meta"), { recursive: true });
    mkdirSync(join(frameworkSourceDir, "commands"), { recursive: true });
    mkdirSync(join(frameworkSourceDir, "adapters"), { recursive: true });
    mkdirSync(join(frameworkSourceDir, "teams"), { recursive: true });

    writeFileSync(join(frameworkSourceDir, "jedi.md"), "# JDI Framework");
    writeFileSync(join(frameworkSourceDir, "agents", "jdi-planner.md"), "# Planner");
    writeFileSync(join(frameworkSourceDir, "components", "meta", "AgentBase.md"), "# AgentBase");
    writeFileSync(join(frameworkSourceDir, "commands", "create-plan.md"), "# Create Plan");
    writeFileSync(join(frameworkSourceDir, "teams", "engineering.md"), "# Engineering");
    writeFileSync(join(frameworkSourceDir, "adapters", "generic.yaml"), "dependency_install: npm install");
    writeFileSync(join(frameworkSourceDir, "adapters", "node.yaml"), "dependency_install: bun install");
  }
}

let createdFrameworkSource = false;

beforeEach(() => {
  if (!existsSync(frameworkSourceDir)) {
    setupFrameworkSource();
    createdFrameworkSource = true;
  }
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  // Clean up the framework source if we created it
  if (createdFrameworkSource && existsSync(frameworkSourceDir)) {
    rmSync(frameworkSourceDir, { recursive: true, force: true });
    createdFrameworkSource = false;
  }
});

describe("copyFrameworkFiles", () => {
  test("copies framework files to .jdi/framework/", async () => {
    const dir = makeTempDir();
    await copyFrameworkFiles(dir, "generic", false);

    expect(existsSync(join(dir, ".jdi", "framework", "agents"))).toBe(true);
    expect(existsSync(join(dir, ".jdi", "framework", "components"))).toBe(true);
    expect(existsSync(join(dir, ".jdi", "framework", "jedi.md"))).toBe(true);
  });

  test("copies command stubs to .claude/commands/jdi/", async () => {
    const dir = makeTempDir();
    await copyFrameworkFiles(dir, "generic", false);

    const commandsDir = join(dir, ".claude", "commands", "jdi");
    expect(existsSync(commandsDir)).toBe(true);
    expect(existsSync(join(commandsDir, "create-plan.md"))).toBe(true);
  });

  test("creates CLAUDE.md with routing header when not present", async () => {
    const dir = makeTempDir();
    await copyFrameworkFiles(dir, "generic", false);

    const claudeMd = join(dir, ".claude", "CLAUDE.md");
    expect(existsSync(claudeMd)).toBe(true);
    const content = await Bun.file(claudeMd).text();
    expect(content).toContain("## JDI Workflow Routing");
  });

  test("does not overwrite existing CLAUDE.md that already has routing", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const original = "# My Project\n\n## JDI Workflow Routing\n\nCustom routing content";
    writeFileSync(join(claudeDir, "CLAUDE.md"), original);

    await copyFrameworkFiles(dir, "generic", false);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toBe(original);
  });

  test("appends routing to existing CLAUDE.md without routing header", async () => {
    const dir = makeTempDir();
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# My Project\n\nSome content.");

    await copyFrameworkFiles(dir, "generic", false);

    const content = await Bun.file(join(claudeDir, "CLAUDE.md")).text();
    expect(content).toContain("# My Project");
    expect(content).toContain("## JDI Workflow Routing");
  });

  test("applies adapter config for the detected project type", async () => {
    const dir = makeTempDir();
    await copyFrameworkFiles(dir, "node", false);

    const adapterPath = join(dir, ".jdi", "config", "adapter.yaml");
    expect(existsSync(adapterPath)).toBe(true);
    const content = await Bun.file(adapterPath).text();
    expect(content).toContain("bun install");
  });

  test("skips existing files when force=false", async () => {
    const dir = makeTempDir();
    await copyFrameworkFiles(dir, "generic", false);

    // Overwrite a file with custom content
    const customPath = join(dir, ".jdi", "framework", "jedi.md");
    await Bun.write(customPath, "CUSTOM CONTENT");

    // Run again without force
    await copyFrameworkFiles(dir, "generic", false);

    const content = await Bun.file(customPath).text();
    expect(content).toBe("CUSTOM CONTENT");
  });

  test("overwrites existing files when force=true", async () => {
    const dir = makeTempDir();
    await copyFrameworkFiles(dir, "generic", false);

    // Overwrite a file with custom content
    const customPath = join(dir, ".jdi", "framework", "jedi.md");
    await Bun.write(customPath, "CUSTOM CONTENT");

    // Run again with force
    await copyFrameworkFiles(dir, "generic", true);

    const content = await Bun.file(customPath).text();
    expect(content).not.toBe("CUSTOM CONTENT");
  });
});
