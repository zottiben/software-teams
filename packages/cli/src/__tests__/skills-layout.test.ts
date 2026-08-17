import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../utils/validate-frontmatter";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const SKILLS_ROOT = join(PACKAGE_ROOT, "skills");

const EXPECTED_SKILLS = [
  "ask-questions",
  "build",
  "commit",
  "compile-workflow",
  "create-dev-plan",
  "create-plan",
  "generate-pr",
  "implement-plan",
  "init",
  "orchestrator-mode",
  "pr-feedback",
  "quick",
  "review-plan",
  "routines",
  "status",
  "statusline",
] as const;

const USER_ONLY_SKILLS = [
  "ask-questions",
  "commit",
  "generate-pr",
  "init",
  "orchestrator-mode",
  "pr-feedback",
  "statusline",
] as const;

function source(name: string): string {
  return readFileSync(join(SKILLS_ROOT, name, "SKILL.md"), "utf8");
}

describe("native Claude Code skill payload", () => {
  test("ships exactly the 16 non-native-duplicate skills", () => {
    const actual = readdirSync(SKILLS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_ROOT, entry.name, "SKILL.md")))
      .map((entry) => entry.name)
      .sort();
    expect(actual).toEqual([...EXPECTED_SKILLS].sort());
    expect(existsSync(join(PACKAGE_ROOT, "commands"))).toBe(false);
    expect(actual).not.toContain("verify");
    expect(actual).not.toContain("pr-review");
  });

  test("uses collision-safe st-* names and no legacy context blocks", () => {
    for (const name of EXPECTED_SKILLS) {
      const content = source(name);
      const frontmatter = parseFrontmatter(content);
      expect(frontmatter["name"], name).toBe(`st-${name}`);
      expect(frontmatter["description"], name).toBeTruthy();
      expect(content, name).not.toMatch(/^context: \|$/m);
    }
  });

  test("operational side effects require direct user invocation", () => {
    for (const name of USER_ONLY_SKILLS) {
      expect(parseFrontmatter(source(name))["disable-model-invocation"], name).toBe("true");
    }
  });

  test("single-specialist jobs run in a foreground fork without delegation prose", () => {
    const expectedAgents = {
      "create-dev-plan": "software-teams-dev-planner",
      "pr-feedback": "software-teams-pr-feedback",
    } as const;
    for (const [name, agent] of Object.entries(expectedAgents)) {
      const content = source(name);
      const frontmatter = parseFrontmatter(content);
      expect(frontmatter["context"], name).toBe("fork");
      expect(frontmatter["agent"], name).toBe(agent);
      expect(frontmatter["background"], name).toBe("false");
      expect(frontmatter["allowed-tools"], name).toBeUndefined();
      expect(content, name).not.toContain("Agent(");
    }
  });

  test("model-invocable execution skills require explicit current-turn intent", () => {
    const implementation = source("implement-plan");
    expect(parseFrontmatter(implementation)["when_to_use"]).toContain("current user message");
    expect(implementation).toContain("Plan approval or refinement alone must never trigger");
    expect(implementation).toContain("\"approved\", \"looks good\", or \"what's next?\"");

    const workflow = source("compile-workflow");
    expect(parseFrontmatter(workflow)["when_to_use"]).toContain("explicitly asks");
    expect(workflow).toContain("Plan approval alone is not permission");

    const quick = source("quick");
    expect(parseFrontmatter(quick)["when_to_use"]).toContain("explicit current request");
    expect(quick).toContain("never infer it from discussion or planning approval");
  });

  test("legacy context commands moved to dynamic body injection", () => {
    const withDynamicContext = EXPECTED_SKILLS.filter((name) => /^!`.+`$/m.test(source(name)));
    expect(withDynamicContext).toHaveLength(9);
  });

  test("the shipped skill catalogue lists every native skill", () => {
    const guide = readFileSync(join(PACKAGE_ROOT, "software-teams.md"), "utf8");
    for (const name of EXPECTED_SKILLS) {
      expect(guide, name).toContain(`/st-${name}`);
    }
    expect(guide).toContain("skills/st-support/AGENTS-MODELS.md");
  });

  test("npm publishes skills rather than deprecated commands", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      files: string[];
    };
    expect(manifest.files).toContain("skills");
    expect(manifest.files).not.toContain("commands");
  });
});
