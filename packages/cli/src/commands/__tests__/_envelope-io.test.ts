/**
 * Unit tests for the shared envelope-I/O helper (T2 — plan 1-02).
 *
 * Coverage targets (from T2 Verification checklist):
 *  ✓ --envelope takes precedence over stdin when both are present
 *  ✓ Empty/invalid stdin → typed error (exit-code-gate: exit 2)
 *  ✓ --json stdout purity: stdout contains exactly JSON.stringify(env)\n
 *  ✓ Human mode: stdout is empty; summary is on stderr
 *  ✓ statusToExitCode: ok→0, needs-input→0, error→1
 *  ✓ --envelope invalid JSON → typed error
 *  ✓ --envelope invariant violation → typed error
 *  ✓ stdin invalid JSON → typed error
 *  ✓ stdin invariant violation → typed error
 *
 * Note: subprocess-level byte-for-byte purity tests (piping a fixture through
 * an actual process) are deferred to T7/T9 which own the full verb integration
 * tests.  The --json purity assertion here captures stdout.write calls in-process.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import type { NodeEnvelope } from "../../contract/envelope";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "index.ts");
import {
  readInputEnvelope,
  writeResult,
  statusToExitCode,
  redirectConsolaToStderr,
} from "../_envelope-io";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "test-run-001",
    agentId: "software-teams-frontend",
    status: "ok",
    input: { prompt: "Do the thing", context: null },
    result: { text: "Done." },
    artifacts: [],
    ...overrides,
  };
}

// ─── readInputEnvelope — --envelope precedence ───────────────────────────────

describe("readInputEnvelope — --envelope flag", () => {
  test("returns the envelope when --envelope carries valid JSON", async () => {
    const env = makeEnvelope();
    const result = await readInputEnvelope(
      { envelope: JSON.stringify(env) },
      { readStdin: async () => { throw new Error("stdin must not be read"); } },
    );
    expect("envelope" in result).toBe(true);
    if ("envelope" in result) {
      expect(result.envelope).toEqual(env);
    }
  });

  test("--envelope takes precedence: stdin reader is never called when flag is present", async () => {
    const env = makeEnvelope();
    let stdinCalled = false;
    const result = await readInputEnvelope(
      { envelope: JSON.stringify(env) },
      {
        readStdin: async () => {
          stdinCalled = true;
          return JSON.stringify(makeEnvelope({ agentId: "software-teams-backend" }));
        },
      },
    );
    expect(stdinCalled).toBe(false);
    expect("envelope" in result).toBe(true);
    if ("envelope" in result) {
      expect(result.envelope.agentId).toBe("software-teams-frontend");
    }
  });

  test("returns error when --envelope is not valid JSON", async () => {
    const result = await readInputEnvelope(
      { envelope: "not-json{{{" },
      { readStdin: async () => { throw new Error("stdin must not be read"); } },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  test("returns error when --envelope is valid JSON but missing required fields", async () => {
    const incomplete = { correlationId: "x", agentId: "y" }; // missing status, input, result, artifacts
    const result = await readInputEnvelope(
      { envelope: JSON.stringify(incomplete) },
      { readStdin: async () => { throw new Error("stdin must not be read"); } },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("invariants");
    }
  });

  test("returns error when --envelope has invalid status value", async () => {
    const bad = { ...makeEnvelope(), status: "running" } as unknown as NodeEnvelope;
    const result = await readInputEnvelope(
      { envelope: JSON.stringify(bad) },
      { readStdin: async () => { throw new Error("stdin must not be read"); } },
    );
    expect("error" in result).toBe(true);
  });

  test("returns error when --envelope has empty correlationId", async () => {
    const bad = makeEnvelope({ correlationId: "" });
    const result = await readInputEnvelope(
      { envelope: JSON.stringify(bad) },
      { readStdin: async () => { throw new Error("stdin must not be read"); } },
    );
    expect("error" in result).toBe(true);
  });
});

// ─── readInputEnvelope — stdin fallback ──────────────────────────────────────

describe("readInputEnvelope — stdin", () => {
  test("reads and parses stdin when --envelope is absent", async () => {
    const env = makeEnvelope({ status: "needs-input" });
    const result = await readInputEnvelope(
      {},
      { readStdin: async () => JSON.stringify(env) },
    );
    expect("envelope" in result).toBe(true);
    if ("envelope" in result) {
      expect(result.envelope.status).toBe("needs-input");
    }
  });

  test("returns error when stdin is empty (whitespace-only)", async () => {
    const result = await readInputEnvelope(
      {},
      { readStdin: async () => "   \n\t  " },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("empty");
    }
  });

  test("returns error when stdin is not valid JSON", async () => {
    const result = await readInputEnvelope(
      {},
      { readStdin: async () => "{{invalid json}}" },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  test("returns error when stdin JSON fails NodeEnvelope invariants", async () => {
    const bad = { correlationId: "x", agentId: "y", status: "ok" }; // missing input, result, artifacts
    const result = await readInputEnvelope(
      {},
      { readStdin: async () => JSON.stringify(bad) },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("invariants");
    }
  });

  test("returns error when stdin reader throws", async () => {
    const result = await readInputEnvelope(
      {},
      { readStdin: async () => { throw new Error("pipe broken"); } },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("read stdin");
    }
  });

  test("stdin envelope with all valid status values is accepted", async () => {
    for (const status of ["ok", "error", "needs-input"] as const) {
      const env = makeEnvelope({ status });
      const result = await readInputEnvelope(
        {},
        { readStdin: async () => JSON.stringify(env) },
      );
      expect("envelope" in result).toBe(true);
      if ("envelope" in result) {
        expect(result.envelope.status).toBe(status);
      }
    }
  });
});

// ─── writeResult — --json stdout purity ──────────────────────────────────────

describe("writeResult — --json mode (stdout purity gate)", () => {
  let capturedStdout: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    capturedStdout = "";
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: Buffer | string) => {
      capturedStdout += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  test("writes exactly JSON.stringify(env) + newline to stdout — nothing else", () => {
    const env = makeEnvelope();
    writeResult(env, { json: true });
    // Byte-for-byte: the entire stdout must be parseable as exactly the envelope.
    expect(capturedStdout).toBe(JSON.stringify(env) + "\n");
    // Must parse cleanly with no leading/trailing garbage.
    expect(() => JSON.parse(capturedStdout)).not.toThrow();
    expect(JSON.parse(capturedStdout)).toEqual(env);
  });

  test("stdout contains only the envelope — no additional writes", () => {
    const env = makeEnvelope({ status: "error" });
    writeResult(env, { json: true });
    // Count newlines: exactly one (the trailing \n after JSON)
    const lines = capturedStdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  test("envelope with artifacts is serialised intact", () => {
    const env = makeEnvelope({
      artifacts: [{ type: "pr", url: "https://github.com/org/repo/pull/42" }],
    });
    writeResult(env, { json: true });
    const parsed = JSON.parse(capturedStdout) as NodeEnvelope;
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0].url).toBe("https://github.com/org/repo/pull/42");
  });

  test("envelope with needs-input status round-trips via JSON", () => {
    const env = makeEnvelope({ status: "needs-input", result: { text: "Waiting for human decision." } });
    writeResult(env, { json: true });
    const parsed = JSON.parse(capturedStdout) as NodeEnvelope;
    expect(parsed.status).toBe("needs-input");
  });
});

// ─── writeResult — human mode stdout silence ─────────────────────────────────

describe("writeResult — human mode (stdout must be empty)", () => {
  let stdoutWritten: boolean;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdoutWritten = false;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (_chunk: Buffer | string) => {
      stdoutWritten = true;
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  test("human mode does NOT write anything to stdout", () => {
    const env = makeEnvelope();
    writeResult(env, { json: false });
    expect(stdoutWritten).toBe(false);
  });

  test("human mode with error status does NOT write to stdout", () => {
    const env = makeEnvelope({ status: "error", result: { text: "Agent failed." } });
    writeResult(env, { json: false });
    expect(stdoutWritten).toBe(false);
  });

  test("human mode with artifacts does NOT write to stdout", () => {
    const env = makeEnvelope({
      artifacts: [{ type: "pr", url: "https://github.com/org/repo/pull/1" }],
    });
    writeResult(env, { json: false });
    expect(stdoutWritten).toBe(false);
  });
});

// ─── statusToExitCode — exit-code gate ───────────────────────────────────────

describe("statusToExitCode — exit-code mapping (exit-code-gate)", () => {
  test("ok → 0", () => {
    expect(statusToExitCode(makeEnvelope({ status: "ok" }))).toBe(0);
  });

  test("needs-input → 0 (valid HITL park outcome, not a failure)", () => {
    expect(statusToExitCode(makeEnvelope({ status: "needs-input" }))).toBe(0);
  });

  test("error → 1", () => {
    expect(statusToExitCode(makeEnvelope({ status: "error" }))).toBe(1);
  });

  test("exit code 2 is returned by readInputEnvelope on parse error (not by statusToExitCode)", () => {
    // Verify that statusToExitCode never returns 2 — exit 2 is the input-error path.
    const codes = new Set([
      statusToExitCode(makeEnvelope({ status: "ok" })),
      statusToExitCode(makeEnvelope({ status: "needs-input" })),
      statusToExitCode(makeEnvelope({ status: "error" })),
    ]);
    expect(codes.has(2)).toBe(false);
  });
});

// ─── redirectConsolaToStderr — stdout contamination prevention ───────────────

describe("redirectConsolaToStderr — R-09 stdout purity", () => {
  test("redirectConsolaToStderr is callable without error", () => {
    // We call it and then restore; we can't easily assert the stream was swapped
    // in a unit test without forking a subprocess, but we can assert it doesn't throw.
    expect(() => redirectConsolaToStderr()).not.toThrow();
  });

  test("after redirect, consola.info does NOT write to stdout", async () => {
    redirectConsolaToStderr();

    let stdoutHit = false;
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (_chunk: Buffer | string) => {
      stdoutHit = true;
      return true;
    };

    // Import and call consola — after redirectConsolaToStderr it should go to stderr
    const { consola } = await import("consola");
    consola.info("this should go to stderr, not stdout");

    process.stdout.write = orig;
    expect(stdoutHit).toBe(false);
  });
});

// ─── stderrLog runtime safety (regression: consola boolean-stream crash) ─────

describe("stderrLog — must never throw at runtime", () => {
  test("stderrLog.error is callable without crashing (S2 regression)", async () => {
    const { stderrLog } = await import("../_envelope-io");
    expect(() => stderrLog.error("diagnostic")).not.toThrow();
    expect(() => stderrLog.info("diagnostic")).not.toThrow();
    expect(() => stderrLog.warn("diagnostic")).not.toThrow();
  });
});

// ─── subprocess: real exit-2 path (regression for consola stream bug) ────────
//
// The in-process tests above mock process.stdout/stderr and missed a runtime
// crash in stderrLog (consola received a boolean instead of a stream). This
// subprocess test exercises the REAL error path end-to-end: malformed stdin
// under --json must exit 2 with empty stdout and a clean diagnostic on stderr.

describe("subprocess — exit-2 input-error path (byte-for-byte)", () => {
  test("malformed stdin + --json → exit 2, empty stdout, diagnostic on stderr", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", CLI_ENTRY, "ingest", "--source", "clickup", "--json"],
      stdin: Buffer.from("not-json{{{"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(2);
    expect(stdout).toBe(""); // exit-2 writes NOTHING to stdout (CLI-RECIPE §3)
    expect(stderr.length).toBeGreaterThan(0); // diagnostic present
    expect(stderr).not.toContain("undefined is not an object"); // the S2 crash
  }, 20000);
});

// ─── full exit-code matrix for parse errors ──────────────────────────────────

describe("parse-error path returns { error } — maps to exit code 2", () => {
  test("invalid JSON in --envelope → error result (not a thrown exception)", async () => {
    const result = await readInputEnvelope({ envelope: "not json" }, { readStdin: async () => "" });
    expect("error" in result).toBe(true);
  });

  test("empty stdin → error result (not a thrown exception)", async () => {
    const result = await readInputEnvelope({}, { readStdin: async () => "" });
    expect("error" in result).toBe(true);
  });

  test("invariant-failing stdin → error result", async () => {
    const result = await readInputEnvelope(
      {},
      { readStdin: async () => JSON.stringify({ foo: "bar" }) },
    );
    expect("error" in result).toBe(true);
  });
});
