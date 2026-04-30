import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

const frameworkRoot = join(import.meta.dir, "..", "framework");

const TOOL_ALLOWLIST = new Set([
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "WebFetch",
  "WebSearch",
  "Task",
  "AskUserQuestion",
]);
const VALID_MODELS = new Set(["opus", "sonnet", "haiku"]);

interface AgentFm {
  name?: string;
  description?: string;
  model?: string;
  tools?: unknown;
  [k: string]: unknown;
}

function parseAgentSpec(filePath: string): { fm: AgentFm; body: string } {
  const content = readFileSync(filePath, "utf-8");
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`No frontmatter in ${filePath}`);
  return { fm: (parseYaml(m[1]) ?? {}) as AgentFm, body: m[2] ?? "" };
}

function listAgentFiles(): string[] {
  const dir = join(frameworkRoot, "agents");
  return readdirSync(dir)
    .filter((f) => /^jdi-.+\.md$/.test(f))
    .map((f) => join(dir, f))
    .sort();
}

function readFrameworkFile(relativePath: string): string {
  const fullPath = join(frameworkRoot, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Framework file not found: ${relativePath} (expected at ${fullPath})`);
  }
  return readFileSync(fullPath, "utf-8");
}

describe("framework file invariants", () => {
  test("agents/jdi-planner.md contains required directives", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");

    // Must have file writing directive (agents need to know they can/must write files)
    expect(content).toMatch(/file permissions|Write tool|MUST.*write/i);

    // Must reference split format
    expect(content).toMatch(/split format|SPLIT FORMAT/i);

    // Must reference task files (T{n}.md pattern or "task file")
    expect(content).toMatch(/T\{?\d*n?\d*\}?\.md|task.file/i);

    // Must reference task_files frontmatter key
    expect(content).toContain("task_files");
  });

  test("commands/create-plan.md references split format", () => {
    const content = readFrameworkFile("commands/create-plan.md");

    // Must reference split or task file
    expect(content).toMatch(/split|task.file/i);

    // Must NOT say "creates PLAN.md" (monolithic format)
    expect(content).not.toContain("creates PLAN.md");
  });

  test("commands/implement-plan.md references task files", () => {
    const content = readFrameworkFile("commands/implement-plan.md");
    expect(content).toMatch(/task_files|task.file|split.plan/i);
  });

  test("templates/PLAN.md contains task_files frontmatter", () => {
    const content = readFrameworkFile("templates/PLAN.md");
    expect(content).toContain("task_files:");
  });

  test("templates/PLAN-TASK.md exists and has task_id", () => {
    const fullPath = join(frameworkRoot, "templates/PLAN-TASK.md");
    expect(existsSync(fullPath)).toBe(true);

    const content = readFrameworkFile("templates/PLAN-TASK.md");
    expect(content).toContain("task_id");
  });

  test("agents/jdi-backend.md references learnings", () => {
    const content = readFrameworkFile("agents/jdi-backend.md");
    expect(content).toMatch(/learnings/i);
  });

  test("agents/jdi-frontend.md references learnings", () => {
    const content = readFrameworkFile("agents/jdi-frontend.md");
    expect(content).toMatch(/learnings/i);
  });

  test("components/meta/ComplexityRouter.md references task files", () => {
    const content = readFrameworkFile("components/meta/ComplexityRouter.md");
    expect(content).toMatch(/TASK_FILE|task.file|task_file/i);
  });

  test("components/meta/SilentDiscovery.md includes test suite detection", () => {
    const content = readFrameworkFile("components/meta/SilentDiscovery.md");
    expect(content).toMatch(/test.suite|test_suite/i);
    expect(content).toMatch(/\.test\.\*|\.spec\.\*/);
  });

  test("commands/create-plan.md includes --with-tests and --without-tests flags", () => {
    const content = readFrameworkFile("commands/create-plan.md");
    expect(content).toContain("--with-tests");
    expect(content).toContain("--without-tests");
  });

  test("agents/jdi-planner.md includes test task generation", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");
    expect(content).toMatch(/test.task.generation|Test Task Generation/i);
    expect(content).toMatch(/type:\s*test/);
    expect(content).toContain("jdi-qa-tester");
  });

  test("agents/jdi-qa-tester.md includes plan-test mode", () => {
    const content = readFrameworkFile("agents/jdi-qa-tester.md");
    expect(content).toContain("plan-test");
  });

  test("commands/implement-plan.md handles test task type", () => {
    const content = readFrameworkFile("commands/implement-plan.md");
    expect(content).toMatch(/type:\s*test|type: test/);
  });

  test("components/planning/TaskBreakdown.md includes test task rules", () => {
    const content = readFrameworkFile("components/planning/TaskBreakdown.md");
    expect(content).toMatch(/Test Task Rules|test task/i);
    expect(content).toMatch(/type.*test/i);
  });

  test("agents/jdi-plan-checker.md accepts 2+ tasks in scope sanity", () => {
    const content = readFrameworkFile("agents/jdi-plan-checker.md");
    expect(content).toMatch(/2\+/);
    expect(content).not.toMatch(/2-4 tasks/);
  });

  test("agents/jdi-planner.md task sizing says 2+ not 2-4", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");
    expect(content).toMatch(/Tasks per plan.*2\+/);
  });

  test("agents/jdi-planner.md Step 3 task format includes type test", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");
    expect(content).toMatch(/type:.*test/);
  });

  test("templates/PLAN-TASK.md includes test task variant", () => {
    const content = readFrameworkFile("templates/PLAN-TASK.md");
    expect(content).toMatch(/test.task.variant|Test Task Variant/i);
    expect(content).toMatch(/test_scope|test_framework/);
  });
});

describe("agent frontmatter audit", () => {
  test("every framework/agents/jdi-*.md declares name, description, model, tools", () => {
    const files = listAgentFiles();
    expect(files.length).toBeGreaterThanOrEqual(24);

    for (const file of files) {
      const { fm } = parseAgentSpec(file);
      expect(fm.name, `${file}: missing name`).toBeString();
      expect((fm.name ?? "").length).toBeGreaterThan(0);
      expect(fm.description, `${file}: missing description`).toBeString();
      expect((fm.description ?? "").length).toBeGreaterThan(0);
      expect(fm.model, `${file}: missing model`).toBeString();
      expect(Array.isArray(fm.tools), `${file}: tools must be an array`).toBe(true);
      expect((fm.tools as unknown[]).length).toBeGreaterThan(0);
    }
  });

  test("model: is one of opus | sonnet | haiku", () => {
    for (const file of listAgentFiles()) {
      const { fm } = parseAgentSpec(file);
      expect(VALID_MODELS.has(fm.model ?? ""), `${file}: model='${fm.model}' not in ${[...VALID_MODELS].join(",")}`).toBe(true);
    }
  });

  test("tools: only contains allowlisted tool names", () => {
    for (const file of listAgentFiles()) {
      const { fm } = parseAgentSpec(file);
      const tools = (fm.tools as unknown[]) ?? [];
      for (const tool of tools) {
        expect(typeof tool, `${file}: every tool must be a string`).toBe("string");
        expect(
          TOOL_ALLOWLIST.has(tool as string),
          `${file}: tool='${tool}' not in allowlist [${[...TOOL_ALLOWLIST].join(", ")}]`,
        ).toBe(true);
      }
    }
  });

  test("specs whose body references Write or Edit (as a tool) must list them in tools", () => {
    // Tool-context patterns: "Write tool", "Edit tool", `Write`/`Edit` in
    // backticks, or appearing in a comma-separated tool list. Plain English
    // verb usage ("Write acceptance criteria") is not a tool reference.
    const toolContextRe = (name: string) =>
      new RegExp(
        `(?:\\b${name}\\s+tool\\b|\`${name}\`|via\\s+${name}\\b|using\\s+${name}\\b)`,
      );
    for (const file of listAgentFiles()) {
      const { fm, body } = parseAgentSpec(file);
      const tools = new Set(((fm.tools as unknown[]) ?? []) as string[]);
      if (toolContextRe("Write").test(body)) {
        expect(tools.has("Write"), `${file}: body references the Write tool but tools= ${[...tools].join(",")}`).toBe(true);
      }
      if (toolContextRe("Edit").test(body)) {
        expect(tools.has("Edit"), `${file}: body references the Edit tool but tools= ${[...tools].join(",")}`).toBe(true);
      }
    }
  });
});

