import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAgentRouting, loadModelMap } from "../models-config";

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

describe("loadAgentRouting — the effort dial", () => {
  async function writeConfig(yaml: string): Promise<string> {
    const cwd = makeTempDir();
    const configDir = join(cwd, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });
    await writeFile(join(configDir, "config.yaml"), yaml);
    return cwd;
  }

  test("reads the active profile's nested effort map", async () => {
    const cwd = await writeConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
      debugger: sonnet
      committer: haiku
      effort:
        debugger: high
        committer: low
  overrides: {}
  effort_overrides: {}
`);
    const { models, efforts } = await loadAgentRouting(cwd);
    expect(models["planner"]).toBe("opus");
    expect(efforts["debugger"]).toBe("high");
    expect(efforts["committer"]).toBe("low");
  });

  test("the nested effort map is not mistaken for a model entry", async () => {
    // `effort:` sits inside the profile alongside agent→model pairs. Its value
    // is an object, so it must be skipped by the model reader rather than
    // landing in the map as an agent named "effort".
    const cwd = await writeConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
      effort:
        planner: high
  overrides: {}
`);
    const { models, efforts } = await loadAgentRouting(cwd);
    expect(models["effort"]).toBeUndefined();
    expect(Object.keys(models)).toEqual(["planner"]);
    expect(efforts["planner"]).toBe("high");
  });

  test("effort is sparse: an agent with no entry stays absent, not defaulted", async () => {
    const cwd = await writeConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
      backend: sonnet
      effort:
        planner: high
  overrides: {}
`);
    const { efforts } = await loadAgentRouting(cwd);
    expect(efforts["planner"]).toBe("high");
    // Absent means "inherit the model's default", which is the recommended
    // setting for most work — it must not be filled in with a guess.
    expect(efforts["backend"]).toBeUndefined();
  });

  test("effort_overrides beat the profile", async () => {
    const cwd = await writeConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      debugger: sonnet
      effort:
        debugger: high
  overrides: {}
  effort_overrides:
    debugger: max
`);
    const { efforts } = await loadAgentRouting(cwd);
    expect(efforts["debugger"]).toBe("max");
  });

  test("a profile with no effort map yields no efforts, and never throws", async () => {
    const cwd = await writeConfig(`
models:
  profile: balanced
  profiles:
    balanced:
      planner: opus
  overrides: {}
`);
    const { models, efforts } = await loadAgentRouting(cwd);
    expect(models["planner"]).toBe("opus");
    expect(efforts).toEqual({});
  });

  test("malformed YAML returns empty maps rather than throwing", async () => {
    const cwd = await writeConfig("models:\n  profile: [unclosed\n");
    await expect(loadAgentRouting(cwd)).resolves.toEqual({ models: {}, efforts: {} });
  });
});

describe("packaged config.yaml — the shipped profiles", () => {
  test("every profile's effort values are real effort levels", async () => {
    const { parse } = await import("yaml");
    const { readFileSync } = await import("node:fs");
    const { EFFORT_LEVELS } = await import("../../shared/claude-code-surface");
    const cfg = parse(readFileSync("config/config.yaml", "utf8"));

    for (const [name, profile] of Object.entries(cfg.models.profiles)) {
      const effort = (profile as Record<string, unknown>)["effort"];
      if (!effort) continue;
      for (const [agent, level] of Object.entries(effort as Record<string, string>)) {
        expect(EFFORT_LEVELS, `${name}.effort.${agent}`).toContain(level);
      }
    }
  });

  test("effort stays sparse — most agents inherit the model default", async () => {
    const { parse } = await import("yaml");
    const { readFileSync } = await import("node:fs");
    const cfg = parse(readFileSync("config/config.yaml", "utf8"));

    for (const [name, profile] of Object.entries(cfg.models.profiles)) {
      const p = profile as Record<string, unknown>;
      const agentCount = Object.keys(p).filter((k) => k !== "effort").length;
      const effortCount = Object.keys((p["effort"] ?? {}) as object).length;
      // Guards against a future maintainer pre-populating every agent, which
      // would override the model default everywhere and defeat the point.
      expect(effortCount, `${name} pins effort on too many agents`).toBeLessThan(
        agentCount / 2,
      );
    }
  });
});

describe("every convertAgents call site threads both dials", () => {
  // `convertAgents` takes `models` and `efforts` as separate optional options,
  // so forgetting one is silent: the run succeeds and simply omits that dial.
  // This bit: `sync-agents` was wired for effort while `init` and
  // `sync-framework` were not, so a freshly-initialised project got models but
  // no effort, and no test failed. Unit tests pass the options directly, so
  // only a source-level check catches it.
  test("no command calls convertAgents with models but without efforts", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const dir = "src/commands";
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      if (!source.includes("convertAgents(")) continue;
      if (source.includes("models") && !source.includes("efforts")) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
