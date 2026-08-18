import { describe, test, expect, mock } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { NodeEnvelope } from "@websitelabs/software-teams";

// ── Spawn capture ────────────────────────────────────────────────────────────
// The MCP config is written to a private file that is deleted as soon as the
// turn resolves, so its contents and mode are read inside the interceptor,
// while the spawn is still notionally live.

type SpawnCall = {
  args: string[];
  configPath?: string;
  configBody?: string;
  configMode?: number;
  dirMode?: number;
};

const spawnCalls: SpawnCall[] = [];

function makeFakeProcess() {
  const stdoutListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const procListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const fakeProc = {
    stdout: {
      on(event: string, cb: (...args: unknown[]) => void) {
        stdoutListeners[event] = stdoutListeners[event] ?? [];
        stdoutListeners[event]!.push(cb);
      },
    },
    stdin: null,
    on(event: string, cb: (...args: unknown[]) => void) {
      procListeners[event] = procListeners[event] ?? [];
      procListeners[event]!.push(cb);
    },
  };

  Promise.resolve().then(() => {
    const data = Buffer.from(JSON.stringify({ type: "result", result: "done" }) + "\n");
    stdoutListeners["data"]?.forEach((cb) => cb(data));
    procListeners["close"]?.forEach((cb) => cb(0));
  });

  return fakeProc;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realCp = require("child_process") as typeof import("child_process");
const realSpawn = realCp.spawn;

mock.module("child_process", () => ({
  ...realCp,
  execSync: (cmd: string) => (cmd === "which claude" ? "/usr/local/bin/claude\n" : ""),
  spawn: mock((bin: string, args: string[], opts: Record<string, unknown>) => {
    if (!bin.endsWith("claude") && !bin.endsWith("claude.exe")) {
      return realSpawn(bin, args, opts as Parameters<typeof realSpawn>[2]);
    }
    const call: SpawnCall = { args: [...args] };
    const at = args.indexOf("--mcp-config");
    if (at !== -1) {
      const path = args[at + 1]!;
      call.configPath = path;
      call.configBody = readFileSync(path, "utf8");
      call.configMode = statSync(path).mode & 0o777;
      call.dirMode = statSync(path.replace(/\/[^/]+$/, "")).mode & 0o777;
    }
    spawnCalls.push(call);
    return makeFakeProcess();
  }),
}));

const { runAgentTurn } = await import("../single-turn");

// The root `bun test` run shares a worker with suites that mock single-turn
// wholesale. Probe for the real implementation and skip if it is doubled; the
// package-scoped runner always exercises these.
const probe: NodeEnvelope = {
  correlationId: "probe-mcp",
  agentId: "software-teams-quality",
  status: "ok",
  input: { prompt: "probe", context: null },
  result: { text: "" },
  artifacts: [],
};
await runAgentTurn(probe);
const realSpawnIntercepted = spawnCalls.length > 0;
spawnCalls.length = 0;

const SECRET = "pk_live_do_not_leak_2f9a";
const MCP_JSON = JSON.stringify({
  mcpServers: {
    clickup: { url: "https://mcp.clickup.com/mcp", headers: { Authorization: SECRET } },
    datadog: { url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp" },
  },
});

function envelope(): NodeEnvelope {
  return {
    correlationId: "run-mcp-001",
    agentId: "software-teams-backend",
    status: "ok",
    input: { prompt: "Investigate the ticket.", context: null },
    result: { text: "" },
    artifacts: [],
  };
}

describe.skipIf(!realSpawnIntercepted)("MCP config reaches the spawned CLI safely", () => {
  test("passes a file path to --mcp-config, never the config itself", async () => {
    spawnCalls.length = 0;
    await runAgentTurn(envelope(), undefined, undefined, {
      mcp: { json: MCP_JSON, allowedTools: [] },
    });

    const call = spawnCalls[0]!;
    expect(call.configPath).toBeDefined();
    expect(call.configPath).not.toContain("mcpServers");
    expect(call.configBody).toBe(MCP_JSON);
  });

  test("the credential never appears anywhere in argv", async () => {
    spawnCalls.length = 0;
    await runAgentTurn(envelope(), undefined, undefined, {
      mcp: { json: MCP_JSON, allowedTools: ["mcp__clickup__*"] },
    });

    expect(spawnCalls[0]!.args.join(" ")).not.toContain(SECRET);
  });

  test("the config file and its directory are private to the worker user", async () => {
    spawnCalls.length = 0;
    await runAgentTurn(envelope(), undefined, undefined, {
      mcp: { json: MCP_JSON, allowedTools: [] },
    });

    expect(spawnCalls[0]!.configMode).toBe(0o600);
    expect(spawnCalls[0]!.dirMode).toBe(0o700);
  });

  test("the config file is removed once the turn finishes", async () => {
    spawnCalls.length = 0;
    await runAgentTurn(envelope(), undefined, undefined, {
      mcp: { json: MCP_JSON, allowedTools: [] },
    });

    expect(existsSync(spawnCalls[0]!.configPath!)).toBe(false);
  });

  test("appends the MCP permission rules to the turn allowlist", async () => {
    spawnCalls.length = 0;
    await runAgentTurn(envelope(), undefined, undefined, {
      mcp: { json: MCP_JSON, allowedTools: ["mcp__clickup__*", "mcp__datadog__*"] },
    });

    const { args } = spawnCalls[0]!;
    const allowed = args.filter((a, i) => args[i - 1] === "--allowedTools");
    expect(allowed).toContain("mcp__clickup__*");
    expect(allowed).toContain("mcp__datadog__*");
    // Strict mode is what makes the passed set the whole set.
    expect(args).toContain("--strict-mcp-config");
  });

  test("omits --mcp-config entirely when no servers are configured", async () => {
    spawnCalls.length = 0;
    await runAgentTurn(envelope());

    expect(spawnCalls[0]!.args).not.toContain("--mcp-config");
    expect(spawnCalls[0]!.args).toContain("--strict-mcp-config");
  });
});
