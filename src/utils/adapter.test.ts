import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readAdapter } from "./adapter";

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

describe("readAdapter", () => {
  test("returns null when adapter file does not exist", async () => {
    const dir = makeTempDir();
    const result = await readAdapter(dir);
    expect(result).toBeNull();
  });

  test("reads and parses valid adapter YAML", async () => {
    const dir = makeTempDir();
    const configDir = join(dir, ".software-teams", "config");
    mkdirSync(configDir, { recursive: true });
    await Bun.write(
      join(configDir, "adapter.yaml"),
      `dependency_install: "bun install"
quality_gates:
  lint: "bun run lint"
  typecheck: "bun run typecheck"
worktree:
  database:
    create: "createdb test"
    migrate: "bun run migrate"
conventions:
  naming: kebab-case
tech_stack:
  runtime: bun
  language: typescript
`
    );

    const config = await readAdapter(dir);
    expect(config).not.toBeNull();
    expect(config!.dependency_install).toBe("bun install");
    expect(config!.quality_gates).toEqual({ lint: "bun run lint", typecheck: "bun run typecheck" });
    expect(config!.worktree!.database!.create).toBe("createdb test");
    expect(config!.conventions).toEqual({ naming: "kebab-case" });
    expect(config!.tech_stack).toEqual({ runtime: "bun", language: "typescript" });
  });
});
