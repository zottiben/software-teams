import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasLearningsContent } from "./promote-learnings";

let tempDir: string;
function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("hasLearningsContent", () => {
  test("returns true when .md has non-header content", () => {
    const base = makeTempDir();
    const learningsDir = join(base, "learnings");
    mkdirSync(learningsDir, { recursive: true });
    writeFileSync(
      join(learningsDir, "prefs.md"),
      "# Team Preferences\n\n- Always use TypeScript\n- Prefer Bun over Node\n",
    );

    expect(hasLearningsContent(learningsDir)).toBe(true);
  });

  test("returns false for empty/header-only files", () => {
    const base = makeTempDir();
    const learningsDir = join(base, "learnings");
    mkdirSync(learningsDir, { recursive: true });
    writeFileSync(
      join(learningsDir, "prefs.md"),
      "# Team Preferences\n\n## Section\n\n<!-- comment -->\n",
    );

    expect(hasLearningsContent(learningsDir)).toBe(false);
  });

  test("returns false when directory does not exist", () => {
    const base = makeTempDir();
    const learningsDir = join(base, "nonexistent");

    expect(hasLearningsContent(learningsDir)).toBe(false);
  });

  test("returns false for empty directory", () => {
    const base = makeTempDir();
    const learningsDir = join(base, "learnings");
    mkdirSync(learningsDir, { recursive: true });

    expect(hasLearningsContent(learningsDir)).toBe(false);
  });
});
