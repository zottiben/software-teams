import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeLearnings } from "./fetch-learnings";

let tempDir: string;
function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("mergeLearnings", () => {
  // Phase D: only LEARNING_CATEGORIES filenames round-trip — `frontend.md`
  // / `backend.md` etc. Anything else (e.g. `team-prefs.md`) is ignored to
  // keep non-learning rules from leaking into the shared learnings repo.

  test("copies new files from source to target", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(sourceDir, "frontend.md"), "# Frontend\n- Use TypeScript\n- Prefer Bun\n");

    const result = mergeLearnings(sourceDir, targetDir);

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

    const result = mergeLearnings(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(1);
    const content = readFileSync(join(targetDir, "general.md"), "utf-8");
    expect(content).toContain("Use TypeScript");
    expect(content).toContain("Prefer Bun");
    expect(content).toContain("Always test");
  });

  test("ignores non-learning .md files (e.g. commits.md / deviations.md)", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(sourceDir, "commits.md"), "# Commits rules — should NOT travel\n");
    writeFileSync(join(sourceDir, "deviations.md"), "# Deviations rules — should NOT travel\n");
    writeFileSync(join(sourceDir, "general.md"), "# General learning content\n");

    const result = mergeLearnings(sourceDir, targetDir);

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

    const result = mergeLearnings(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(0);
  });

  test("returns zeros when source directory does not exist", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "nonexistent");
    const targetDir = join(base, "target");

    const result = mergeLearnings(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(0);
  });
});
