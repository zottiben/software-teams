import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mergeHooks,
  removeHooks,
  readSettings,
  writeSettings,
} from "../utils/settings-merge";
import { orchestratorMode } from "../commands/orchestrator-mode";
import type { Settings } from "../utils/settings-merge";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: mergeHooks
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeHooks", () => {
  // AC1, AC3 — adds a new PreToolUseHook when none exists
  test("adds a new PreToolUseHook when matcher is absent", () => {
    const existing: Settings = {};
    const result = mergeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit|Write",
        command: "deny.sh",
      },
    ]);

    expect(result.hooks?.PreToolUse).toBeDefined();
    expect(result.hooks!.PreToolUse!).toHaveLength(1);
    expect(result.hooks!.PreToolUse![0]!.matcher).toBe("Edit|Write");
    expect(result.hooks!.PreToolUse![0]!.hooks).toEqual([
      { type: "command", command: "deny.sh" },
    ]);
  });

  // AC1, AC3 — adds a new HookEntry inside an existing PreToolUseHook
  test("adds a new HookEntry when matcher exists but command does not", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: "deny1.sh" }],
          },
        ],
      },
    };
    const result = mergeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit|Write",
        command: "deny2.sh",
      },
    ]);

    expect(result.hooks!.PreToolUse![0]!.hooks).toHaveLength(2);
    expect(result.hooks!.PreToolUse![0]!.hooks[0]).toEqual({
      type: "command",
      command: "deny1.sh",
    });
    expect(result.hooks!.PreToolUse![0]!.hooks[1]).toEqual({
      type: "command",
      command: "deny2.sh",
    });
  });

  // AC3 — idempotent on duplicate
  test("is idempotent: does NOT create duplicate HookEntry", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
        ],
      },
    };
    const result = mergeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit|Write",
        command: "deny.sh",
      },
    ]);

    expect(result.hooks!.PreToolUse![0]!.hooks).toHaveLength(1);
  });

  // AC1 — preserves unrelated top-level keys
  test("preserves unrelated top-level keys (allowedTools, custom keys)", () => {
    const existing: Settings = {
      allowedTools: ["Read", "Write"],
      custom: "value",
    };
    const result = mergeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    expect(result.allowedTools).toEqual(["Read", "Write"]);
    expect(result.custom).toBe("value");
  });

  // AC1 — preserves unrelated hook events
  test("preserves unrelated hook events (e.g., PostToolUse)", () => {
    const existing: Settings = {
      hooks: {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "post.sh" }] },
        ],
      },
    };
    const result = mergeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    expect(result.hooks!.PostToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "post.sh" }] },
    ]);
    expect(result.hooks!.PreToolUse).toBeDefined();
  });

  // AC3 — does not mutate input
  test("does not mutate the input object", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "a.sh" }] },
        ],
      },
    };
    const before = JSON.stringify(existing);

    mergeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "b.sh",
      },
    ]);

    expect(JSON.stringify(existing)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: removeHooks
// ─────────────────────────────────────────────────────────────────────────────

describe("removeHooks", () => {
  // AC2 — removes a HookEntry matching event/matcher/command
  test("removes a HookEntry matching event/matcher/command", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              { type: "command", command: "deny.sh" },
              { type: "command", command: "other.sh" },
            ],
          },
        ],
      },
    };
    const result = removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit|Write",
        command: "deny.sh",
      },
    ]);

    expect(result.hooks!.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(result.hooks!.PreToolUse![0]!.hooks[0]!.command).toBe("other.sh");
  });

  // AC2 — removes entire PreToolUseHook when hooks array becomes empty
  test("removes entire PreToolUseHook when its hooks array becomes empty", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
        ],
      },
    };
    const result = removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit|Write",
        command: "deny.sh",
      },
    ]);

    // When PreToolUse array becomes empty, the event is removed entirely.
    // When hooks becomes empty object, it is removed entirely.
    expect(result.hooks).toBeUndefined();
  });

  // AC2 — removes event key when its array becomes empty
  test("removes the event key when its array becomes empty", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
        ],
      },
    };
    const result = removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    // When the only PreToolUse entry is removed, hooks becomes empty and is deleted entirely.
    expect(result.hooks).toBeUndefined();
  });

  // AC2 — removes hooks top-level key when it becomes {}
  test("removes the hooks top-level key when it becomes empty object", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
        ],
      },
    };
    const result = removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    expect(result.hooks).toBeUndefined();
  });

  // AC2 — idempotent on already-removed entry
  test("is idempotent on an already-removed entry (no-op)", () => {
    const existing: Settings = {
      hooks: {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "post.sh" }] },
        ],
      },
    };
    const result = removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    // Nothing changed because PreToolUse entry never existed
    expect(JSON.stringify(result)).toBe(JSON.stringify(existing));
  });

  // AC2 — preserves unrelated entries
  test("preserves unrelated entries and events", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "deny-bash.sh" }],
          },
        ],
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "post.sh" }] },
        ],
      },
    };
    const result = removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    // Bash matcher under PreToolUse should remain
    expect(result.hooks!.PreToolUse).toHaveLength(1);
    expect(result.hooks!.PreToolUse![0]!.matcher).toBe("Bash");
    // PostToolUse should be untouched
    expect(result.hooks!.PostToolUse![0]!.matcher).toBe("Bash");
  });

  // AC3 — does not mutate input
  test("does not mutate the input object", () => {
    const existing: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
        ],
      },
    };
    const before = JSON.stringify(existing);

    removeHooks(existing, [
      {
        event: "PreToolUse",
        matcher: "Edit",
        command: "deny.sh",
      },
    ]);

    expect(JSON.stringify(existing)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: readSettings cold-start
// ─────────────────────────────────────────────────────────────────────────────

describe("readSettings cold-start", () => {
  // AC7 — returns {} when path does not exist
  test("returns {} when the path does not exist", async () => {
    const result = await readSettings("/nonexistent/path/settings.json");
    expect(result).toEqual({});
  });

  // AC7 — returns parsed object when path exists with valid JSON
  test("returns the parsed object when the path exists with valid JSON", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "test-"));
    const settingsPath = join(tmpDir, "settings.json");

    const data: Settings = {
      allowedTools: ["Read"],
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "deny.sh" }],
          },
        ],
      },
    };

    await writeFile(settingsPath, JSON.stringify(data));
    const result = await readSettings(settingsPath);

    expect(result).toEqual(data);

    await rm(tmpDir, { recursive: true });
  });

  // AC7 — throws clear error on corrupt JSON
  test("throws a clear error on corrupt JSON", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "test-"));
    const settingsPath = join(tmpDir, "settings.json");

    await writeFile(settingsPath, "{ invalid json");

    let error: Error | null = null;
    try {
      await readSettings(settingsPath);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain("invalid JSON");

    await rm(tmpDir, { recursive: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: writeSettings
// ─────────────────────────────────────────────────────────────────────────────

describe("writeSettings", () => {
  // AC7 — creates parent directory when missing
  test("creates the parent directory when missing", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "test-"));
    const settingsPath = join(tmpDir, "subdir", "nested", "settings.json");

    const data: Settings = { allowedTools: ["Read"] };
    await writeSettings(settingsPath, data);

    expect(existsSync(settingsPath)).toBe(true);

    await rm(tmpDir, { recursive: true });
  });

  // AC7 — writes 2-space-indented JSON with trailing newline
  test("writes 2-space-indented JSON with a trailing newline", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "test-"));
    const settingsPath = join(tmpDir, "settings.json");

    const data: Settings = {
      allowedTools: ["Read", "Write"],
      hooks: { PreToolUse: [] },
    };
    await writeSettings(settingsPath, data);

    const content = await readFile(settingsPath, "utf8");

    // Should end with newline
    expect(content.endsWith("\n")).toBe(true);

    // Should be 2-space indented
    expect(content).toContain('  "allowedTools"');

    await rm(tmpDir, { recursive: true });
  });

  // AC7 — round-trips correctly
  test("round-trips: write then read equals original", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "test-"));
    const settingsPath = join(tmpDir, "settings.json");

    const original: Settings = {
      allowedTools: ["Read", "Write", "Edit"],
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: ".claude/hooks/deny.sh" }],
          },
        ],
      },
    };

    await writeSettings(settingsPath, original);
    const roundtripped = await readSettings(settingsPath);

    expect(roundtripped).toEqual(original);

    await rm(tmpDir, { recursive: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests: orchestratorMode
// ─────────────────────────────────────────────────────────────────────────────

describe("orchestratorMode integration", () => {
  let originalCwd: string;
  let testDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), "orch-"));
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true });
  });

  // AC7 — cold-start creates all artefacts
  test("AC7: cold-start with no .claude/ directory creates all three artefacts", async () => {
    const exitCode = await orchestratorMode("on");

    expect(exitCode).toBe(0);
    expect(existsSync(".claude/orchestrator-mode.md")).toBe(true);
    expect(existsSync(".claude/CLAUDE.md")).toBe(true);
    expect(existsSync(".claude/settings.json")).toBe(true);
    expect(existsSync(".claude/hooks/orchestrator-deny-bash.sh")).toBe(true);
  });

  // AC1 — artefact shapes
  test("AC1: directive file starts with correct header", async () => {
    await orchestratorMode("on");
    const content = await readFile(".claude/orchestrator-mode.md", "utf8");
    expect(content.startsWith("# Orchestrator-Only Mode (ACTIVE)")).toBe(true);
  });

  test("AC1: CLAUDE.md contains exactly one @import line", async () => {
    await orchestratorMode("on");
    const content = await readFile(".claude/CLAUDE.md", "utf8");
    const lines = content.split("\n");
    const importLines = lines.filter((l) => l === "@.claude/orchestrator-mode.md");
    expect(importLines).toHaveLength(1);
  });

  test("AC1: settings.json has PreToolUse entry with correct shape", async () => {
    await orchestratorMode("on");
    const settings = await readSettings(".claude/settings.json");

    expect(settings.hooks?.PreToolUse).toBeDefined();
    const entry = settings.hooks!.PreToolUse!.find(
      (h) => h.matcher === "Edit|Write|NotebookEdit|Bash",
    );
    expect(entry).toBeDefined();
    expect(entry!.hooks.some((h) => h.command === ".claude/hooks/orchestrator-deny-bash.sh")).toBe(
      true,
    );
  });

  // AC3 — idempotency
  test("AC3: toggle on twice produces no duplicate @import line", async () => {
    await orchestratorMode("on");
    await orchestratorMode("on");

    const content = await readFile(".claude/CLAUDE.md", "utf8");
    const lines = content.split("\n");
    const importLines = lines.filter((l) => l === "@.claude/orchestrator-mode.md");
    expect(importLines).toHaveLength(1);
  });

  test("AC3: toggle on twice produces no duplicate hook entry", async () => {
    await orchestratorMode("on");
    await orchestratorMode("on");

    const settings = await readSettings(".claude/settings.json");
    const entries = settings.hooks!.PreToolUse!.filter(
      (h) => h.matcher === "Edit|Write|NotebookEdit|Bash",
    );
    expect(entries).toHaveLength(1);
  });

  // AC2 — toggle off removes artefacts cleanly
  test("AC2: toggle off removes directive file", async () => {
    await orchestratorMode("on");
    expect(existsSync(".claude/orchestrator-mode.md")).toBe(true);

    await orchestratorMode("off");
    expect(existsSync(".claude/orchestrator-mode.md")).toBe(false);
  });

  test("AC2: toggle off removes @import line from CLAUDE.md", async () => {
    await orchestratorMode("on");
    await orchestratorMode("off");

    // If CLAUDE.md is empty after removing the line, it is deleted entirely.
    // Otherwise it still exists without the import line.
    const exists = existsSync(".claude/CLAUDE.md");
    if (exists) {
      const content = await readFile(".claude/CLAUDE.md", "utf8");
      expect(content).not.toContain("@.claude/orchestrator-mode.md");
    }
  });

  test("AC2: toggle off preserves unrelated hooks in settings.json", async () => {
    // Set up a pre-existing PostToolUse hook
    await mkdir(".claude", { recursive: true });
    const preExisting: Settings = {
      hooks: {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "post.sh" }] },
        ],
      },
    };
    await writeSettings(".claude/settings.json", preExisting);

    // Toggle on
    await orchestratorMode("on");

    // Toggle off
    await orchestratorMode("off");

    // PostToolUse should still be there
    const settings = await readSettings(".claude/settings.json");
    expect(settings.hooks?.PostToolUse).toBeDefined();
    expect(settings.hooks!.PostToolUse![0]!.matcher).toBe("Bash");
  });

  test("AC2: toggle off is idempotent on already-off state", async () => {
    // Start with no files
    const result1 = await orchestratorMode("off");
    expect(result1).toBe(0);

    // Call again
    const result2 = await orchestratorMode("off");
    expect(result2).toBe(0);
  });

  // AC4 — status detects drift
  test("AC4: status reports DRIFT when directive exists but @import missing", async () => {
    // Create only the directive file
    await mkdir(".claude", { recursive: true });
    await writeFile(".claude/orchestrator-mode.md", "# Orchestrator-Only Mode (ACTIVE)\n");

    let stdout = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdout += msg + "\n";
    };

    try {
      await orchestratorMode("status");
    } finally {
      console.log = originalLog;
    }

    expect(stdout).toContain("present");
    expect(stdout).toContain("missing");
    expect(stdout).toContain("DRIFT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Behavioural test: orchestrator-deny-bash.sh script
// ─────────────────────────────────────────────────────────────────────────────

describe("orchestrator-deny-bash.sh", () => {
  // Check if bash and jq are available
  const canRunBashTest = (): boolean => {
    try {
      const bashResult = Bun.spawnSync(["bash", "-c", "command -v bash > /dev/null 2>&1"]);
      const jqResult = Bun.spawnSync(["bash", "-c", "command -v jq > /dev/null 2>&1"]);
      return bashResult.success && jqResult.success;
    } catch {
      return false;
    }
  };

  const runDenyScript = async (
    payload: Record<string, unknown>,
    envOverrides: Record<string, string> = {},
  ): Promise<{ exitCode: number; stderr: string }> => {
    const payloadJson = JSON.stringify(payload);
    const baseEnv = { ...process.env };
    delete baseEnv.CLAUDE_BG_SOURCE;
    delete baseEnv.CLAUDE_BG_BACKEND;
    delete baseEnv.CLAUDE_BG_ISOLATION;
    delete baseEnv.CLAUDE_CODE_SESSION_NAME;
    delete baseEnv.CLAUDE_BG_SESSION_PERMISSION_RULES;
    const env = { ...baseEnv, ...envOverrides };
    const proc = Bun.spawn(
      [
        "bash",
        join(import.meta.dir, "..", "..", "templates", ".claude", "hooks", "orchestrator-deny-bash.sh"),
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      },
    );

    const stdin = proc.stdin as unknown as NodeJS.WritableStream;
    stdin.write(payloadJson);
    stdin.end();

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { exitCode, stderr };
  };

  const skip = canRunBashTest() ? test : test.skip;

  skip("Edit tool is denied with exit 2", async () => {
    const { exitCode, stderr } = await runDenyScript({
      tool_name: "Edit",
      tool_input: { path: "file.ts", range: [1, 10], old_string: "x", new_string: "y" },
    });

    expect(exitCode).toBe(2);
    expect(stderr).toContain("Edit");
    expect(stderr).toContain("blocked");
  });

  skip("Bash with git status is allowed", async () => {
    const { exitCode, stderr } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  skip("Bash with git commit is allowed (delivery command)", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'test'" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with git push is allowed (delivery command)", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with npm install is allowed (management command)", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "npm install" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with gh pr create is allowed (delivery command)", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "gh pr create --fill" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with git reset --hard is denied (destructive)", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "git reset --hard HEAD~1" },
    });

    expect(exitCode).toBe(2);
  });

  skip("Bash with echo to /dev/null is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "echo foo > /dev/null" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with echo to file is denied", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "echo foo > file.txt" },
    });

    expect(exitCode).toBe(2);
  });

  skip("Bash with rm is denied", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "rm file.txt" },
    });

    expect(exitCode).toBe(2);
  });

  skip("Bash with git log is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "git log --oneline" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with 2>&1 fd-duplication is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "bun test 2>&1" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with >&2 fd-duplication is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "echo err >&2" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with > /dev/null 2>&1 is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "make build > /dev/null 2>&1" },
    });

    expect(exitCode).toBe(0);
  });

  skip("Bash with csh-style >& file redirect is denied", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "ls >& out.txt" },
    });

    expect(exitCode).toBe(2);
  });

  // Subagent exemption — Task-spawned subagents must NOT be blocked.
  skip("Edit from a subagent (agent_id present) is allowed", async () => {
    const { exitCode, stderr } = await runDenyScript({
      tool_name: "Edit",
      tool_input: { file_path: "file.ts", old_string: "x", new_string: "y" },
      agent_id: "agent_abc123",
      agent_type: "software-teams-programmer",
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  skip("Write from a subagent (agent_id present) is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Write",
      tool_input: { file_path: "file.ts", content: "x" },
      agent_id: "agent_abc123",
    });

    expect(exitCode).toBe(0);
  });

  skip("Otherwise-denied Bash from a subagent (agent_id present) is allowed", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Bash",
      tool_input: { command: "rm file.txt" },
      agent_id: "agent_abc123",
    });

    expect(exitCode).toBe(0);
  });

  skip("Empty agent_id ('') is treated as absent — main-thread Edit still blocked", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Edit",
      tool_input: { file_path: "file.ts", old_string: "x", new_string: "y" },
      agent_id: "",
    });

    expect(exitCode).toBe(2);
  });

  // Teammate exemption — full Claude Code processes spawned via TeamCreate
  // inherit this hook through .claude/settings.json but must NOT be blocked.
  // Detection is via env vars Claude Code sets on teammate sessions.
  skip("Edit from a teammate process (CLAUDE_BG_SOURCE set) is allowed", async () => {
    const { exitCode, stderr } = await runDenyScript(
      {
        tool_name: "Edit",
        tool_input: { file_path: "file.ts", old_string: "x", new_string: "y" },
      },
      { CLAUDE_BG_SOURCE: "shell" },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  skip("Otherwise-denied Bash from a teammate (CLAUDE_CODE_SESSION_NAME set) is allowed", async () => {
    const { exitCode } = await runDenyScript(
      {
        tool_name: "Bash",
        tool_input: { command: "rm file.txt" },
      },
      { CLAUDE_CODE_SESSION_NAME: "agent-001" },
    );

    expect(exitCode).toBe(0);
  });

  skip("Main-thread Edit (no env vars, no agent_id) is still blocked", async () => {
    const { exitCode } = await runDenyScript({
      tool_name: "Edit",
      tool_input: { file_path: "file.ts", old_string: "x", new_string: "y" },
    });

    expect(exitCode).toBe(2);
  });
});
