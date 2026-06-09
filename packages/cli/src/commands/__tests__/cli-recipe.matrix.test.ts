/**
 * cli-recipe.matrix.test.ts — T9 regression gate
 *
 * Plan: 1-02-n8n-manual-cli · Task: T9 (software-teams-qa-tester)
 *
 * PURPOSE: Full cross-verb exit-code matrix + `--json` purity regression suite.
 *
 * Gates asserted here:
 *   json-purity-gate  (R-09 / AC2)  — stdout = exactly JSON.stringify(envelope)+"\n"; nothing else.
 *   exit-code-gate    (AC7)         — ok/needs-input→0; error→1; bad-input→2 for ALL FOUR verbs.
 *
 * This file EXTENDS integration.test.ts (T7) — it does not duplicate individual verb
 * deep tests already there. It adds:
 *   - ingest in the full cross-verb exit-code matrix (T7 omits ingest from the matrix;
 *     ingest uses ST_CLI_TEST_STUB, not STO_FAKE_ENGINE).
 *   - A single combined `--json` purity regression sweep across all four verbs.
 *   - Named regression-gate describe blocks so CI can filter on "matrix" or "purity-gate".
 *
 * Test seams (no claude binary, no network):
 *   STO_FAKE_ENGINE=ok|needs-input|error — runVerb fake-engine seam in _envelope-io.ts.
 *     Used for agent-turn, orchestrator-turn, output.
 *   ST_CLI_TEST_STUB=1 — the ingest adapter stub. Returns deterministic offline contexts;
 *     no network, no real token validation.
 *
 * All real tokens are stripped from spawned process env (see safeEnv).
 */

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import type { NodeEnvelope } from "../../contract/envelope";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "index.ts");

// ─── Helpers (private to this file — shared pattern with integration.test.ts) ─

function makeFixtureEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "matrix-regression-test-001",
    agentId: "software-teams-backend",
    status: "ok",
    input: { prompt: "Run the matrix regression", context: null },
    result: { text: "Ready." },
    artifacts: [],
    ...overrides,
  };
}

/**
 * Safe env for spawned processes: strips all real API tokens so no
 * accidental real-network calls can occur even if a seam is bypassed.
 */
function safeEnv(
  extra?: Record<string, string>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env["ANTHROPIC_API_KEY"];
  delete env["CLICKUP_API_KEY"];
  delete env["DATADOG_API_KEY"];
  delete env["DATADOG_APP_KEY"];
  delete env["GITHUB_TOKEN"];
  delete env["GH_TOKEN"];
  return { ...env, ...extra };
}

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

// ─── json-purity assertion ───────────────────────────────────────────────────

/**
 * Assert byte-for-byte json purity (R-09):
 *   stdout = JSON.stringify(envelope) + "\n" — nothing else.
 * Also asserts contract-conformance (all six NodeEnvelope fields).
 */
