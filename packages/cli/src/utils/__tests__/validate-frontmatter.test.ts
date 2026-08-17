import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  parseFrontmatter,
  validateFrontmatter,
  validateModelConfig,
} from "../validate-frontmatter";
import {
  isValidModel,
  isValidToolName,
  retiredModelReplacement,
} from "../../shared/claude-code-surface";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "st-fm-"));
  await mkdir(join(root, "agents"), { recursive: true });
  await mkdir(join(root, "skills"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  return root;
}

function run(root: string) {
  return validateFrontmatter({
    agentsDir: join(root, "agents"),
    skillDirs: [join(root, "skills")],
  });
}

describe("claude-code-surface", () => {
  test("Agent is a real tool and Task is not", () => {
    expect(isValidToolName("Agent")).toBe(true);
    expect(isValidToolName("Task")).toBe(false);
    expect(isValidToolName("MultiEdit")).toBe(false);
  });

  test("aliases and current claude-* IDs are valid models", () => {
    for (const alias of ["opus", "sonnet", "haiku", "fable", "inherit"]) {
      expect(isValidModel(alias)).toBe(true);
    }
    expect(isValidModel("claude-opus-5")).toBe(true);
    expect(isValidModel("gpt-4")).toBe(false);
  });

  test("superseded pins are recognised even though they look well-formed", () => {
    // The bug this whole gate exists for: `claude-opus-4-6` passes a naive
    // "starts with claude-" check, which is how four dead generations shipped.
    expect(isValidModel("claude-opus-4-6")).toBe(true);
    expect(retiredModelReplacement("claude-opus-4-6")).toBe("opus");
    expect(retiredModelReplacement("claude-sonnet-4-5")).toBe("sonnet");
    expect(retiredModelReplacement("claude-haiku-3-5")).toBe("haiku");
    expect(retiredModelReplacement("claude-opus-5")).toBeUndefined();
    expect(retiredModelReplacement("claude-sonnet-5")).toBeUndefined();
  });
});

describe("parseFrontmatter", () => {
  test("reads scalars and block sequences", () => {
    const fm = parseFrontmatter(
      ["---", "name: x", 'description: "quoted"', "tools:", "  - Read", "  - Bash", "---", "body"].join(
        "\n",
      ),
    );
    expect(fm["name"]).toBe("x");
    expect(fm["description"]).toBe("quoted");
    expect(fm["tools"]).toEqual(["Read", "Bash"]);
  });

  test("returns empty for a file with no frontmatter", () => {
    expect(parseFrontmatter("# just a heading\n")).toEqual({});
  });
});

describe("validateFrontmatter", () => {
  test("accepts a well-formed agent spec", async () => {
    const root = await fixture({
      "agents/good.md": [
        "---",
        "name: good",
        "description: fine",
        "model: sonnet",
        "effort: high",
        "tools:",
        "  - Read",
        "  - Edit",
        "  - Bash(git:*)",
        "---",
        "body",
      ].join("\n"),
    });
    const report = await run(root);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  test("rejects retired tool names with the replacement", async () => {
    const root = await fixture({
      "agents/bad.md": ["---", "name: bad", "tools:", "  - Task", "  - MultiEdit", "---", "b"].join(
        "\n",
      ),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toContain('Use "Agent"');
    expect(errors[1]?.message).toContain('Use "Edit"');
  });

  test("rejects an unknown tool name", async () => {
    const root = await fixture({
      "agents/bad.md": ["---", "name: bad", "tools:", "  - Telepathy", "---", "b"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.value).toBe("Telepathy");
  });

  test("rejects a superseded model pin", async () => {
    const root = await fixture({
      "agents/bad.md": ["---", "name: bad", "model: claude-opus-4-6", "---", "b"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("model");
  });

  test("rejects a memory scope the harness would silently ignore", async () => {
    const root = await fixture({
      "agents/bad.md": ["---", "name: bad", "memory: global", "---", "b"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("memory");
  });

  test("rejects a non-positive maxTurns", async () => {
    const root = await fixture({
      "agents/bad.md": ["---", "name: bad", "maxTurns: 0", "---", "b"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("maxTurns");
  });

  test("accepts valid memory and maxTurns", async () => {
    const root = await fixture({
      "agents/ok.md": [
        "---",
        "name: ok",
        "memory: project",
        "maxTurns: 40",
        "---",
        "b",
      ].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toEqual([]);
  });

  test("rejects an invalid effort level", async () => {
    const root = await fixture({
      "agents/bad.md": ["---", "name: bad", "effort: extreme", "---", "b"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("effort");
  });

  test("warns, but does not fail, on a tool the harness strips from subagents", async () => {
    const root = await fixture({
      "agents/asks.md": ["---", "name: asks", "tools:", "  - AskUserQuestion", "---", "b"].join(
        "\n",
      ),
    });
    const { errors, warnings } = await run(root);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.value).toBe("AskUserQuestion");
  });

  test("discovers nested SKILL.md files but ignores supporting markdown", async () => {
    const root = await fixture({
      "skills/review/SKILL.md": [
        "---",
        "name: st-review",
        "allowed-tools: Read, AskUserQuestion",
        "context: fork",
        "agent: software-teams-quality",
        "---",
        "body",
      ].join("\n"),
      "skills/st-support/reference.md": "Task is prose here, not tool frontmatter",
    });
    const report = await run(root);
    expect(report.errors).toEqual([]);
    expect(report.filesChecked).toBe(1);
  });

  test("rejects unknown skill-only frontmatter instead of silently ignoring typos", async () => {
    const root = await fixture({
      "skills/typo/SKILL.md": ["---", "name: typo", "when-to-use: explicit only", "---"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("when-to-use");
  });

  test("rejects legacy command context blocks in skills", async () => {
    const root = await fixture({
      "skills/legacy/SKILL.md": ["---", "name: legacy", "context: |", "  !git status", "---"].join("\n"),
    });
    const { errors } = await run(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("!`command`");
  });

  test("does not apply the subagent-strip warning to skills", async () => {
    const root = await fixture({
      "skills/asks.md": ["---", "name: asks", "allowed-tools: AskUserQuestion", "---", "b"].join(
        "\n",
      ),
    });
    const { errors, warnings } = await run(root);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("ignores MCP tool references and Bash permission scopes", async () => {
    const root = await fixture({
      "agents/mcp.md": [
        "---",
        "name: mcp",
        "tools:",
        "  - mcp__slack__post_message",
        "  - Bash(git diff *)",
        "---",
        "b",
      ].join("\n"),
    });
    const { errors, warnings } = await run(root);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe("validateModelConfig", () => {
  test("flags superseded pins in profiles and overrides", () => {
    const findings = validateModelConfig({
      models: {
        profiles: { quality: { planner: "claude-opus-4-8", backend: "opus" } },
        overrides: { planner: "claude-haiku-3-5", backend: null },
      },
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.field)).toEqual([
      "models.profiles.quality.planner",
      "models.overrides.planner",
    ]);
  });

  test("accepts an alias-only config and tolerates a missing models block", () => {
    expect(
      validateModelConfig({ models: { profiles: { budget: { planner: "sonnet" } } } }),
    ).toEqual([]);
    expect(validateModelConfig({})).toEqual([]);
    expect(validateModelConfig(null)).toEqual([]);
  });
});
