import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadModelMap } from "../models-config";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-models-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("loadModelMap — loader unit tests", () => {
  test("active-profile selection: profile: budget returns the budget map", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: budget
  profiles:
    budget:
      planner: "claude-haiku-4-5"
      programmer: "claude-haiku-4-5"
      qa-tester: "claude-haiku-4-5"
  overrides: {}
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    expect(result["planner"]).toBe("claude-haiku-4-5");
    expect(result["programmer"]).toBe("claude-haiku-4-5");
    expect(result["qa-tester"]).toBe("claude-haiku-4-5");
  });

  test("active-profile selection: profile: quality returns the quality map", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: quality
  profiles:
    quality:
      planner: "claude-opus-4-8"
      programmer: "claude-opus-4-8"
  overrides: {}
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    expect(result["planner"]).toBe("claude-opus-4-8");
    expect(result["programmer"]).toBe("claude-opus-4-8");
  });

  test("override precedence: non-null override wins over profile", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: balanced
  profiles:
    balanced:
      planner: "claude-sonnet-4-6"
      programmer: "claude-sonnet-4-6"
  overrides:
    planner: "claude-opus-4-8"
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    // planner override wins
    expect(result["planner"]).toBe("claude-opus-4-8");
    // programmer keeps profile value
    expect(result["programmer"]).toBe("claude-sonnet-4-6");
  });

  test("null override defers to profile value", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: balanced
  profiles:
    balanced:
      planner: "claude-sonnet-4-6"
      programmer: "claude-sonnet-4-6"
  overrides:
    planner: null
    programmer: "claude-opus-4-8"
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    // null override defers to profile
    expect(result["planner"]).toBe("claude-sonnet-4-6");
    // override wins
    expect(result["programmer"]).toBe("claude-opus-4-8");
  });

  test("missing LOCAL config file falls back to packaged config", async () => {
    const cwd = makeTempDir();
    // Do not create any local config file
    // The loader should fall back to the packaged config, which has the balanced profile

    const result = await loadModelMap(cwd);
    // The packaged config should have models, so result should not be empty
    expect(Object.keys(result).length).toBeGreaterThan(0);
    // Verify it's the balanced profile (default active profile)
    expect(result["planner"]).toBeDefined();
  });

  test("local config.yaml overrides packaged config", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: quality
  profiles:
    quality:
      planner: "claude-opus-4-8-override"
  overrides: {}
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    // Local config should be used, not packaged
    expect(result["planner"]).toBe("claude-opus-4-8-override");
  });

  test("missing models: block returns empty map", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
other-key: value
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    expect(result).toEqual({});
  });

  test("malformed YAML returns empty map (no throw)", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: [invalid yaml structure
  profiles: { bad: yaml }
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    expect(result).toEqual({});
  });

  test("unknown active profile returns empty map", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: nonsense
  profiles:
    quality:
      planner: "claude-opus-4-8"
  overrides: {}
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    expect(result).toEqual({});
  });

  test("value pass-through: full IDs returned verbatim (no alias translation)", async () => {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });

    const configYaml = `
models:
  profile: quality
  profiles:
    quality:
      planner: "claude-opus-4-8"
      programmer: "claude-sonnet-4-6"
      backend: "claude-haiku-4-5"
  overrides: {}
`;
    await writeFile(join(configDir, "config.yaml"), configYaml);

    const result = await loadModelMap(cwd);
    expect(result["planner"]).toBe("claude-opus-4-8");
    expect(result["programmer"]).toBe("claude-sonnet-4-6");
    expect(result["backend"]).toBe("claude-haiku-4-5");
  });
});