describe("native-spawn migration (no legacy general-purpose injection)", () => {
  // Walk these roots, but do NOT scan framework/agents/ (T1's domain — agent
  // specs may legitimately describe the legacy pattern).
  const repoRoot = join(import.meta.dir, "..");
  const SCAN_TARGETS: string[] = [
    join(frameworkRoot, "commands"),
    join(frameworkRoot, "components"),
    join(frameworkRoot, "jdi.md"),
    join(repoRoot, ".claude", "CLAUDE.md"),
  ];

  // Strip lint-allow blocks so we can scan the remaining content.
  // Convention (documented in framework/components/meta/AgentRouter.md §4):
  // The markers must each appear on their own line (leading whitespace allowed,
  // optional trailing whitespace) so they are unambiguously block delimiters
  // rather than inline backtick-quoted prose:
  //   <!-- lint-allow: legacy-injection -->
  //   ... legacy patterns permitted here ...
  //   <!-- /lint-allow -->
  function stripLintAllowBlocks(content: string): string {
    return content.replace(
      /^[ \t]*<!--\s*lint-allow:\s*legacy-injection\s*-->[ \t]*$[\s\S]*?^[ \t]*<!--\s*\/lint-allow\s*-->[ \t]*$/gm,
      "",
    );
  }

  function listMarkdownFiles(target: string): string[] {
    if (!existsSync(target)) return [];
    const stat = require("fs").statSync(target) as { isDirectory: () => boolean; isFile: () => boolean };
    if (stat.isFile()) return target.endsWith(".md") ? [target] : [];
    if (!stat.isDirectory()) return [];
    const entries = readdirSync(target, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(target, entry.name);
      if (entry.isDirectory()) {
        out.push(...listMarkdownFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
    return out;
  }

  function collectFiles(): string[] {
    const out: string[] = [];
    for (const target of SCAN_TARGETS) {
      out.push(...listMarkdownFiles(target));
    }
    return out;
  }

  test(
    "no skill/command/component uses legacy subagent_type=\"general-purpose\" outside lint-allowlisted blocks",
    () => {
      const offenders: string[] = [];
      const legacyTypeRe = /subagent_type\s*[=:]\s*"general-purpose"/;

      for (const file of collectFiles()) {
        const raw = readFileSync(file, "utf-8");
        const stripped = stripLintAllowBlocks(raw);
        if (legacyTypeRe.test(stripped)) {
          // Find offending lines for a useful error message
          const lines = stripped.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (legacyTypeRe.test(lines[i] ?? "")) {
              offenders.push(`${file}:${i + 1}: ${lines[i]?.trim()}`);
            }
          }
        }
      }

      expect(
        offenders,
        `Legacy subagent_type="general-purpose" found outside <!-- lint-allow: legacy-injection --> blocks:\n${offenders.join("\n")}`,
      ).toHaveLength(0);
    },
  );

  test(
    "no skill/command/component injects \"You are jdi-X. Read .../framework/agents/...\" outside lint-allowlisted blocks",
    () => {
      const offenders: string[] = [];
      // Match: `You are jdi-<role>. Read <anything>framework/agents/<anything>`
      const injectionRe = /You are jdi-[a-z-]+\.\s*Read[^\n]*framework\/agents\//;

      for (const file of collectFiles()) {
        const raw = readFileSync(file, "utf-8");
        const stripped = stripLintAllowBlocks(raw);
        if (injectionRe.test(stripped)) {
          const lines = stripped.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (injectionRe.test(lines[i] ?? "")) {
              offenders.push(`${file}:${i + 1}: ${lines[i]?.trim()}`);
            }
          }
        }
      }

      expect(
        offenders,
        `Legacy "You are jdi-X. Read .../framework/agents/..." injection found outside <!-- lint-allow: legacy-injection --> blocks:\n${offenders.join("\n")}`,
      ).toHaveLength(0);
    },
  );

  test("AgentRouter.md §4 contains a lint-allowlisted LEGACY FALLBACK block", () => {
    const content = readFrameworkFile("components/meta/AgentRouter.md");
    expect(content).toMatch(/<!--\s*lint-allow:\s*legacy-injection\s*-->/);
    expect(content).toMatch(/<!--\s*\/lint-allow\s*-->/);
    expect(content).toMatch(/LEGACY FALLBACK/i);
  });
});

describe("wave-2 doctrine docs (CLAUDE-SHARED + repo CLAUDE.md imports)", () => {
  const repoRoot = join(import.meta.dir, "..");

  /**
   * Imports must appear on their own line, not inside a fenced code block,
   * not as inline backticked prose. Strip ``` fences first, then assert the
   * literal line exists.
   */
  function stripFencedCodeBlocks(content: string): string {
    return content.replace(/^```[\s\S]*?^```/gm, "");
  }

  function assertImportLine(content: string, importLine: string, label: string): void {
    const stripped = stripFencedCodeBlocks(content);
    const lineRe = new RegExp(`^[ \\t]*${importLine.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[ \\t]*$`, "m");
    expect(
      lineRe.test(stripped),
      `${label}: expected literal import line "${importLine}" on its own line (outside code fences)`,
    ).toBe(true);
  }

  test("framework/templates/CLAUDE-SHARED.md imports @.claude/AGENTS.md and @.claude/RULES.md", () => {
    const content = readFrameworkFile("templates/CLAUDE-SHARED.md");
    assertImportLine(content, "@.claude/AGENTS.md", "CLAUDE-SHARED.md");
    assertImportLine(content, "@.claude/RULES.md", "CLAUDE-SHARED.md");
  });

  test(".claude/CLAUDE.md (repo) imports @.claude/AGENTS.md and @.claude/RULES.md", () => {
    const fullPath = join(repoRoot, ".claude", "CLAUDE.md");
    expect(existsSync(fullPath), `expected repo CLAUDE.md at ${fullPath}`).toBe(true);
    const content = readFileSync(fullPath, "utf-8");
    assertImportLine(content, "@.claude/AGENTS.md", ".claude/CLAUDE.md");
    assertImportLine(content, "@.claude/RULES.md", ".claude/CLAUDE.md");
  });

  test("framework/jdi.md does NOT contain the phrase 'non-negotiable platform constraint'", () => {
    const content = readFrameworkFile("jdi.md");
    expect(content).not.toMatch(/non-negotiable platform constraint/i);
  });
});

describe("wave-2 AgentRouter.md §4 structural shape", () => {
  function extractSection4(content: string): string {
    // §4 starts at the heading "## 4." and runs until the next "## " heading
    // at the same level.
    const startRe = /^##\s*4\.\s/m;
    const startMatch = startRe.exec(content);
    if (!startMatch) return "";
    const start = startMatch.index;
    const rest = content.slice(start + startMatch[0].length);
    // Next top-level "## " heading marks the end.
    const nextRe = /^##\s+(?!#)/m;
    const nextMatch = nextRe.exec(rest);
    const end = nextMatch ? start + startMatch[0].length + nextMatch.index : content.length;
    return content.slice(start, end);
  }

  test("§4 has a 'Native ... default' lead paragraph and a 'Legacy fallback' subheading", () => {
    const content = readFrameworkFile("components/meta/AgentRouter.md");
    const section4 = extractSection4(content);
    expect(section4.length, "AgentRouter.md must contain a §4 heading").toBeGreaterThan(0);

    // Native default lead — accept "Native subagents are the default" or
    // "Native (default)" or similar phrasing.
    expect(
      /Native\s*(?:subagents\s+are\s+the\s+default|\(default\)|default)/i.test(section4),
      "§4 must have a native-default lead paragraph",
    ).toBe(true);

    // Legacy fallback subheading — must be a heading (### ...) named
    // "Legacy fallback" (case-insensitive).
    expect(
      /^###[ \t]+Legacy\s+fallback/im.test(section4),
      "§4 must contain a '### Legacy fallback' subheading",
    ).toBe(true);

    // The legacy fallback block content must be inside a lint-allow marker.
    expect(
      /<!--\s*lint-allow:\s*legacy-injection\s*-->/m.test(section4),
      "§4 must contain a lint-allow:legacy-injection marker",
    ).toBe(true);
    expect(
      /<!--\s*\/lint-allow\s*-->/m.test(section4),
      "§4 must close the lint-allow block",
    ).toBe(true);
  });
});

describe("wave-3 three-tier templates", () => {
  const THREE_TIER_TEMPLATES: Array<{ file: string; expectedTier: string }> = [
    { file: "templates/SPEC.md", expectedTier: "spec" },
    { file: "templates/ORCHESTRATION.md", expectedTier: "orchestration" },
    { file: "templates/PLAN-TASK-AGENT.md", expectedTier: "per-agent" },
  ];

  function readFrontmatterBlock(content: string): string {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) throw new Error("no frontmatter block");
    return m[1] ?? "";
  }

  test("each three-tier template file exists in framework/templates/", () => {
    for (const { file } of THREE_TIER_TEMPLATES) {
      const fullPath = join(frameworkRoot, file);
      expect(existsSync(fullPath), `expected ${file} to exist`).toBe(true);
    }
  });

  test("each three-tier template starts with a parseable frontmatter block", () => {
    for (const { file } of THREE_TIER_TEMPLATES) {
      const content = readFrameworkFile(file);
      // Tolerate placeholder syntax — only verify the literal `---\n...\n---`
      // bookend exists and is non-empty. Do NOT yaml.parse — placeholders
      // like `{phase}-{plan}` are deliberately invalid YAML.
      expect(() => readFrontmatterBlock(content)).not.toThrow();
      const fm = readFrontmatterBlock(content);
      expect(fm.length).toBeGreaterThan(0);
    }
  });

  test("each three-tier template declares the expected tier:", () => {
    for (const { file, expectedTier } of THREE_TIER_TEMPLATES) {
      const content = readFrameworkFile(file);
      const fm = readFrontmatterBlock(content);
      // Match `tier: <value>` line — value may be quoted or bare.
      const tierMatch = fm.match(/^tier:\s*["']?([a-z-]+)["']?\s*$/m);
      expect(tierMatch, `${file}: expected a 'tier:' line in frontmatter`).not.toBeNull();
      expect(tierMatch![1]).toBe(expectedTier);
    }
  });

  test("ORCHESTRATION.md and PLAN-TASK-AGENT.md document cross-link fields", () => {
    const orchestration = readFrameworkFile("templates/ORCHESTRATION.md");
    const orchFm = readFrontmatterBlock(orchestration);
    // ORCHESTRATION.md links back to the spec via spec_link.
    expect(orchFm).toMatch(/^spec_link:/m);

    const perAgent = readFrameworkFile("templates/PLAN-TASK-AGENT.md");
    const perAgentFm = readFrontmatterBlock(perAgent);
    // Per-agent slices link back to BOTH parents.
    expect(perAgentFm).toMatch(/^spec_link:/m);
    expect(perAgentFm).toMatch(/^orchestration_link:/m);
  });
});

describe("wave-2 per-command native subagent presence", () => {
  const MIGRATED_COMMANDS = [
    "commit.md",
    "create-plan.md",
    "generate-pr.md",
    "implement-plan.md",
    "pr-feedback.md",
    "pr-review.md",
  ];

  test("each migrated command file references at least one subagent_type=\"jdi-...\" OR invokes via Skill tool", () => {
    const nativeRe = /subagent_type\s*[=:]\s*"jdi-[a-z-]+"/;
    const skillRe = /\bSkill\s+tool\b/i;

    const missing: string[] = [];
    for (const fileName of MIGRATED_COMMANDS) {
      const filePath = join(frameworkRoot, "commands", fileName);
      expect(existsSync(filePath), `missing migrated command file: ${filePath}`).toBe(true);
      const content = readFileSync(filePath, "utf-8");

      const hasNative = nativeRe.test(content);
      const hasSkill = skillRe.test(content);
      if (!hasNative && !hasSkill) {
        missing.push(`${fileName}: neither subagent_type="jdi-..." nor Skill tool reference`);
      } else if (!hasNative) {
        // Useful telemetry but not a failure — a Skill-only command is allowed.
        // eslint-disable-next-line no-console
        console.log(`[wave-2 audit] ${fileName} has no jdi-* subagent_type but invokes via Skill tool — accepted`);
      }
    }

    expect(missing, `commands missing native subagent_type AND Skill tool fallback:\n${missing.join("\n")}`).toHaveLength(0);
  });
});
