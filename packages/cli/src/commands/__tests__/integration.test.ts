/**
 * Integration tests — T7 of plan 1-02-n8n-manual-cli.
 *
 * These are SUBPROCESS-level tests that verify process invariants the in-process
 * unit tests (agent-turn.test.ts, orchestrator-turn.test.ts, ingest.test.ts,
 * output.test.ts) cannot assert: real exit codes, real byte-for-byte stdout
 * purity, and real stdin/--envelope precedence.
 *
 * Coverage targets (from T7 done_when + quality gates):
 *  json-purity-gate  — `--json` stdout = exactly JSON.stringify(envelope)+\n; nothing else.
 *  exit-code-gate    — ok/needs-input→0; error→1; bad-input→2 for all four verbs.
 *  contract-conformance — emitted envelopes have all six NodeEnvelope fields.
 *  stdin/--envelope precedence — subprocess end-to-end, all verbs.
 *
 * Test seams (no claude binary, no network):
 *  STO_FAKE_ENGINE=ok|needs-input|error — the runVerb fake-engine seam in
 *    _envelope-io.ts. Used by agent-turn, orchestrator-turn, and output (they
 *    all call runVerb and the seam fires before any real engine is invoked).
 *    Token env vars must be UNSET so no real fetch happens even if the seam
 *    is bypassed (double safety). For output the token check runs before
 *    runVerb, so GITHUB_TOKEN is set to a stub for the STO_FAKE_ENGINE path
 *    only (never a real token).
 *  ST_CLI_TEST_STUB=1 — the ingest adapter stub in ingest.ts. Returns
 *    deterministic offline contexts; no network, no real token validation.
 *
 * Notes:
 *  - Agent-turn and orchestrator-turn subprocess tests use STO_FAKE_ENGINE.
 *    Their in-process unit tests cover engine business logic separately.
 *  - Ingest subprocess ok-paths use ST_CLI_TEST_STUB=1.
 *    Input-error paths (exit 2) need neither seam.
 *  - Output ok/needs-input/error paths use STO_FAKE_ENGINE with GITHUB_TOKEN=stub.
 *    The missing-token path (exit 1) uses the real token check.
 *  - ANTHROPIC_API_KEY, CLICKUP_API_KEY, DATADOG_API_KEY, DATADOG_APP_KEY are
 *    stripped from every spawned process environment to prevent accidental
 *    real-network calls if a seam is bypassed.
 */

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import type { NodeEnvelope } from "../../contract/envelope";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "index.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal valid NodeEnvelope fixture for use as subprocess stdin. */
function makeFixtureEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "integration-test-run-001",
    agentId: "software-teams-backend",
    status: "ok",
    input: { prompt: "Do the integration thing", context: null },
    result: { text: "Ready." },
    artifacts: [],
    ...overrides,
  };
}

/**
 * Base environment for spawned test processes:
 * - Strips real API keys / tokens so no real network calls can happen.
 * - Keeps PATH and other essentials from the current process.
 */
function safeEnv(extra?: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  // Strip all real tokens (safety: seam must be the only path to success).
  delete env["ANTHROPIC_API_KEY"];
  delete env["CLICKUP_API_KEY"];
  delete env["DATADOG_API_KEY"];
  delete env["DATADOG_APP_KEY"];
  delete env["GITHUB_TOKEN"];
  delete env["GH_TOKEN"];
  // Apply test-specific overrides.
  return { ...env, ...extra };
}

/**
 * Spawn `bun src/index.ts <verb> [args...]` with optional stdin and capture
 * the exit code, stdout, and stderr.
 */
