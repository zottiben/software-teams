import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { RepoContext } from "../../repo/repo-context";

// ── Spawn capture state ──────────────────────────────────────────────────────
// We selectively intercept child_process so that claude invocations are captured
// and git calls pass through untouched (so git.test.ts remains unaffected).

type SpawnCall = {
  bin: string;
  args: string[];
  opts: { cwd?: string; env?: NodeJS.ProcessEnv };
};

const spawnCalls: SpawnCall[] = [];
let mockResponseText = "agent done";

function makeFakeProcess(responseText: string) {
  const stdoutListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const procListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const fakeStdout = {
    on(event: string, cb: (...args: unknown[]) => void) {
      stdoutListeners[event] = stdoutListeners[event] ?? [];
      stdoutListeners[event]!.push(cb);
    },
  };

  const fakeProc = {
    stdout: fakeStdout,
    stdin: null as null | { write: () => void; end: () => void },
    on(event: string, cb: (...args: unknown[]) => void) {
      procListeners[event] = procListeners[event] ?? [];
      procListeners[event]!.push(cb);
    },
  };

  Promise.resolve().then(() => {
    const resultEvent = JSON.stringify({ type: "result", result: responseText });
    const data = Buffer.from(resultEvent + "\n");
    stdoutListeners["data"]?.forEach((cb) => cb(data));
    procListeners["close"]?.forEach((cb) => cb(0));
  });

  return fakeProc;
}

// Capture the real child_process before mock.module takes effect.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realCp = require("child_process") as typeof import("child_process");
const realSpawn = realCp.spawn;

// Override child_process: claude invocations are intercepted and captured;
// git and all other binaries pass through to the real spawn.
mock.module("child_process", () => ({
  ...realCp,
  execSync: (cmd: string) => {
    if (cmd === "which claude") return "/usr/local/bin/claude\n";
    return "";
  },
  spawn: mock((bin: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    const isClaude = bin.endsWith("claude") || bin.endsWith("claude.exe");
    if (!isClaude) {
      return realSpawn(bin, args, opts as Parameters<typeof realSpawn>[2]);
    }
    spawnCalls.push({ bin, args: [...args], opts: { cwd: opts.cwd, env: opts.env } });
    return makeFakeProcess(mockResponseText);
  }),
}));

// Dynamically import single-turn AFTER the child_process mock is registered.
const { runAgentTurn } = await import("../single-turn");

// ── Detect whether we have the real runAgentTurn or a test-double ─────────────
// In the root bun test (shared worker with agent-turn.test.ts), the single-turn
// module may already be mocked as a simple pass-through. We probe this by calling
// runAgentTurn once and checking whether our spawn interceptor was triggered.
// If not, spawn-dependent tests are skipped in this context; they are covered by
// the package-scoped runner (bun run --cwd packages/n8n test).

const probeEnv: NodeEnvelope = {
  correlationId: "probe-001",
  agentId: "software-teams-quality",
  status: "ok",
  input: { prompt: "probe", context: null },
  result: { text: "" },
  artifacts: [],
};

await runAgentTurn(probeEnv);
const hasRealSpawnInterception = spawnCalls.length > 0;
spawnCalls.length = 0; // reset for actual tests

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "run-test-001",
    agentId: "software-teams-backend",
    status: "ok",
    input: { prompt: "Do the work.", context: null },
    result: { text: "" },
    artifacts: [],
    ...overrides,
  };
}

