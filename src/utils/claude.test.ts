import { describe, test, expect, mock, beforeEach } from "bun:test";
import { findClaude, spawnClaude, DEFAULT_ALLOWED_TOOLS } from "./claude";

let spawnCalls: Array<{ cmd: string[]; opts: any }> = [];
let mockExitCode = 0;
let mockWhichResult: string | null = "/usr/local/bin/claude";
let mockStdout = "";

const originalSpawn = Bun.spawn;
const originalWhich = Bun.which;

beforeEach(() => {
  spawnCalls = [];
  mockExitCode = 0;
  mockWhichResult = "/usr/local/bin/claude";
  mockStdout = "";

  // @ts-expect-error - mocking Bun.which
  Bun.which = mock((_name: string) => mockWhichResult);

  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock((cmd: string[], opts: any) => {
    spawnCalls.push({ cmd, opts });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        if (mockStdout) controller.enqueue(encoder.encode(mockStdout));
        controller.close();
      },
    });
    return {
      stdout: stream,
      stderr: null,
      stdin: {
        write: mock(() => {}),
        end: mock(() => {}),
      },
      exited: Promise.resolve(mockExitCode),
    };
  });
});

process.on("beforeExit", () => {
  Bun.spawn = originalSpawn;
  // @ts-expect-error - restoring
  Bun.which = originalWhich;
});

const BASE_ARGS = [
  "/usr/local/bin/claude",
  "-p",
  "--verbose",
  "--output-format", "stream-json",
  "--permission-mode", "acceptEdits",
];

const DEFAULT_ALLOWED_ARGS = DEFAULT_ALLOWED_TOOLS.flatMap((t) => ["--allowedTools", t]);
const BASE_WITH_DEFAULTS = [...BASE_ARGS, ...DEFAULT_ALLOWED_ARGS];

describe("findClaude", () => {
  test("returns path when Bun.which finds claude", async () => {
    mockWhichResult = "/usr/local/bin/claude";
    const path = await findClaude();
    expect(path).toBe("/usr/local/bin/claude");
  });

  test("throws when claude is not found", async () => {
    mockWhichResult = null;
    mockExitCode = 1;
    await expect(findClaude()).rejects.toThrow("Claude CLI not found");
  });
});

describe("spawnClaude", () => {
  test("spawns claude with correct base flags and default allowedTools", async () => {
    await spawnClaude("test prompt");
    expect(spawnCalls[0].cmd).toEqual([...BASE_WITH_DEFAULTS, "test prompt"]);
  });

  test("default allowedTools list includes expected scopes", async () => {
    await spawnClaude("test");
    const cmd = spawnCalls[0].cmd;
    // Core file tools
    expect(cmd).toContain("Read");
    expect(cmd).toContain("Write");
    expect(cmd).toContain("Edit");
    expect(cmd).toContain("Glob");
    expect(cmd).toContain("Grep");
    expect(cmd).toContain("Task");
    // Scoped bash commands
    expect(cmd).toContain("Bash(bun:*)");
    expect(cmd).toContain("Bash(git:*)");
    expect(cmd).toContain("Bash(gh:*)");
    expect(cmd).toContain("Bash(npm:*)");
    expect(cmd).toContain("Bash(npx:*)");
    expect(cmd).toContain("Bash(jdi:*)");
  });

  test("caller-provided allowedTools override defaults", async () => {
    await spawnClaude("test", { allowedTools: ["Read", "Glob"] });
    const cmd = spawnCalls[0].cmd;
    // Only the caller's list should appear — defaults should NOT leak in
    expect(cmd).toContain("Read");
    expect(cmd).toContain("Glob");
    expect(cmd).not.toContain("Bash(bun:*)");
    expect(cmd).not.toContain("Write");
    expect(cmd).not.toContain("Task");
  });

  test("never uses bypassPermissions", async () => {
    await spawnClaude("test");
    const cmd = spawnCalls[0].cmd;
    expect(cmd).not.toContain("bypassPermissions");
  });

  test("pipes stdout for stream processing", async () => {
    await spawnClaude("test prompt");
    expect(spawnCalls[0].opts.stdout).toBe("pipe");
    expect(spawnCalls[0].opts.stderr).toBe("inherit");
  });

  test("uses provided cwd", async () => {
    await spawnClaude("test", { cwd: "/tmp/project" });
    expect(spawnCalls[0].opts.cwd).toBe("/tmp/project");
  });

  test("defaults to process.cwd() when no cwd provided", async () => {
    await spawnClaude("test");
    expect(spawnCalls[0].opts.cwd).toBe(process.cwd());
  });

  test("returns exit code from spawned process", async () => {
    mockExitCode = 1;
    const result = await spawnClaude("test");
    expect(result.exitCode).toBe(1);
  });

  test("passes --allowedTools when option provided", async () => {
    await spawnClaude("test", { allowedTools: ["Read", "Edit"] });
    const cmd = spawnCalls[0].cmd;
    expect(cmd).toContain("--allowedTools");
    const readIdx = cmd.indexOf("--allowedTools");
    expect(cmd[readIdx + 1]).toBe("Read");
    expect(cmd[readIdx + 2]).toBe("--allowedTools");
    expect(cmd[readIdx + 3]).toBe("Edit");
  });

  test("passes --model when option provided", async () => {
    await spawnClaude("test", { model: "claude-sonnet-4-6" });
    const cmd = spawnCalls[0].cmd;
    expect(cmd).toContain("--model");
    const idx = cmd.indexOf("--model");
    expect(cmd[idx + 1]).toBe("claude-sonnet-4-6");
  });

  test("uses acceptEdits permission mode by default", async () => {
    await spawnClaude("test");
    const cmd = spawnCalls[0].cmd;
    const idx = cmd.indexOf("--permission-mode");
    expect(idx).toBeGreaterThan(-1);
    expect(cmd[idx + 1]).toBe("acceptEdits");
  });

  test("allows custom permission mode", async () => {
    await spawnClaude("test", { permissionMode: "auto" });
    const cmd = spawnCalls[0].cmd;
    const idx = cmd.indexOf("--permission-mode");
    expect(cmd[idx + 1]).toBe("auto");
  });

  test("pipes long prompts via stdin instead of argument", async () => {
    const longPrompt = "x".repeat(100_000);
    await spawnClaude(longPrompt);
    expect(spawnCalls[0].cmd).toEqual(BASE_WITH_DEFAULTS);
    expect(spawnCalls[0].opts.stdin).toBe("pipe");
  });

  test("passes short prompts as positional argument", async () => {
    await spawnClaude("short prompt");
    expect(spawnCalls[0].cmd).toContain("short prompt");
    expect(spawnCalls[0].opts.stdin).toBe("ignore");
  });
});