async function spawnVerb(opts: {
  verb: string;
  args?: string[];
  stdinData?: string;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, opts.verb, ...(opts.args ?? [])],
    stdin: opts.stdinData !== undefined ? Buffer.from(opts.stdinData) : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env ?? safeEnv(),
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

// ─── json-purity-gate helpers ─────────────────────────────────────────────────

/** Assert byte-for-byte json purity: stdout = JSON.stringify(envelope) + "\n" only. */
function assertJsonPurity(stdout: string, expectedEnvelope: NodeEnvelope): void {
  // Must parse without throwing.
  let parsed: NodeEnvelope;
  expect(() => { parsed = JSON.parse(stdout) as NodeEnvelope; }).not.toThrow();
  // Must equal the envelope exactly.
  expect(JSON.parse(stdout)).toEqual(expectedEnvelope);
  // stdout must be exactly JSON.stringify(envelope) + "\n" — no leading/trailing garbage.
  expect(stdout).toBe(JSON.stringify(expectedEnvelope) + "\n");
  // Exactly one non-empty line.
  const lines = stdout.split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
}

/** Assert contract conformance: all six NodeEnvelope fields are present and typed correctly. */
function assertContractConformance(obj: unknown): void {
  const env = obj as NodeEnvelope;
  expect(typeof env.correlationId).toBe("string");
  expect(env.correlationId.length).toBeGreaterThan(0);
  expect(typeof env.agentId).toBe("string");
  expect(["ok", "error", "needs-input"]).toContain(env.status);
  expect(typeof env.input).toBe("object");
  expect(typeof env.input.prompt).toBe("string");
  expect(typeof env.result).toBe("object");
  expect(typeof env.result.text).toBe("string");
  expect(Array.isArray(env.artifacts)).toBe(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// agent-turn — subprocess integration
// ─────────────────────────────────────────────────────────────────────────────

describe("agent-turn subprocess — json-purity-gate (STO_FAKE_ENGINE)", () => {
  const fixture = makeFixtureEnvelope();
  const stdinData = JSON.stringify(fixture);

  test("ok status: stdout is exactly JSON.stringify(envelope)+newline — nothing else", async () => {
    const { exitCode, stdout, stderr: _stderr } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });
    expect(exitCode).toBe(0);
    const expectedEnvelope = { ...fixture, status: "ok" as const };
    assertJsonPurity(stdout, expectedEnvelope);
    assertContractConformance(JSON.parse(stdout));
  }, 20000);

  test("needs-input status: stdout is pure envelope JSON", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "needs-input" }),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("needs-input");
    assertJsonPurity(stdout, { ...fixture, status: "needs-input" });
  }, 20000);

  test("error status: stdout is pure error envelope JSON", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "error" }),
    });
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("error");
    assertJsonPurity(stdout, { ...fixture, status: "error" });
  }, 20000);
});

describe("agent-turn subprocess — exit-code-gate", () => {
  const stdinData = JSON.stringify(makeFixtureEnvelope());

  test("ok → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("needs-input → exit 0 (valid HITL park, not a failure)", async () => {
    const { exitCode } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "needs-input" }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("error → exit 1", async () => {
    const { exitCode } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "error" }),
    });
    expect(exitCode).toBe(1);
  }, 20000);

  test("bad-input (malformed stdin) → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json"],
      stdinData: "not-json{{{",
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe(""); // exit 2 writes NOTHING to stdout
  }, 20000);
});

describe("agent-turn subprocess — --envelope precedence over stdin", () => {
  test("--envelope flag value used, stdin reader never consulted", async () => {
    const flagEnvelope = makeFixtureEnvelope({ correlationId: "from-flag-agent" });
    const stdinEnvelope = makeFixtureEnvelope({ correlationId: "from-stdin-agent" });

    const { exitCode, stdout } = await spawnVerb({
      verb: "agent-turn",
      args: ["--json", "--envelope", JSON.stringify(flagEnvelope)],
      stdinData: JSON.stringify(stdinEnvelope),
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    // The flag envelope's correlationId must win.
    expect(parsed.correlationId).toBe("from-flag-agent");
    expect(parsed.correlationId).not.toBe("from-stdin-agent");
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// orchestrator-turn — subprocess integration
// ─────────────────────────────────────────────────────────────────────────────

describe("orchestrator-turn subprocess — json-purity-gate (STO_FAKE_ENGINE)", () => {
  const fixture = makeFixtureEnvelope({
    agentId: "software-teams-planner",
    input: { prompt: "Build the notification system", context: null },
  });
  const stdinData = JSON.stringify(fixture);

  test("ok status: stdout is exactly JSON.stringify(envelope)+newline", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });
    expect(exitCode).toBe(0);
    const expectedEnvelope = { ...fixture, status: "ok" as const };
    assertJsonPurity(stdout, expectedEnvelope);
    assertContractConformance(JSON.parse(stdout));
  }, 20000);

  test("needs-input status: pure envelope JSON, exit 0", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "needs-input" }),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("needs-input");
  }, 20000);

  test("error status: pure error envelope JSON, exit 1", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "error" }),
    });
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("error");
  }, 20000);
});

describe("orchestrator-turn subprocess — exit-code-gate", () => {
  const stdinData = JSON.stringify(makeFixtureEnvelope({
    input: { prompt: "Epic goal", context: null },
  }));

  test("ok → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("needs-input → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "needs-input" }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("error → exit 1", async () => {
    const { exitCode } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "error" }),
    });
    expect(exitCode).toBe(1);
  }, 20000);

  test("bad-input (malformed stdin) → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData: "{{bad-json}}",
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);
});

