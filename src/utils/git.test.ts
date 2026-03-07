import { describe, test, expect, mock, beforeEach } from "bun:test";
import { exec, gitDiff, gitDiffNames, gitLog, gitBranch, gitRoot, gitStatus, gitMergeBase } from "./git";

// Track all Bun.spawn calls
let spawnCalls: Array<{ cmd: string[]; cwd?: string }> = [];
let mockStdout = "";

// Mock Bun.spawn
const originalSpawn = Bun.spawn;
beforeEach(() => {
  spawnCalls = [];
  mockStdout = "";
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock((cmd: string[], opts: any) => {
    spawnCalls.push({ cmd, cwd: opts?.cwd });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(mockStdout));
        controller.close();
      },
    });
    return {
      stdout: stream,
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
    };
  });
});

// Restore after all tests in this file
process.on("beforeExit", () => {
  Bun.spawn = originalSpawn;
});

describe("exec", () => {
  test("calls Bun.spawn with correct args and returns stdout", async () => {
    mockStdout = "hello world\n";
    const result = await exec(["echo", "hello"]);
    expect(result.stdout).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(spawnCalls[0].cmd).toEqual(["echo", "hello"]);
  });

  test("passes cwd to Bun.spawn", async () => {
    mockStdout = "";
    await exec(["ls"], "/tmp");
    expect(spawnCalls[0].cwd).toBe("/tmp");
  });

  test("uses process.cwd() when no cwd provided", async () => {
    mockStdout = "";
    await exec(["ls"]);
    expect(spawnCalls[0].cwd).toBe(process.cwd());
  });
});

describe("gitDiff", () => {
  test("calls git diff without --cached by default", async () => {
    mockStdout = "diff output";
    const result = await gitDiff();
    expect(result).toBe("diff output");
    expect(spawnCalls[0].cmd).toEqual(["git", "diff"]);
  });

  test("includes --cached when staged=true", async () => {
    mockStdout = "staged diff";
    const result = await gitDiff(true);
    expect(result).toBe("staged diff");
    expect(spawnCalls[0].cmd).toEqual(["git", "diff", "--cached"]);
  });
});

describe("gitDiffNames", () => {
  test("returns array of file names", async () => {
    mockStdout = "src/foo.ts\nsrc/bar.ts\n";
    const result = await gitDiffNames();
    expect(result).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  test("returns empty array for empty stdout", async () => {
    mockStdout = "";
    const result = await gitDiffNames();
    expect(result).toEqual([]);
  });

  test("includes --cached when staged=true", async () => {
    mockStdout = "file.ts\n";
    await gitDiffNames(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "diff", "--name-only", "--cached"]);
  });
});

describe("gitLog", () => {
  test("defaults to -20 when no range provided", async () => {
    mockStdout = "abc123 commit msg";
    const result = await gitLog();
    expect(result).toBe("abc123 commit msg");
    expect(spawnCalls[0].cmd).toEqual(["git", "log", "--oneline", "-20"]);
  });

  test("uses range when provided", async () => {
    mockStdout = "log output";
    await gitLog("HEAD~5..HEAD");
    expect(spawnCalls[0].cmd).toEqual(["git", "log", "--oneline", "HEAD~5..HEAD"]);
  });
});

describe("gitBranch", () => {
  test("returns current branch name", async () => {
    mockStdout = "feature/test\n";
    const result = await gitBranch();
    expect(result).toBe("feature/test");
  });
});

describe("gitRoot", () => {
  test("returns repository root path", async () => {
    mockStdout = "/Users/test/project\n";
    const result = await gitRoot();
    expect(result).toBe("/Users/test/project");
  });
});

describe("gitStatus", () => {
  test("returns porcelain status output", async () => {
    mockStdout = "M  src/foo.ts\n?? new-file.ts\n";
    const result = await gitStatus();
    expect(result).toBe("M  src/foo.ts\n?? new-file.ts");
  });
});

describe("gitMergeBase", () => {
  test("passes branch arg correctly", async () => {
    mockStdout = "abc123\n";
    const result = await gitMergeBase("main");
    expect(result).toBe("abc123");
    expect(spawnCalls[0].cmd).toEqual(["git", "merge-base", "HEAD", "main"]);
  });
});
