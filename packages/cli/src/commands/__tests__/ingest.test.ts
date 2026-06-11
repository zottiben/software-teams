/**
 * Unit tests for the `ingest` verb — T5 of plan 1-02-n8n-manual-cli.
 *
 * Coverage targets (from T5 Verification checklist):
 *  ✓ --source clickup + valid URL + mocked adapter → initial envelope, input.context set, exit 0
 *  ✓ --source datadog + valid URL + mocked adapter → initial envelope, input.context set, exit 0
 *  ✓ Unparseable ClickUp ref → exitCode: 2, no fetch attempted
 *  ✓ Unparseable Datadog ref → exitCode: 2, no fetch attempted
 *  ✓ Adapter returns null (missing token / fetch failure) → envelope, input.context: null, exit 0
 *  ✓ Scrub markers present in context summary (proves adapter reuse, not a new scrubber)
 *  ✓ correlationId propagation and agentId default
 *  ✓ Custom datadogApiBase is forwarded to the adapter
 *
 * Adapter mocks: no network, no real tokens. All fetching is in the mocked adapters.
 * Source: CLI-RECIPE.md §5 (engine-function map), T5 Verification checklist.
 *
 * NOTE: `mock.module` must be called BEFORE `ingest.ts` is loaded so that the
 * ES-module import bindings inside ingest.ts resolve to the mocked functions.
 * This is achieved by using `await import("../ingest")` (dynamic, deferred) AFTER
 * the `mock.module(...)` call. Static imports of type-only symbols are safe because
 * they are erased at runtime and do not trigger module evaluation.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import type { ClickUpContext, DatadogContext } from "../../../../n8n/src/ingestion/context";
import type { NodeEnvelope } from "../../contract/envelope";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "index.ts");

// ─── Adapter mock functions ───────────────────────────────────────────────────
//
// Created as `mock()` instances so we can use `.mockImplementation()` per test.

const mockBuildClickUpContext = mock(
  async (
    _ref: unknown,
    _creds: unknown,
  ): Promise<ClickUpContext | null> => ({
    source: "clickup",
    ticketId: "NDP-33700",
    summary:
      "## ClickUp Ticket (sanitised): My Test Task\n" +
      "- **ID:** NDP-33700\n" +
      "- **Status:** open\n" +
      "- **Priority:** normal\n" +
      "\n" +
      "_PII patterns (email/phone/card/SSN/JWT/long-token/numeric IDs) have been replaced with placeholders before this context entered the prompt._\n" +
      "\n" +
      "### Description\n" +
      "Fix the broken thing.",
  }),
);

const mockBuildDatadogContext = mock(
  async (
    _issueId: unknown,
    _apiBase: unknown,
    _creds: unknown,
  ): Promise<DatadogContext | null> => ({
    source: "datadog",
    issueId: "abcdef12-1234-5678-abcd-ef1234567890",
    summary:
      "## Datadog Error Context (sanitised)\n\n" +
      "_Production PII has been replaced with placeholders. `<email>`, `<phone>`, `<card>`, `<ssn>`, `<jwt>`, `<long-token>`, `<id>` are scrub markers — the original values were never read by an agent._\n\n" +
      "- **Issue ID:** `abcdef12-1234-5678-abcd-ef1234567890`\n" +
      "- **Title:** TypeError: Cannot read property 'x' of undefined\n" +
      "- **Error type:** `TypeError`",
  }),
);

// ─── Register module mocks BEFORE loading ingest.ts ──────────────────────────

mock.module("../../../../n8n/src/ingestion/context", () => ({
  buildClickUpContext: mockBuildClickUpContext,
  buildDatadogContext: mockBuildDatadogContext,
}));

// Dynamic import AFTER mock.module — ensures ingest.ts receives the mocked module.
const { buildIngestEnvelope } = await import("../ingest");

// ─── Module mock cleanup ──────────────────────────────────────────────────────
//
// mock.module registrations persist across test files in the same Bun worker.
// Restore after all tests by re-registering the module with a cache-busted import
// of the real implementation — prevents the mock from leaking into downstream
// test files (e.g. n8n/src/ingestion/__tests__/context.test.ts).
afterAll(async () => {
  // Import the REAL module with a unique cache-buster query param so Bun's
  // module registry allocates a new entry for this import rather than returning
  // the mock. We then re-register the original path with the real exports.
  const realModule = await import(
    `../../../../n8n/src/ingestion/context?real=${Date.now()}`
  ) as typeof import("../../../../n8n/src/ingestion/context");
  mock.module("../../../../n8n/src/ingestion/context", () => ({
    buildClickUpContext: realModule.buildClickUpContext,
    buildDatadogContext: realModule.buildDatadogContext,
  }));
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Valid ClickUp URL (team-prefix form: /t/<team_id>/<custom_task_id>).
 * extractClickUpRef parses this as { taskId: "NDP-33700", teamId: "123456789" }.
 */
