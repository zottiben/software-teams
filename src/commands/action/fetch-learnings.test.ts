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
  test("copies new files from source to target", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(sourceDir, "team-prefs.md"), "# Team Prefs\n- Use TypeScript\n- Prefer Bun\n");

    const result = mergeLearnings(sourceDir, targetDir);

    expect(result.copied).toBe(1);
    expect(result.merged).toBe(0);
    expect(existsSync(join(targetDir, "team-prefs.md"))).toBe(true);
    const content = readFileSync(join(targetDir, "team-prefs.md"), "utf-8");
    expect(content).toContain("Use TypeScript");
  });

  test("appends non-duplicate lines to existing files", () => {
    const base = makeTempDir();
    const sourceDir = join(base, "source");
    const targetDir = join(base, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    writeFileSync(join(targetDir, "prefs.md"), "# Prefs\n- Use TypeScript\n- Prefer Bun\n");
    writeFileSync(join(sourceDir, "prefs.md"), "# Prefs\n- Use TypeScript\n- Always test\n");

    const result = mergeLearnings(sourceDir, targetDir);

    expect(result.copied).toBe(0);
    expect(result.merged).toBe(1);
    const content = readFileSync(join(targetDir, "prefs.md"), "utf-8");
    expect(content).toContain("Use TypeScript");
    expect(content).toContain("Prefer Bun");
    expect(content).toContain("Always test");
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
