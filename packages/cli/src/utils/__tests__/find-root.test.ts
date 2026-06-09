import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot, findProjectRootOrNull } from "../find-root";

let tempDir: string;

function makeProjectFixture(): string {
  // realpath is important on macOS where /var is a symlink to /private/var —
  // otherwise path equality checks fail after walking upward.
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), "st-findroot-test-")));
  mkdirSync(join(tempDir, ".software-teams", "config"), { recursive: true });
  // findProjectRoot looks for state.yaml specifically.
  Bun.write(join(tempDir, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("findProjectRoot", () => {
  test("finds root when invoked from the project root itself", async () => {
    const root = makeProjectFixture();
    // Ensure the state file is fully written before the search.
    await Bun.write(join(root, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
    expect(findProjectRoot(root)).toBe(root);
  });

  test("finds root when invoked from a nested subdirectory", async () => {
    const root = makeProjectFixture();
    await Bun.write(join(root, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
    const nested = join(root, "src", "commands");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(root);
  });

  test("finds root when invoked from a deep nested subdirectory", async () => {
    const root = makeProjectFixture();
    await Bun.write(join(root, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
    const deep = join(root, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    expect(findProjectRoot(deep)).toBe(root);
  });

  test("throws descriptive error when no .software-teams/config/state.yaml is found", () => {
    // Use a fresh tempdir that has no .software-teams content. Point upward at a known
    // filesystem branch the tempdir lives under — there will not be a
    // state.yaml between here and "/".
    const bareDir = realpathSync(mkdtempSync(join(tmpdir(), "st-findroot-bare-")));
    tempDir = bareDir;
    expect(() => findProjectRoot(bareDir)).toThrow(
      /No Software Teams project found .* Run `software-teams init`/,
    );
  });

  test("findProjectRootOrNull returns null instead of throwing", () => {
    const bareDir = realpathSync(mkdtempSync(join(tmpdir(), "st-findroot-bare-")));
    tempDir = bareDir;
    expect(findProjectRootOrNull(bareDir)).toBeNull();
  });
});