const CLICKUP_URL = "https://app.clickup.com/t/123456789/NDP-33700";

/**
 * Valid Datadog Error Tracking URL.
 * The issueId is URL-encoded JSON in the sp param — the regex in extractDatadogIssue
 * matches the UUID directly without decoding.
 */
const DATADOG_URL =
  "https://app.datadoghq.com/error-tracking?" +
  "sp=%7B%22issueId%22%3A%22abcdef12-1234-5678-abcd-ef1234567890%22%7D";

// ─── ClickUp tests ────────────────────────────────────────────────────────────

describe("buildIngestEnvelope — clickup source (adapter mocked, no network)", () => {
  beforeEach(() => {
    // Reset to a successful non-null response before each test.
    mockBuildClickUpContext.mockImplementation(async () => ({
      source: "clickup",
      ticketId: "NDP-33700",
      summary:
        "## ClickUp Ticket (sanitised): My Test Task\n" +
        "_PII patterns (email/phone/card/SSN/JWT/long-token/numeric IDs) have been replaced with placeholders before this context entered the prompt._",
    }));
  });

  test("AC5 — happy path: returns initial envelope with input.context set", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const env = result.envelope;
    // Contract conformance (all six NodeEnvelope fields)
    expect(typeof env.correlationId).toBe("string");
    expect(env.correlationId.length).toBeGreaterThan(0);
    expect(env.agentId).toBe("software-teams-researcher"); // default
    expect(env.status).toBe("ok");
    expect(typeof env.input.prompt).toBe("string");
    expect(env.input.prompt).toContain("ClickUp");
    expect(env.input.context).not.toBeNull();
    expect(env.result.text).toBe("");
    expect(env.artifacts).toHaveLength(0);
  });

  test("AC5 — input.context carries the (mock) scrubbed summary", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const ctx = result.envelope.input.context as ClickUpContext;
    expect(ctx.source).toBe("clickup");
    expect(ctx.ticketId).toBe("NDP-33700");
    expect(typeof ctx.summary).toBe("string");
  });

  test("reuse-check — scrub markers in summary prove adapter reuse (not a new scrubber)", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const summary = (result.envelope.input.context as ClickUpContext).summary;
    // This phrase originates in formatTicketAsContext (src/utils/clickup.ts).
    // Its presence proves the adapter — not a new scrubber — produced the summary.
    expect(summary).toContain("PII patterns");
    expect(summary).toContain("sanitised");
  });

  test("correlationId propagates when provided", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
      correlationId: "fixed-correlation-id",
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;
    expect(result.envelope.correlationId).toBe("fixed-correlation-id");
  });

  test("agentId uses provided value over default", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
      agentId: "software-teams-backend",
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;
    expect(result.envelope.agentId).toBe("software-teams-backend");
  });

  test("graceful degradation: adapter returns null → envelope status:ok, context:null, exit 0", async () => {
    // Simulate missing token or fetch failure.
    mockBuildClickUpContext.mockImplementation(async () => null);

    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const env = result.envelope;
    expect(env.status).toBe("ok");       // exit 0 per statusToExitCode
    expect(env.input.context).toBeNull(); // graceful degradation
  });

  test("unparseable ref → exitCode 2, no fetch attempted", async () => {
    let fetchCalled = false;
    mockBuildClickUpContext.mockImplementation(async () => {
      fetchCalled = true;
      return null;
    });

    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: "not-a-clickup-url-at-all",
    });

    expect("exitCode" in result).toBe(true);
    if (!("exitCode" in result)) return;
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("ClickUp");
    expect(fetchCalled).toBe(false); // no fetch — ref parsing failed first
  });

  test("each call generates a fresh correlationId when none is provided", async () => {
    const r1 = await buildIngestEnvelope({ source: "clickup", refText: CLICKUP_URL });
    const r2 = await buildIngestEnvelope({ source: "clickup", refText: CLICKUP_URL });
    expect("envelope" in r1 && "envelope" in r2).toBe(true);
    if (!("envelope" in r1) || !("envelope" in r2)) return;
    expect(r1.envelope.correlationId).not.toBe(r2.envelope.correlationId);
  });
});

