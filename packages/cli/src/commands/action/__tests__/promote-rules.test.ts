import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasRulesContent } from "../promote-rules";

let tempDir: string;
function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("hasRulesContent", () => {
  test("returns true when .md has non-header content", () => {
    const base = makeTempDir();
    const rulesDir = join(base, "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, "general.md"),
      "# Team Preferences\n\n- Always use TypeScript\n- Prefer Bun over Node\n",
    );

    expect(hasRulesContent(rulesDir)).toBe(true);
  });

  test("returns false for empty/header-only files", () => {
    const base = makeTempDir();
    const rulesDir = join(base, "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, "general.md"),
      "# Team Preferences\n\n## Section\n\n<!-- comment -->\n",
    );

    expect(hasRulesContent(rulesDir)).toBe(false);
  });

  test("returns false when directory does not exist", () => {
    const base = makeTempDir();
    const rulesDir = join(base, "nonexistent");

    expect(hasRulesContent(rulesDir)).toBe(false);
  });

  test("returns false for empty directory", () => {
    const base = makeTempDir();
    const rulesDir = join(base, "rules");
    mkdirSync(rulesDir, { recursive: true });

    expect(hasRulesContent(rulesDir)).toBe(false);
  });
});
