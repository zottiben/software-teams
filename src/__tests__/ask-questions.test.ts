import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askQuestions } from "../commands/ask-questions";

const repoRoot = join(import.meta.dir, "..", "..");

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests: askQuestions
// ─────────────────────────────────────────────────────────────────────────────

describe("askQuestions integration", () => {
  let originalCwd: string;
  let testDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), "ask-q-"));
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true });
  });

  // Cold-start creates both artefacts
  test("cold-start with no .claude/ directory creates both artefacts", async () => {
    const exitCode = await askQuestions("on");

    expect(exitCode).toBe(0);
    expect(existsSync(".claude/ask-questions.md")).toBe(true);
    expect(existsSync(".claude/CLAUDE.md")).toBe(true);
  });

  // Directive shape
  test("directive file starts with the correct header", async () => {
    await askQuestions("on");
    const content = await readFile(".claude/ask-questions.md", "utf8");
    expect(content.startsWith("# Ask Clarifying Questions (ACTIVE)")).toBe(true);
  });

  test("CLAUDE.md contains exactly one @import line", async () => {
    await askQuestions("on");
    const content = await readFile(".claude/CLAUDE.md", "utf8");
    const lines = content.split("\n");
    const importLines = lines.filter((l) => l === "@.claude/ask-questions.md");
    expect(importLines).toHaveLength(1);
  });

  // Idempotency
  test("toggle on twice produces no duplicate @import line", async () => {
    await askQuestions("on");
    await askQuestions("on");

    const content = await readFile(".claude/CLAUDE.md", "utf8");
    const lines = content.split("\n");
    const importLines = lines.filter((l) => l === "@.claude/ask-questions.md");
    expect(importLines).toHaveLength(1);
  });

  test("toggle on twice keeps a single directive file", async () => {
    await askQuestions("on");
    const first = await readFile(".claude/ask-questions.md", "utf8");
    await askQuestions("on");
    const second = await readFile(".claude/ask-questions.md", "utf8");
    expect(second).toBe(first);
  });

  // Toggle off removes artefacts cleanly
  test("toggle off removes directive file", async () => {
    await askQuestions("on");
    expect(existsSync(".claude/ask-questions.md")).toBe(true);

    await askQuestions("off");
    expect(existsSync(".claude/ask-questions.md")).toBe(false);
  });

  test("toggle off removes @import line from CLAUDE.md", async () => {
    await askQuestions("on");
    await askQuestions("off");

    // If CLAUDE.md is empty after removing the line, it is deleted entirely.
    // Otherwise it still exists without the import line.
    const exists = existsSync(".claude/CLAUDE.md");
    if (exists) {
      const content = await readFile(".claude/CLAUDE.md", "utf8");
      expect(content).not.toContain("@.claude/ask-questions.md");
    }
  });

  test("toggle off preserves unrelated content in CLAUDE.md", async () => {
    await mkdir(".claude", { recursive: true });
    await writeFile(
      ".claude/CLAUDE.md",
      "## Project notes\nKeep me around.\n@.claude/ask-questions.md\n",
      "utf8",
    );

    await askQuestions("off");

    const content = await readFile(".claude/CLAUDE.md", "utf8");
    expect(content).toContain("## Project notes");
    expect(content).toContain("Keep me around.");
    expect(content).not.toContain("@.claude/ask-questions.md");
  });

  test("toggle off is idempotent on already-off state", async () => {
    const result1 = await askQuestions("off");
    expect(result1).toBe(0);

    const result2 = await askQuestions("off");
    expect(result2).toBe(0);
  });

  // status — clean ON / OFF
  test("status reports ON when both artefacts present", async () => {
    await askQuestions("on");

    let stdout = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdout += msg + "\n";
    };

    try {
      await askQuestions("status");
    } finally {
      console.log = originalLog;
    }

    expect(stdout).toContain("present");
    expect(stdout).toContain("→ ON");
  });

  test("status reports OFF when no artefacts present", async () => {
    let stdout = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdout += msg + "\n";
    };

    try {
      await askQuestions("status");
    } finally {
      console.log = originalLog;
    }

    expect(stdout).toContain("missing");
    expect(stdout).toContain("→ OFF");
  });

  // status — drift detection
  test("status reports DRIFT when directive exists but @import missing", async () => {
    await mkdir(".claude", { recursive: true });
    await writeFile(
      ".claude/ask-questions.md",
      "# Ask Clarifying Questions (ACTIVE)\n",
      "utf8",
    );

    let stdout = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdout += msg + "\n";
    };

    try {
      await askQuestions("status");
    } finally {
      console.log = originalLog;
    }

    expect(stdout).toContain("DRIFT");
    expect(stdout).toContain("/st:ask-questions on");
  });

  test("status reports DRIFT when @import present but directive missing", async () => {
    await mkdir(".claude", { recursive: true });
    await writeFile(".claude/CLAUDE.md", "@.claude/ask-questions.md\n", "utf8");

    let stdout = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdout += msg + "\n";
    };

    try {
      await askQuestions("status");
    } finally {
      console.log = originalLog;
    }

    expect(stdout).toContain("DRIFT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Framework-lint style checks for the ask-questions surface
// ─────────────────────────────────────────────────────────────────────────────

describe("ask-questions framework lint", () => {
  // Directive template exists and starts with the expected header.
  test("templates/ask-questions-directive.md exists and starts with header", () => {
    const fullPath = join(repoRoot, "templates", "ask-questions-directive.md");
    expect(existsSync(fullPath)).toBe(true);

    const content = readFileSync(fullPath, "utf-8");
    expect(content.startsWith("# Ask Clarifying Questions (ACTIVE)")).toBe(true);
  });

  // Skill file exists and declares the expected frontmatter.
  test("commands/ask-questions.md exists and has required metadata", () => {
    const fullPath = join(repoRoot, "commands", "ask-questions.md");
    expect(existsSync(fullPath)).toBe(true);

    const content = readFileSync(fullPath, "utf-8");
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    expect(m, "commands/ask-questions.md missing frontmatter").toBeTruthy();

    const frontmatter = m![1]!;
    expect(frontmatter).toContain("name: ask-questions");
    expect(frontmatter).toContain("allowed-tools: Read, Bash");
    expect(frontmatter).toContain("<on | off | status>");

    // Body must explain why the policy exists (the auto-mode override) so
    // the rationale survives any future skill-only review. The AskUserQuestion
    // tool reference belongs in the directive template, not the skill itself.
    const body = content.slice(m![0]!.length);
    expect(body).toMatch(/auto[-\s]?mode/i);
  });

  // No auto-import leak: @.claude/ask-questions.md must NOT be in CLAUDE-SHARED.md.
  test("templates/CLAUDE-SHARED.md does NOT contain @.claude/ask-questions.md import", () => {
    const fullPath = join(repoRoot, "templates", "CLAUDE-SHARED.md");
    expect(existsSync(fullPath)).toBe(true);

    const content = readFileSync(fullPath, "utf-8");
    expect(content).not.toContain("@.claude/ask-questions.md");
  });

  // The toggle is documented in its own command doc. Plugin init.md was
  // slimmed (plan 01-01 plugin-cli-bundling) and no longer carries onboarding
  // pointers, so discoverability lives in the canonical command doc.
  test("commands/ask-questions.md documents the /st:ask-questions on toggle", () => {
    const fullPath = join(repoRoot, "commands", "ask-questions.md");
    expect(existsSync(fullPath)).toBe(true);

    const content = readFileSync(fullPath, "utf-8");
    expect(content).toContain("/st:ask-questions on");
  });
});