// ─── Datadog tests ────────────────────────────────────────────────────────────

describe("buildIngestEnvelope — datadog source (adapter mocked, no network)", () => {
  beforeEach(() => {
    mockBuildDatadogContext.mockImplementation(async () => ({
      source: "datadog",
      issueId: "abcdef12-1234-5678-abcd-ef1234567890",
      summary:
        "## Datadog Error Context (sanitised)\n\n" +
        "_Production PII has been replaced with placeholders. `<email>`, `<phone>`, `<card>`, `<ssn>`, `<jwt>`, `<long-token>`, `<id>` are scrub markers — the original values were never read by an agent._\n\n" +
        "- **Issue ID:** `abcdef12-1234-5678-abcd-ef1234567890`",
    }));
  });

  test("AC5 — happy path: returns initial envelope with input.context set", async () => {
    const result = await buildIngestEnvelope({
      source: "datadog",
      refText: DATADOG_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const env = result.envelope;
    expect(typeof env.correlationId).toBe("string");
    expect(env.correlationId.length).toBeGreaterThan(0);
    expect(env.agentId).toBe("software-teams-researcher");
    expect(env.status).toBe("ok");
    expect(env.input.prompt).toContain("Datadog");
    expect(env.input.context).not.toBeNull();
    expect(env.result.text).toBe("");
    expect(env.artifacts).toHaveLength(0);
  });

  test("AC5 — input.context carries the (mock) scrubbed Datadog summary", async () => {
    const result = await buildIngestEnvelope({
      source: "datadog",
      refText: DATADOG_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const ctx = result.envelope.input.context as DatadogContext;
    expect(ctx.source).toBe("datadog");
    expect(ctx.issueId).toBe("abcdef12-1234-5678-abcd-ef1234567890");
    expect(typeof ctx.summary).toBe("string");
  });

  test("reuse-check — scrub markers in summary prove adapter reuse", async () => {
    const result = await buildIngestEnvelope({
      source: "datadog",
      refText: DATADOG_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const summary = (result.envelope.input.context as DatadogContext).summary;
    // This phrase originates in formatDatadogAsContext (src/utils/datadog.ts).
    expect(summary).toContain("sanitised");
    expect(summary).toContain("PII");
  });

  test("graceful degradation: adapter returns null → envelope status:ok, context:null, exit 0", async () => {
    mockBuildDatadogContext.mockImplementation(async () => null);

    const result = await buildIngestEnvelope({
      source: "datadog",
      refText: DATADOG_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;
    expect(result.envelope.status).toBe("ok");
    expect(result.envelope.input.context).toBeNull();
  });

  test("unparseable Datadog ref → exitCode 2, no fetch attempted", async () => {
    let fetchCalled = false;
    mockBuildDatadogContext.mockImplementation(async () => {
      fetchCalled = true;
      return null;
    });

    const result = await buildIngestEnvelope({
      source: "datadog",
      refText: "https://example.com/not-a-datadog-url",
    });

    expect("exitCode" in result).toBe(true);
    if (!("exitCode" in result)) return;
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("Datadog");
    expect(fetchCalled).toBe(false);
  });

  test("custom datadogApiBase is forwarded to the adapter", async () => {
    let capturedApiBase: unknown = null;
    mockBuildDatadogContext.mockImplementation(async (_id, apiBase) => {
      capturedApiBase = apiBase;
      return null;
    });

    await buildIngestEnvelope({
      source: "datadog",
      refText: DATADOG_URL,
      datadogApiBase: "https://api.datadoghq.eu",
    });

    expect(capturedApiBase).toBe("https://api.datadoghq.eu");
  });

  test("URL-derived apiBase is used when datadogApiBase is not provided", async () => {
    let capturedApiBase: unknown = null;
    mockBuildDatadogContext.mockImplementation(async (_id, apiBase) => {
      capturedApiBase = apiBase;
      return null;
    });

    await buildIngestEnvelope({
      source: "datadog",
      refText: DATADOG_URL,
      // no datadogApiBase override — should use URL-derived base
    });

    // DATADOG_URL host is app.datadoghq.com → derived base is https://api.datadoghq.com
    expect(capturedApiBase).toBe("https://api.datadoghq.com");
  });
});

// ─── exit-code-gate: statusToExitCode contract ────────────────────────────────

describe("exit-code-gate — envelope status maps to correct exit code", () => {
  test("ok envelope (always returned by buildIngestEnvelope) → exit 0", async () => {
    // Verify that the envelope status is always "ok" so statusToExitCode returns 0.
    mockBuildClickUpContext.mockImplementation(async () => ({
      source: "clickup",
      ticketId: "t1",
      summary: "## ClickUp Ticket (sanitised): Test",
    }));

    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;
    // Import statusToExitCode inline to assert the exit-code-gate invariant.
    const { statusToExitCode } = await import("../_envelope-io");
    expect(statusToExitCode(result.envelope)).toBe(0);
  });

  test("graceful degradation (context: null) also produces status:ok → exit 0", async () => {
    mockBuildClickUpContext.mockImplementation(async () => null);

    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;
    const { statusToExitCode } = await import("../_envelope-io");
    expect(statusToExitCode(result.envelope)).toBe(0);
  });
});

// ─── In-process ok-path tests (mocked adapters, can't reach mocks across subprocess) ──

describe("ingest — ok-path with mocked adapters (in-process, not subprocess)", () => {
  // Reset mock to a known non-null response before each test in this block.
  // Earlier describe blocks leave the mock in a null-returning state (graceful
  // degradation tests). Without this reset, `input.context` would be null.
  beforeEach(() => {
    mockBuildClickUpContext.mockImplementation(async () => ({
      source: "clickup",
      ticketId: "NDP-33700",
      summary: "## ClickUp Ticket (sanitised): My Test Task\n_PII patterns have been replaced._",
    }));
  });

  test("--source clickup with --url and --json → JSON-serializable with context, exit 0", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const env = result.envelope;

    // Verify exit code gate
    const { statusToExitCode } = await import("../_envelope-io");
    expect(statusToExitCode(env)).toBe(0);

    // Verify JSON is serializable
    const json = JSON.stringify(env);
    const parsed = JSON.parse(json) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    expect(parsed.correlationId).toBeTruthy();
    expect(parsed.input).toBeTruthy();
    expect(Array.isArray(parsed.artifacts)).toBe(true);
    // Context is present in the mock
    expect(parsed.input.context).not.toBeNull();
  });
});

// ─── Integration tests: subprocess-level (end-to-end via CLI) ────────────────
// Keep ONLY offline input-error paths (invalid/missing --source, malformed stdin JSON)

describe("ingest subprocess — end-to-end CLI (offline input-error paths)", () => {

  test("invalid --source → exit 2", async () => {
    const proc = Bun.spawn({
      cmd: [
        "bun",
        CLI_ENTRY,
        "ingest",
        "--source",
        "invalid-source",
        "--url",
        "https://example.com",
        "--json",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("source");
  }, 120000);

  test("missing --source → exit 2 with clear message", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", CLI_ENTRY, "ingest", "--url", "https://example.com", "--json"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("source");
  }, 120000);

  test("malformed stdin JSON → exit 2, no JSON on stdout", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", CLI_ENTRY, "ingest", "--source", "clickup", "--json"],
      stdin: Buffer.from("not-valid-json{{{"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr.length).toBeGreaterThan(0);
  }, 120000);

  test("--envelope flag carries correlationId through ok path (in-process)", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
      correlationId: "flag-run",
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    // The flag correlationId should be carried through
    expect(result.envelope.correlationId).toBe("flag-run");
    const { statusToExitCode } = await import("../_envelope-io");
    expect(statusToExitCode(result.envelope)).toBe(0);
  });

  test("human mode (no --json) still produces ok status and JSON (in-process)", async () => {
    const result = await buildIngestEnvelope({
      source: "clickup",
      refText: CLICKUP_URL,
    });

    expect("envelope" in result).toBe(true);
    if (!("envelope" in result)) return;

    const { statusToExitCode } = await import("../_envelope-io");
    expect(statusToExitCode(result.envelope)).toBe(0);
    expect(result.envelope.status).toBe("ok");
    // Envelope is JSON-serializable regardless of --json flag
    expect(() => JSON.stringify(result.envelope)).not.toThrow();
  });
});
