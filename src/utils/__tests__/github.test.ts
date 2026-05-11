import { describe, test, expect, mock, beforeEach } from "bun:test";
import { isPullRequest } from "../github";

let spawnCalls: Array<{ cmd: string[] }> = [];
let mockExitCode = 0;

const originalSpawn = Bun.spawn;
beforeEach(() => {
  spawnCalls = [];
  mockExitCode = 0;
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock((cmd: string[], _opts: any) => {
    spawnCalls.push({ cmd });
    return {
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(mockExitCode),
    };
  });
});

process.on("beforeExit", () => {
  Bun.spawn = originalSpawn;
});

describe("isPullRequest", () => {
  test("returns true when `gh api repos/.../pulls/N` exits 0", async () => {
    mockExitCode = 0;
    expect(await isPullRequest("zottiben/test-project-one", 42)).toBe(true);
    expect(spawnCalls[0].cmd).toEqual([
      "gh", "api",
      "repos/zottiben/test-project-one/pulls/42",
      "--silent",
    ]);
  });

  test("returns false when the API call fails (issue, not PR)", async () => {
    mockExitCode = 1;
    expect(await isPullRequest("zottiben/test-project-one", 36)).toBe(false);
  });

  test("returns false short-circuit when repo or number is empty", async () => {
    expect(await isPullRequest("", 36)).toBe(false);
    expect(await isPullRequest("z/x", 0)).toBe(false);
    expect(spawnCalls.length).toBe(0);
  });
});
