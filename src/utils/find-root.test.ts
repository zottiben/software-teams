import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { findJdiRoot, findJdiRootOrNull } from "./find-root";

let tempDir: string;

function makeJdiFixture(): string {
  // realpath is important on macOS where /var is a symlink to /private/var —
  // otherwise path equality checks fail after walking upward.
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), "jdi-findroot-test-")));
  mkdirSync(join(tempDir, ".jdi", "config"), { recursive: true });
  // findJdiRoot looks for state.yaml specifically.
  Bun.write(join(tempDir, ".jdi", "config", "state.yaml"), "position:\n  status: planning\n");
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
    await Bun.write(join(root, ".jdi", "config", "state.yaml"), "position:\n  status: planning\n");
    expect(findJdiRoot(root)).toBe(root);
  });

  test("finds root when invoked from a nested subdirectory", async () => {
    const root = makeJdiFixture();
    await Bun.write(join(root, ".jdi", "config", "state.yaml"), "position:\n  status: planning\n");
    const nested = join(root, "src", "commands");
    mkdirSync(nested, { recursive: true });
    expect(findJdiRoot(nested)).toBe(root);
  });

  test("finds root when invoked from a deep nested subdirectory", async () => {
    const root = makeJdiFixture();
    await Bun.write(join(root, ".jdi", "config", "state.yaml"), "position:\n  status: planning\n");
    const deep = join(root, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    expect(findJdiRoot(deep)).toBe(root);
  });

  test("throws descriptive error when no .jdi/config/state.yaml is found", () => {
    // Use a fresh tempdir that has no .jdi content. Point upward at a known
    // filesystem branch the tempdir lives under — there will not be a
    // state.yaml between here and "/".
    const bareDir = realpathSync(mkdtempSync(join(tmpdir(), "jdi-findroot-bare-")));
    tempDir = bareDir;
    expect(() => findJdiRoot(bareDir)).toThrow(
      /No JDI project found .* Run `jdi init`/,
    );
  });

  test("findJdiRootOrNull returns null instead of throwing", () => {
    const bareDir = realpathSync(mkdtempSync(join(tmpdir(), "jdi-findroot-bare-")));
    tempDir = bareDir;
    expect(findJdiRootOrNull(bareDir)).toBeNull();
  });
});
