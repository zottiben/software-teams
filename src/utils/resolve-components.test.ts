import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveComponents } from "./resolve-components";

let tempDir: string;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("resolveComponents", () => {
  test("finds project-level components", async () => {
    const dir = makeTempDir();
    const componentsDir = join(dir, ".software-teams", "framework", "components");
    mkdirSync(componentsDir, { recursive: true });
    writeFileSync(join(componentsDir, "TestComponent.md"), "# Test");

    const components = await resolveComponents(dir);
    const projectComponents = components.filter((c) => c.source === "project");
    const testComp = projectComponents.find((c) => c.name === "TestComponent");

    expect(testComp).toBeDefined();
    expect(testComp!.source).toBe("project");
    expect(testComp!.path).toBe(join(componentsDir, "TestComponent.md"));
  });

  test("returns components sorted alphabetically", async () => {
    const dir = makeTempDir();
    const componentsDir = join(dir, ".software-teams", "framework", "components");
    mkdirSync(componentsDir, { recursive: true });
    writeFileSync(join(componentsDir, "Zebra.md"), "# Z");
    writeFileSync(join(componentsDir, "Alpha.md"), "# A");
    writeFileSync(join(componentsDir, "Middle.md"), "# M");

    const components = await resolveComponents(dir);
    const projectNames = components
      .filter((c) => c.source === "project")
      .map((c) => c.name);

    expect(projectNames).toEqual(["Alpha", "Middle", "Zebra"]);
  });

  test("deduplicates by name (project wins over builtin)", async () => {
    const dir = makeTempDir();
    const componentsDir = join(dir, ".software-teams", "framework", "components");
    mkdirSync(componentsDir, { recursive: true });
    // Create a component with the same name as a builtin
    writeFileSync(join(componentsDir, "AgentBase.md"), "# Custom AgentBase");

    const components = await resolveComponents(dir);
    const agentBases = components.filter((c) => c.name === "AgentBase");

    expect(agentBases).toHaveLength(1);
    expect(agentBases[0].source).toBe("project");
  });

  test("returns empty for non-existent project directory", async () => {
    const dir = makeTempDir();
    // No .software-teams directory created — only builtin components should appear
    const components = await resolveComponents(dir);
    const projectComponents = components.filter((c) => c.source === "project");
    expect(projectComponents).toHaveLength(0);
  });

  test("finds components in subdirectories", async () => {
    const dir = makeTempDir();
    const subDir = join(dir, ".software-teams", "framework", "components", "execution");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "Verify.md"), "# Verify");

    const components = await resolveComponents(dir);
    const verify = components.find(
      (c) => c.name === "Verify" && c.source === "project"
    );

    expect(verify).toBeDefined();
  });
});