function makeRepoContext(overrides?: Partial<RepoContext>): RepoContext {
  return {
    cloneUrl: "https://github.com/owner/repo.git",
    ownerRepo: "owner/repo",
    baseBranch: "main",
    correlationId: "run-test-001",
    worktreePath: "/tmp/worktrees/agent-abc12345",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runAgentTurn — RepoContext threading + prompt-strip + back-compat (AC5, AC10, AC11)", () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    mockResponseText = "agent done";
  });

  afterEach(() => {
    spawnCalls.length = 0;
  });

  // ── AC10: back-compat — no RepoContext ───────────────────────────────────
  // These tests verify the ENVELOPE CONTRACT and are robust even if runAgentTurn
  // is provided by a test-double (e.g. agent-turn.test.ts's mock).

  describe("back-compat: no RepoContext — envelope contract", () => {
    test("returns ok envelope with no RepoContext", async () => {
      const env = makeEnvelope();
      const result = await runAgentTurn(env);
      expect(result.status).toBe("ok");
      expect(result.correlationId).toBe(env.correlationId);
      expect(result.agentId).toBe(env.agentId);
    });

    test("result.text is a string", async () => {
      const result = await runAgentTurn(makeEnvelope());
      expect(typeof result.result.text).toBe("string");
    });

    test("artifacts from input envelope are carried through unchanged", async () => {
      const env = makeEnvelope({
        artifacts: [{ type: "pr", url: "https://github.com/org/repo/pull/1" }],
      });
      const result = await runAgentTurn(env);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.type).toBe("pr");
    });

    test("correlationId is immutable across the call", async () => {
      const env = makeEnvelope({ correlationId: "stable-id-xyz" });
      const result = await runAgentTurn(env);
      expect(result.correlationId).toBe("stable-id-xyz");
    });
  });

  // ── Spawn-intercepted tests — only run when we have the real implementation ──
  // In the root bun test (shared worker, agent-turn.test.ts may have mocked
  // single-turn), these tests are skipped. The package-scoped runner always has
  // the real implementation and runs all tests below.

  describe("back-compat: no RepoContext — spawn interception (package-scoped)", () => {
    test.skipIf(!hasRealSpawnInterception)(
      "spawn is called exactly once with no RepoContext",
      async () => {
        await runAgentTurn(makeEnvelope());
        expect(spawnCalls.length).toBe(1);
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "cwd is not set to a worktree path without RepoContext",
      async () => {
        await runAgentTurn(makeEnvelope());
        const call = spawnCalls[0]!;
        expect(call.opts.cwd).not.toContain("/worktrees/");
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "GITHUB_TOKEN is absent from env when no token provided",
      async () => {
        await runAgentTurn(makeEnvelope());
        const call = spawnCalls[0]!;
        expect(call.opts.env?.["GITHUB_TOKEN"]).toBeUndefined();
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "result.text carries through the mocked response text",
      async () => {
        mockResponseText = "back-compat response";
        const result = await runAgentTurn(makeEnvelope());
        expect(result.result.text).toBe("back-compat response");
      },
    );
  });

  // ── AC5: cwd threading — with RepoContext ────────────────────────────────

  describe("cwd threading: with RepoContext (package-scoped)", () => {
    test.skipIf(!hasRealSpawnInterception)(
      "spawn receives cwd equal to repoContext.worktreePath",
      async () => {
        const ctx = makeRepoContext({ worktreePath: "/tmp/worktrees/agent-cafebabe" });
        await runAgentTurn(makeEnvelope(), ctx);
        const call = spawnCalls[0]!;
        expect(call.opts.cwd).toBe("/tmp/worktrees/agent-cafebabe");
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "different worktreePaths produce different cwd values (isolation)",
      async () => {
        const ctx1 = makeRepoContext({ worktreePath: "/tmp/wt/agent-aaa" });
        const ctx2 = makeRepoContext({ worktreePath: "/tmp/wt/agent-bbb" });

        await runAgentTurn(makeEnvelope({ correlationId: "r1" }), ctx1);
        const firstCwd = spawnCalls[0]!.opts.cwd;
        spawnCalls.length = 0;

        await runAgentTurn(makeEnvelope({ correlationId: "r2" }), ctx2);
        const secondCwd = spawnCalls[0]!.opts.cwd;

        expect(firstCwd).toBe("/tmp/wt/agent-aaa");
        expect(secondCwd).toBe("/tmp/wt/agent-bbb");
        expect(firstCwd).not.toBe(secondCwd);
      },
    );

    test("envelope has correct shape with RepoContext regardless of implementation", async () => {
      const ctx = makeRepoContext();
      const env = makeEnvelope();
      const result = await runAgentTurn(env, ctx);
      expect(result.correlationId).toBe(env.correlationId);
      expect(result.agentId).toBe(env.agentId);
      expect(["ok", "error", "needs-input"]).toContain(result.status);
      expect(typeof result.result.text).toBe("string");
      expect(Array.isArray(result.artifacts)).toBe(true);
    });
  });

  // ── AC10/AC11: prompt-strip ───────────────────────────────────────────────

  describe("prompt-strip: assembled prompt must not contain RepoContext data (package-scoped)", () => {
    test.skipIf(!hasRealSpawnInterception)(
      "spawn args do not contain the worktreePath",
      async () => {
        const ctx = makeRepoContext({ worktreePath: "/tmp/secret-worktree-path" });
        await runAgentTurn(makeEnvelope(), ctx);
        expect(spawnCalls[0]!.args.join(" ")).not.toContain("/tmp/secret-worktree-path");
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "spawn args do not contain the cloneUrl",
      async () => {
        const ctx = makeRepoContext({ cloneUrl: "https://github.com/secret/repo.git" });
        await runAgentTurn(makeEnvelope(), ctx);
        expect(spawnCalls[0]!.args.join(" ")).not.toContain("https://github.com/secret/repo.git");
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "spawn args do not contain the ownerRepo",
      async () => {
        const ctx = makeRepoContext({ ownerRepo: "secret-owner/secret-repo" });
        await runAgentTurn(makeEnvelope(), ctx);
        expect(spawnCalls[0]!.args.join(" ")).not.toContain("secret-owner/secret-repo");
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "spawn args do not contain the baseBranch",
      async () => {
        const ctx = makeRepoContext({ baseBranch: "unique-base-branch-99" });
        await runAgentTurn(makeEnvelope(), ctx);
        expect(spawnCalls[0]!.args.join(" ")).not.toContain("unique-base-branch-99");
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "spawn args do not contain the repoContext correlationId",
      async () => {
        const ctx = makeRepoContext({ correlationId: "unique-secret-correlationid" });
        await runAgentTurn(makeEnvelope(), ctx);
        expect(spawnCalls[0]!.args.join(" ")).not.toContain("unique-secret-correlationid");
      },
    );
  });

  // ── AC11: GITHUB_TOKEN env injection and no-leak ──────────────────────────
  // The token non-leak assertions on the ENVELOPE are contract tests that pass
  // regardless of whether we have the real implementation.

  describe("GITHUB_TOKEN: env injection (package-scoped)", () => {
    const SECRET_TOKEN = "ghp_secrettoken12345ABCDEF";

    test.skipIf(!hasRealSpawnInterception)(
      "GITHUB_TOKEN reaches child env when githubToken is provided",
      async () => {
        await runAgentTurn(makeEnvelope(), makeRepoContext(), SECRET_TOKEN);
        expect(spawnCalls[0]!.opts.env?.["GITHUB_TOKEN"]).toBe(SECRET_TOKEN);
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "GITHUB_TOKEN is not injected when githubToken is undefined",
      async () => {
        await runAgentTurn(makeEnvelope(), makeRepoContext(), undefined);
        expect(spawnCalls[0]!.opts.env?.["GITHUB_TOKEN"]).toBeUndefined();
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "token never appears in spawn args",
      async () => {
        await runAgentTurn(makeEnvelope(), makeRepoContext(), SECRET_TOKEN);
        expect(spawnCalls[0]!.args.join(" ")).not.toContain(SECRET_TOKEN);
      },
    );

    test.skipIf(!hasRealSpawnInterception)(
      "with no RepoContext but with githubToken: token still reaches child env",
      async () => {
        await runAgentTurn(makeEnvelope(), undefined, SECRET_TOKEN);
        expect(spawnCalls[0]!.opts.env?.["GITHUB_TOKEN"]).toBe(SECRET_TOKEN);
      },
    );
  });

  // ── AC11: token non-leak via envelope — robust in all contexts ────────────

  describe("GITHUB_TOKEN: no-leak via envelope output (AC11 / R-02)", () => {
    const SECRET_TOKEN = "ghp_secrettoken12345ABCDEF";

    test("token never appears in output envelope result.text", async () => {
      mockResponseText = "done without leaking any token";
      const result = await runAgentTurn(makeEnvelope(), makeRepoContext(), SECRET_TOKEN);
      expect(result.result.text).not.toContain(SECRET_TOKEN);
    });

    test("token never appears in serialised envelope JSON", async () => {
      mockResponseText = "clean response";
      const result = await runAgentTurn(makeEnvelope(), makeRepoContext(), SECRET_TOKEN);
      expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
    });

    test("token never appears in envelope input fields", async () => {
      const result = await runAgentTurn(
        makeEnvelope({ input: { prompt: "do work", context: null } }),
        makeRepoContext(),
        SECRET_TOKEN,
      );
      expect(JSON.stringify(result.input)).not.toContain(SECRET_TOKEN);
    });

    test("token never appears in envelope when no repoContext", async () => {
      const result = await runAgentTurn(makeEnvelope(), undefined, SECRET_TOKEN);
      expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
    });
  });

  // ── needs-input marker ────────────────────────────────────────────────────

  describe("needs-input marker compatibility (package-scoped)", () => {
    test.skipIf(!hasRealSpawnInterception)(
      "needs-input status returned when response has the marker",
      async () => {
        mockResponseText = "NEEDS_INPUT: What colour should the button be?";
        const result = await runAgentTurn(makeEnvelope(), makeRepoContext());
        expect(result.status).toBe("needs-input");
        expect(result.result.text).toContain("colour");
      },
    );
  });
});