function assertJsonPurityAndConformance(stdout: string): NodeEnvelope {
  // Must parse without throwing.
  let parsed: NodeEnvelope;
  try {
    parsed = JSON.parse(stdout) as NodeEnvelope;
  } catch {
    throw new Error(`stdout is not valid JSON — purity gate failed. stdout: ${JSON.stringify(stdout)}`);
  }

  // Byte-for-byte purity: stdout = JSON.stringify(parsed) + "\n".
  expect(stdout).toBe(JSON.stringify(parsed) + "\n");

  // Exactly one non-empty line.
  const nonEmptyLines = stdout.split("\n").filter(Boolean);
  expect(nonEmptyLines).toHaveLength(1);

  // Contract conformance: all six fields.
  expect(typeof parsed.correlationId).toBe("string");
  expect(parsed.correlationId.length).toBeGreaterThan(0);
  expect(typeof parsed.agentId).toBe("string");
  expect(["ok", "error", "needs-input"]).toContain(parsed.status);
  expect(typeof parsed.input).toBe("object");
  expect(typeof parsed.input.prompt).toBe("string");
  expect(typeof parsed.result).toBe("object");
  expect(typeof parsed.result.text).toBe("string");
  expect(Array.isArray(parsed.artifacts)).toBe(true);

  return parsed;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STUB_GITHUB_TOKEN = "ghp_stubtoken_matrix_regression";

// Canonical ClickUp URL used for ingest stub tests.
const CLICKUP_URL = "https://app.clickup.com/t/123456789/NDP-33700";

// ─────────────────────────────────────────────────────────────────────────────
// json-purity-gate — all four verbs (R-09 / AC2 regression)
// ─────────────────────────────────────────────────────────────────────────────

describe("json-purity-gate regression — all four verbs (R-09 / AC2)", () => {
  /**
   * Each row: [verb, args, extraEnv, stdinData|undefined]
   * ingest uses ST_CLI_TEST_STUB; others use STO_FAKE_ENGINE.
   */
  const cases: Array<{
    label: string;
    verb: string;
    args: string[];
    extraEnv?: Record<string, string>;
    stdinData?: string;
  }> = [
    {
      label: "agent-turn ok",
      verb: "agent-turn",
      args: ["--json"],
      extraEnv: { STO_FAKE_ENGINE: "ok" },
      stdinData: JSON.stringify(makeFixtureEnvelope()),
    },
    {
      label: "agent-turn needs-input",
      verb: "agent-turn",
      args: ["--json"],
      extraEnv: { STO_FAKE_ENGINE: "needs-input" },
      stdinData: JSON.stringify(makeFixtureEnvelope()),
    },
    {
      label: "agent-turn error",
      verb: "agent-turn",
      args: ["--json"],
      extraEnv: { STO_FAKE_ENGINE: "error" },
      stdinData: JSON.stringify(makeFixtureEnvelope()),
    },
    {
      label: "orchestrator-turn ok",
      verb: "orchestrator-turn",
      args: ["--json"],
      extraEnv: { STO_FAKE_ENGINE: "ok" },
      stdinData: JSON.stringify(
        makeFixtureEnvelope({ input: { prompt: "Build the notification system", context: null } })
      ),
    },
    {
      label: "orchestrator-turn needs-input",
      verb: "orchestrator-turn",
      args: ["--json"],
      extraEnv: { STO_FAKE_ENGINE: "needs-input" },
      stdinData: JSON.stringify(
        makeFixtureEnvelope({ input: { prompt: "Build the notification system", context: null } })
      ),
    },
    {
      label: "orchestrator-turn error",
      verb: "orchestrator-turn",
      args: ["--json"],
      extraEnv: { STO_FAKE_ENGINE: "error" },
      stdinData: JSON.stringify(
        makeFixtureEnvelope({ input: { prompt: "Build the notification system", context: null } })
      ),
    },
    {
      label: "ingest clickup ok (ST_CLI_TEST_STUB)",
      verb: "ingest",
      args: ["--source", "clickup", "--url", CLICKUP_URL, "--json"],
      extraEnv: { ST_CLI_TEST_STUB: "1" },
      stdinData: undefined,
    },
    {
      label: "output pr ok",
      verb: "output",
      args: ["--mode", "pr", "--owner", "owner", "--repo", "repo", "--head", "feat/branch", "--json"],
      extraEnv: { STO_FAKE_ENGINE: "ok", GITHUB_TOKEN: STUB_GITHUB_TOKEN },
      stdinData: JSON.stringify(makeFixtureEnvelope()),
    },
    {
      label: "output pr needs-input",
      verb: "output",
      args: ["--mode", "pr", "--owner", "owner", "--repo", "repo", "--head", "feat/branch", "--json"],
      extraEnv: { STO_FAKE_ENGINE: "needs-input", GITHUB_TOKEN: STUB_GITHUB_TOKEN },
      stdinData: JSON.stringify(makeFixtureEnvelope()),
    },
    {
      label: "output pr error",
      verb: "output",
      args: ["--mode", "pr", "--owner", "owner", "--repo", "repo", "--head", "feat/branch", "--json"],
      extraEnv: { STO_FAKE_ENGINE: "error", GITHUB_TOKEN: STUB_GITHUB_TOKEN },
      stdinData: JSON.stringify(makeFixtureEnvelope()),
    },
  ];

  for (const { label, verb, args, extraEnv, stdinData } of cases) {
    test(`${label}: stdout is exactly JSON.stringify(envelope)+newline — nothing else`, async () => {
      const { exitCode, stdout } = await spawnVerb({
        verb,
        args,
        stdinData,
        env: safeEnv(extraEnv),
      });

      // Exit code must not be 2 (bad-input) — we should get an envelope.
      expect(exitCode).not.toBe(2);
      // Purity + conformance.
      const parsed = assertJsonPurityAndConformance(stdout);
      // Envelope must round-trip (no extra fields stripped by JSON.stringify).
      expect(JSON.parse(stdout)).toEqual(parsed);
    }, 20000);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// exit-code-gate — full cross-verb matrix, ALL FOUR verbs (AC7 regression)
// ─────────────────────────────────────────────────────────────────────────────

describe("exit-code-gate: full cross-verb matrix — all four verbs (AC7)", () => {
  /**
   * T7 integration.test.ts covers agent-turn, orchestrator-turn, output individually
   * and in a 3-verb loop. This matrix adds ingest and locks the full 4-verb AC7
   * guarantee as a named regression suite.
   *
   * ingest does not support STO_FAKE_ENGINE; its exit-code seams are:
   *   ok   → ST_CLI_TEST_STUB=1 + valid URL
   *   exit2 → invalid --source or unparseable URL (no seam needed)
   *
   * note: ingest has no server-side error seam analogous to STO_FAKE_ENGINE;
   * the graceful-degradation / no-token path returns ok (context:null).
   * The exit-1 / status:error case for ingest is not reachable without a
   * real (or net-accessible) adapter — it is not covered in the offline matrix.
   * This is documented as a known seam gap (see integration.test.ts note).
   */

  interface VerbCase {
    verb: string;
    args: string[];
    extraEnv?: Record<string, string>;
    stdinData?: string;
    supportsNeedsInput: boolean;
    supportsError: boolean;
  }

  const fixture = JSON.stringify(makeFixtureEnvelope());

  const verbCases: VerbCase[] = [
    {
      verb: "agent-turn",
      args: ["--json"],
      stdinData: fixture,
      supportsNeedsInput: true,
      supportsError: true,
    },
    {
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData: JSON.stringify(
        makeFixtureEnvelope({ input: { prompt: "Epic goal here", context: null } })
      ),
      supportsNeedsInput: true,
      supportsError: true,
    },
    {
      verb: "ingest",
      args: ["--source", "clickup", "--url", CLICKUP_URL, "--json"],
      extraEnv: { ST_CLI_TEST_STUB: "1" },
      stdinData: undefined,
      supportsNeedsInput: false, // ingest does not support needs-input via offline seam
      supportsError: false,       // no offline error seam for ingest adapter
    },
    {
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      extraEnv: { GITHUB_TOKEN: STUB_GITHUB_TOKEN },
      stdinData: fixture,
      supportsNeedsInput: true,
      supportsError: true,
    },
  ];

  for (const { verb, args, extraEnv, stdinData, supportsNeedsInput, supportsError } of verbCases) {
    // ok → exit 0
    test(`${verb}: ok → exit 0`, async () => {
      const env = verb === "ingest"
        ? safeEnv(extraEnv)
        : safeEnv({ ...extraEnv, STO_FAKE_ENGINE: "ok" });

      const { exitCode, stdout } = await spawnVerb({ verb, args, stdinData, env });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as NodeEnvelope;
      expect(parsed.status).toBe("ok");
    }, 20000);

    // needs-input → exit 0 (where the seam supports it)
    if (supportsNeedsInput) {
      test(`${verb}: needs-input → exit 0 (valid HITL park, not a failure — AC7)`, async () => {
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
    }

    // error → exit 1 (where the seam supports it)
    if (supportsError) {
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
    }

    // bad-input → exit 2, empty stdout (all verbs that accept an envelope on stdin)
    if (verb !== "ingest") {
      // ingest synthesises its own initial envelope from flags; bad-input for ingest
      // is an invalid --source or an unparseable URL ref (tested separately below).
      test(`${verb}: bad-input (malformed stdin) → exit 2, empty stdout`, async () => {
        const { exitCode, stdout } = await spawnVerb({
          verb,
          args,
          stdinData: "not-valid-json{{{",
          env: safeEnv({ ...extraEnv, STO_FAKE_ENGINE: "ok" }),
        });
        expect(exitCode).toBe(2);
        expect(stdout).toBe("");
      }, 20000);
    }
  }

  // ingest-specific exit-2 paths (invalid --source / unparseable URL).
  test("ingest: invalid --source → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "not-a-valid-source", "--url", "https://example.com", "--json"],
      env: safeEnv(),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);

  test("ingest: unparseable ClickUp URL → exit 2, empty stdout", async () => {
    const { exitCode, stdout } = await spawnVerb({
      verb: "ingest",
      args: ["--source", "clickup", "--url", "https://example.com/not-a-clickup-url", "--json"],
      env: safeEnv({ ST_CLI_TEST_STUB: "1" }),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// exit-2 stdout invariant — all verbs (AC7 / §3 exit-2 stdout rule)
// ─────────────────────────────────────────────────────────────────────────────

describe("exit-2 stdout invariant: no bytes written to stdout on bad-input (§3, AC7)", () => {
  /**
   * CLI-RECIPE §3: when input resolution fails (exit 2), the helper writes the
   * diagnostic to stderr and writes NOTHING to stdout, in both modes.
   * Consumers distinguish this case by exit code, never by parsing stdout.
   */

  const badInputCases: Array<{ label: string; verb: string; args: string[]; stdinData: string }> = [
    {
      label: "agent-turn: malformed stdin",
      verb: "agent-turn",
      args: ["--json"],
      stdinData: "}}not-json{{",
    },
    {
      label: "orchestrator-turn: malformed stdin",
      verb: "orchestrator-turn",
      args: ["--json"],
      stdinData: "}}not-json{{",
    },
    {
      label: "output: malformed stdin",
      verb: "output",
      args: ["--mode", "pr", "--owner", "o", "--repo", "r", "--head", "feat/x", "--json"],
      stdinData: "}}not-json{{",
    },
  ];

  for (const { label, verb, args, stdinData } of badInputCases) {
    test(`${label} → stdout is empty string (no bytes)`, async () => {
      const { exitCode, stdout } = await spawnVerb({
        verb,
        args,
        stdinData,
        env: safeEnv({ GITHUB_TOKEN: STUB_GITHUB_TOKEN, STO_FAKE_ENGINE: "ok" }),
      });
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
    }, 20000);
  }
});
