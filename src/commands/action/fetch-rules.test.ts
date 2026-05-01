import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeRules, loadClaudeMdRuleSet } from "./fetch-rules";

let tempDir: string;
function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("mergeRules", () => {
  // Only RULE_CATEGORIES filenames round-trip — `frontend.md` / `backend.md`
  // etc. Anything else (e.g. `commits.md`, `deviations.md`) is ignored to
  // keep project-only rules from leaking into the shared rules repo.

  test("copies new files from source to target", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(sourceDir, "frontend.md"), "# Frontend\n- Use TypeScript\n- Prefer Bun\n");

    const result = mergeRules(sourceDir, targetDir);

    expect(result.copied).toBe(1);
    expect(result.merged).toBe(0);
    expect(existsSync(join(targetDir, "frontend.md"))).toBe(true);
    const content = readFileSync(join(targetDir, "frontend.md"), "utf-8");
    expect(content).toContain("Use TypeScript");
  });

  test("appends non-duplicate lines to existing files", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(targetDir, "general.md"), "# General\n- Use TypeScript\n- Prefer Bun\n");
    writeFileSync(join(sourceDir, "general.md"), "# General\n- Use TypeScript\n- Always test\n");

    const result = mergeRules(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(1);
    const content = readFileSync(join(targetDir, "general.md"), "utf-8");
    expect(content).toContain("Use TypeScript");
    expect(content).toContain("Prefer Bun");
    expect(content).toContain("Always test");
  });

  test("ignores non-rule .md files (e.g. commits.md / deviations.md)", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(sourceDir, "commits.md"), "# Commits rules — should NOT travel\n");
    writeFileSync(join(sourceDir, "deviations.md"), "# Deviations rules — should NOT travel\n");
    writeFileSync(join(sourceDir, "general.md"), "# General\n- Run tests before merging\n");

    const result = mergeRules(sourceDir, targetDir);

    expect(result.copied).toBe(1);
    expect(result.merged).toBe(0);
    expect(existsSync(join(targetDir, "general.md"))).toBe(true);
    expect(existsSync(join(targetDir, "commits.md"))).toBe(false);
    expect(existsSync(join(targetDir, "deviations.md"))).toBe(false);
  });

  test("returns zeros with empty source directory", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    const result = mergeRules(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(0);
  });

  test("returns zeros when source directory does not exist", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "nonexistent");
    const targetDir = join(base, "target");

    const result = mergeRules(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(0);
  });

  test("skips lines that already appear in CLAUDE.md (append case)", () => {
    const base = makeTempDir();
    const cwd = join(base, "project");
    const sourceDir = join(base, "source");
    const targetDir = join(cwd, ".software-teams", "rules");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(
      join(cwd, ".claude", "CLAUDE.md"),
      "# Project rules\n- Always use TypeScript\n- Prefer Bun over Node\n",
    );
    writeFileSync(
      join(targetDir, "general.md"),
      "# General\n- Run tests before committing\n",
    );
    writeFileSync(
      join(sourceDir, "general.md"),
      "# General\n- Always use TypeScript\n- Prefer Bun over Node\n- Use lockfiles in CI\n",
    );

    const result = mergeRules(sourceDir, targetDir, cwd);

    expect(result.merged).toBe(1);
    const content = readFileSync(join(targetDir, "general.md"), "utf-8");
    expect(content).toContain("Run tests before committing");
    expect(content).toContain("Use lockfiles in CI");
    // The two lines already in CLAUDE.md must NOT appear a second time in rules.
    expect(content.split("Always use TypeScript").length - 1).toBe(0);
    expect(content.split("Prefer Bun over Node").length - 1).toBe(0);
  });

  test("skips a whole new file when every line is already in CLAUDE.md", () => {
    const base = makeTempDir();
    const cwd = join(base, "project");
    const sourceDir = join(base, "source");
    const targetDir = join(cwd, ".software-teams", "rules");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(
      join(cwd, ".claude", "CLAUDE.md"),
      "# Rules\n- Always use TypeScript\n",
    );
    writeFileSync(
      join(sourceDir, "frontend.md"),
      "# Frontend\n- Always use TypeScript\n",
    );

    const result = mergeRules(sourceDir, targetDir, cwd);

    expect(result.copied).toBe(0);
    expect(existsSync(join(targetDir, "frontend.md"))).toBe(false);
  });

  test("partially copies a new file when only some lines are in CLAUDE.md", () => {
    const base = makeTempDir();
    const cwd = join(base, "project");
    const sourceDir = join(base, "source");
    const targetDir = join(cwd, ".software-teams", "rules");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(
      join(cwd, ".claude", "CLAUDE.md"),
      "# Rules\n- Always use TypeScript\n",
    );
    writeFileSync(
      join(sourceDir, "frontend.md"),
      "# Frontend\n- Always use TypeScript\n- Use design tokens, not raw hex colors\n",
    );

    const result = mergeRules(sourceDir, targetDir, cwd);

    expect(result.copied).toBe(1);
    const content = readFileSync(join(targetDir, "frontend.md"), "utf-8");
    expect(content).toContain("Use design tokens, not raw hex colors");
    expect(content).not.toContain("Always use TypeScript");
  });
});

describe("loadClaudeMdRuleSet", () => {
  test("reads .claude/CLAUDE.md and ./CLAUDE.md, normalises lines", () => {
    const base = makeTempDir();
    mkdirSync(join(base, ".claude"), { recursive: true });
    writeFileSync(
      join(base, ".claude", "CLAUDE.md"),
      "# Heading\n- Always use TypeScript\n",
    );
    writeFileSync(
      join(base, "CLAUDE.md"),
      "# Other\n* Run tests before committing\n",
    );

    const set = loadClaudeMdRuleSet(base);
    expect(set.has("always use typescript")).toBe(true);
    expect(set.has("run tests before committing")).toBe(true);
  });

  test("returns empty set when no CLAUDE.md exists", () => {
    const base = makeTempDir();
    const set = loadClaudeMdRuleSet(base);
    expect(set.size).toBe(0);
  });
});