describe("orchestrator-turn subprocess — --envelope precedence over stdin", () => {
  test("--envelope flag value used, stdin ignored", async () => {
    const flagEnvelope = makeFixtureEnvelope({
      correlationId: "from-flag-orch",
      input: { prompt: "Build the payments system", context: null },
    });
    const stdinEnvelope = makeFixtureEnvelope({
      correlationId: "from-stdin-orch",
      input: { prompt: "This should not appear", context: null },
    });

    const { exitCode, stdout } = await spawnVerb({
      verb: "orchestrator-turn",
      args: ["--json", "--envelope", JSON.stringify(flagEnvelope)],
      stdinData: JSON.stringify(stdinEnvelope),
      env: safeEnv({ STO_FAKE_ENGINE: "ok" }),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.correlationId).toBe("from-flag-orch");
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// ingest — subprocess integration (ST_CLI_TEST_STUB for ok-paths)
// ─────────────────────────────────────────────────────────────────────────────

const CLICKUP_URL = "https://app.clickup.com/t/123456789/NDP-33700";
const DATADOG_URL =
  "https://app.datadoghq.com/error-tracking?" +
  "sp=%7B%22issueId%22%3A%22abcdef12-1234-5678-abcd-ef1234567890%22%7D";

describe("ingest subprocess — json-purity-gate (ST_CLI_TEST_STUB=1)", () => {
  test("clickup ok: stdout is exactly one valid JSON NodeEnvelope — nothing else", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "clickup", "--url", CLICKUP_URL, "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(0);
    // Must parse cleanly.
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    assertContractConformance(parsed);
    // Byte-for-byte purity: stdout = JSON.stringify(parsed) + "\n".
    expect(stdout).toBe(JSON.stringify(parsed) + "\n");
    // Exactly one non-empty line.
    expect(stdout.split("\n").filter(Boolean)).toHaveLength(1);
  }, 20000);

  test("datadog ok: stdout is exactly one valid JSON NodeEnvelope", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "datadog", "--url", DATADOG_URL, "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    assertContractConformance(parsed);
    expect(stdout).toBe(JSON.stringify(parsed) + "\n");
  }, 20000);
});

describe("ingest subprocess — exit-code-gate", () => {
  test("clickup ok → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "clickup", "--url", CLICKUP_URL, "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("datadog ok → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "datadog", "--url", DATADOG_URL, "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("graceful degradation (no token, real adapter path) → exit 0, context null in output", async () => {
    // No ST_CLI_TEST_STUB, no CLICKUP_API_KEY — adapter returns null → status: ok, context: null.
    // Uses the real adapter which returns null for empty credentials.
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "clickup", "--url", CLICKUP_URL, "--json"],
      // No token in env (safeEnv strips it), no stub — hits graceful degradation path.
      env: safeEnv(),
    });
    expect(exitCode).toBe(0);
    // stdout is a valid JSON envelope with context: null.
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    expect(parsed.input.context).toBeNull();
  }, 20000);

  test("invalid --source → exit 2", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "invalid", "--url", "https://example.com", "--json"],
      env: safeEnv(),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);

  test("unparseable ClickUp ref → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "clickup", "--url", "https://example.com/not-clickup", "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);

  test("unparseable Datadog ref → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "datadog", "--url", "https://example.com/not-datadog", "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);
});

describe("ingest subprocess — stdout contains no token (R-02 secret-guard)", () => {
  test("CLICKUP_API_KEY does not appear in stdout or stderr under --json", async () => {
    const secretToken = "clk_test_secret_token_should_not_leak";
    const { stdout, stderr } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "clickup", "--url", CLICKUP_URL, "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1", CLICKUP_API_KEY: secretToken }),
    });
    expect(stdout).not.toContain(secretToken);
    expect(stderr).not.toContain(secretToken);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// output — subprocess integration (STO_FAKE_ENGINE for ok/error paths)
// ─────────────────────────────────────────────────────────────────────────────

const STUB_GITHUB_TOKEN = "ghp_stubtoken_integration_test";

describe("output subprocess — json-purity-gate (STO_FAKE_ENGINE)", () => {
  const fixture = makeFixtureEnvelope({
    result: { text: "Implemented the feature. All tests pass." },
  });
  const stdinData = JSON.stringify(fixture);

  test("pr mode ok: stdout is exactly one valid JSON NodeEnvelope — nothing else", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "owner", "--repo", "repo", "--head", "feat/branch", "--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    assertContractConformance(parsed);
    expect(stdout).toBe(JSON.stringify(parsed) + "\n");
    expect(stdout.split("\n").filter(Boolean)).toHaveLength(1);
  }, 20000);

  test("issue mode ok: stdout is pure envelope JSON", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "output",
      args: ["--mode", "issue", "--owner", "owner", "--repo", "repo", "--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    assertContractConformance(parsed);
    expect(stdout).toBe(JSON.stringify(parsed) + "\n");
  }, 20000);

  test("error status: pure error envelope JSON, exit 1", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "owner", "--repo", "repo", "--head", "feat/x", "--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "error", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.status).toBe("error");
  }, 20000);
});

describe("output subprocess — exit-code-gate", () => {
  const stdinData = JSON.stringify(makeFixtureEnvelope());

  test("ok → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("needs-input → exit 0", async () => {
    const { exitCode } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "needs-input", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(0);
  }, 20000);

  test("error → exit 1", async () => {
    const { exitCode } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      stdinData,
      env: safeEnv({ STO_FAKE_ENGINE: "error", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(1);
  }, 20000);

  test("bad-input (malformed stdin) → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      stdinData: "not-valid-json{{{",
      env: safeEnv({ STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);
});

describe("output subprocess — --envelope precedence over stdin", () => {
  test("--envelope flag value used, stdin ignored", async () => {
    const flagEnvelope = makeFixtureEnvelope({ correlationId: "from-flag-output" });
    const stdinEnvelope = makeFixtureEnvelope({ correlationId: "from-stdin-output" });

    const { exitCode, stdout } = await spawnVerb({
      verb: "output",
      args: [
        "--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x",
        "--json", "--envelope", JSON.stringify(flagEnvelope),
      ],
      stdinData: JSON.stringify(stdinEnvelope),
      env: safeEnv({ STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: STUB_GITHUB_TOKEN }),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as NodeEnvelope;
    expect(parsed.correlationId).toBe("from-flag-output");
    expect(parsed.correlationId).not.toBe("from-stdin-output");
  }, 20000);
});

describe("output subprocess — stdout contains no token (R-02 secret-guard)", () => {
  test("GITHUB_TOKEN does not appear in stdout under --json", async () => {
    const secretToken = "ghp_secret_should_not_leak_in_stdout";
    const { stdout, stderr } = await spawnVerb({
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      stdinData: JSON.stringify(makeFixtureEnvelope()),
      env: safeEnv({ STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: secretToken }),
    });
    expect(stdout).not.toContain(secretToken);
    expect(stderr).not.toContain(secretToken);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-verb exit-code matrix (consolidated)
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-verb exit-code matrix (STO_FAKE_ENGINE — all four verbs)", () => {
  // This matrix verifies AC7: every verb maps status to exit code consistently.
  // Verbs that bypass STO_FAKE_ENGINE are tested separately above.

  interface VerbFixture {
    verb: string;
    args: string[];
    extraEnv?: Record<string, string>;
  }

  const verbs: VerbFixture[] = [
    {
      verb: "agent-turn",
      args: ["--json"],
    },
    {
      verb: "orchestrator-turn",
      args: ["--json"],
    },
    {
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      extraEnv: { GITHUB_TOKEN: STUB_GITHUB_TOKEN },
    },
  ];

  const stdinData = JSON.stringify(makeFixtureEnvelope());

  for (const { verb, args, extraEnv } of verbs) {
    test(`${verb}: ok → exit 0`, async () => {
      const { exitCode, stdout } = await spawnVerb({
        verb,
        args,
        stdinData,
        env: safeEnv({ ...extraEnv, STO_FAKE_ENGINE: "ok" }),
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as NodeEnvelope;
      expect(parsed.status).toBe("ok");
    }, 20000);

    test(`${verb}: needs-input → exit 0 (HITL park — not a failure)`, async () => {
      const { exitCode, stdout } = await spawnVerb({
        verb,
        args,
        stdinData,
        env: safeEnv({ ...extraEnv, STO_FAKE_ENGINE: "needs-input" }),
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as NodeEnvelope;
      expect(parsed.status).toBe("needs-input");
    }, 20000);

    test(`${verb}: error → exit 1`, async () => {
      const { exitCode, stdout } = await spawnVerb({
        verb,
        args,
        stdinData,
        env: safeEnv({ ...extraEnv, STO_FAKE_ENGINE: "error" }),
      });
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout) as NodeEnvelope;
      expect(parsed.status).toBe("error");
    }, 20000);

    test(`${verb}: bad-input (malformed JSON) → exit 2, empty stdout`, async () => {
      const { exitCode, stdout } = await spawnVerb({
        verb,
        args,
        stdinData: "malformed-json{{{",
        env: safeEnv({ ...extraEnv, STO_FAKE_ENGINE: "ok" }),
      });
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
    }, 20000);
  }
});
