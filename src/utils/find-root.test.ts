import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { findJdiRoot, findJdiRootOrNull } from "./find-root";

let tempDir: string;

function makeJdiFixture(): string {
  // realpath is important on macOS where /var is a symlink to /private/var —
  // otherwise path equality checks fail after walking upward.
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), "st-findroot-test-")));
  mkdirSync(join(tempDir, ".software-teams", "config"), { recursive: true });
  // findJdiRoot looks for state.yaml specifically.
  Bun.write(join(tempDir, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("findJdiRoot", () => {
  test("finds root when invoked from the project root itself", async () => {
    const root = makeJdiFixture();
    // Ensure the state file is fully written before the search.
    await Bun.write(join(root, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
    expect(findJdiRoot(root)).toBe(root);
  });

  test("finds root when invoked from a nested subdirectory", async () => {
    const root = makeJdiFixture();
    await Bun.write(join(root, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
    const nested = join(root, "src", "commands");
    mkdirSync(nested, { recursive: true });
    expect(findJdiRoot(nested)).toBe(root);
  });

  test("finds root when invoked from a deep nested subdirectory", async () => {
    const root = makeJdiFixture();
    await Bun.write(join(root, ".software-teams", "config", "state.yaml"), "position:\n  status: planning\n");
    const deep = join(root, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    expect(findJdiRoot(deep)).toBe(root);
  });

  test("throws descriptive error when no .software-teams/config/state.yaml is found", () => {
    // Use a fresh tempdir that has no .software-teams content. Point upward at a known
    // filesystem branch the tempdir lives under — there will not be a
    // state.yaml between here and "/".
    const bareDir = realpathSync(mkdtempSync(join(tmpdir(), "st-findroot-bare-")));
    tempDir = bareDir;
    expect(() => findJdiRoot(bareDir)).toThrow(
      /No Software Teams project found .* Run `software-teams init`/,
    );
  });

  test("findJdiRootOrNull returns null instead of throwing", () => {
    const bareDir = realpathSync(mkdtempSync(join(tmpdir(), "st-findroot-bare-")));
    tempDir = bareDir;
    expect(findJdiRootOrNull(bareDir)).toBeNull();
  });
});
