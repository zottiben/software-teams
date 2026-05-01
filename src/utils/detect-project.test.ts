import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectProjectType } from "./detect-project";

let tempDir: string;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("detectProjectType", () => {
  test("returns 'generic' for empty directory", async () => {
    const dir = makeTempDir();
    expect(await detectProjectType(dir)).toBe("generic");
  });

  test("returns 'node' for directory with package.json", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
    expect(await detectProjectType(dir)).toBe("node");
  });

  test("returns 'nextjs' for directory with next.config.js", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "next.config.js"), "module.exports = {}");
    expect(await detectProjectType(dir)).toBe("nextjs");
  });

  test("returns 'nextjs' for directory with next.config.mjs", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "next.config.mjs"), "export default {}");
    expect(await detectProjectType(dir)).toBe("nextjs");
  });

  test("returns 'laravel' for directory with composer.json containing laravel/framework", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^11.0" } })
    );
    expect(await detectProjectType(dir)).toBe("laravel");
  });

  test("returns 'generic' for composer.json without laravel/framework", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "composer.json"),
      JSON.stringify({ require: { "some/package": "^1.0" } })
    );
    expect(await detectProjectType(dir)).toBe("generic");
  });
});
