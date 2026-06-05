/**
 * ingest verb — T5 of plan 1-02-n8n-manual-cli
 *
 * Thin wrapper: validate source → resolve ref → extract ref (exit 2 if
 * unparseable) → call build*Context adapter with env-var tokens → build
 * initial NodeEnvelope (graceful degradation when adapter returns null) → emit.
 *
 * Normative sources:
 *   CLI-RECIPE.md §2 row 3 (argument synthesis — envelope is optional)
 *   CLI-RECIPE.md §3 (json-purity-gate spine, R-09)
 *   CLI-RECIPE.md §4 (exit-code-gate)
 *   CLI-RECIPE.md §5 verb→engine map
 *   ORCHESTRATION §Risks R-02 (tokens from env vars only — never CLI args)
 *
 * reuse-check: all fetching + PII scrubbing is in the imported adapters.
 * The verb only parses the ref, reads env tokens, and shapes the envelope.
 * No new scrubbing logic exists here.
 */
import { defineCommand } from "citty";
import { randomUUID } from "crypto";
import type { NodeEnvelope } from "../../n8n/src/contract/envelope";
import { extractClickUpRef } from "../utils/clickup";
import { extractDatadogIssue } from "../utils/datadog";
import { buildClickUpContext, buildDatadogContext } from "../../n8n/src/ingestion/context";
import type { ClickUpContext, DatadogContext } from "../../n8n/src/ingestion/context";
import {
  readInputEnvelope,
  writeResult,
  statusToExitCode,
  stderrLog,
  redirectConsolaToStderr,
} from "./_envelope-io";

const DEFAULT_AGENT = "software-teams-researcher";

// ─── Test stub support (env-gated, subprocess-level purity testing) ─────────
//
// When ST_CLI_TEST_STUB=1, ingest swaps the adapters for deterministic offline
// mocks. This allows subprocess tests to verify json-purity and exit-code gates
// without touching the network or real tokens. The stubs return fake contexts
// that parse successfully but have no secrets.
//
// Token validation logic is NOT bypassed — the subprocess tests for
// "missing CLICKUP_API_KEY" etc. still exercise the real token checks.
// Only the adapter call-side is stubbed away.
//
// Reuse pattern for T9 (cross-verb spawn matrix): initialize
// ingestAdapters(source) and pass to the engine, or call getIngestAdapters(source)
// directly in the command handler before engine invocation.

function getIngestAdapters(source: "clickup" | "datadog") {
  if (process.env.ST_CLI_TEST_STUB === "1") {
    // Offline stubs: no network, no real token validation side-effects.
    // Return deterministic fake contexts for json-purity and exit-code testing.
    if (source === "clickup") {
      return {
        buildContext: async (): Promise<ClickUpContext | null> => ({
          source: "clickup",
          ticketId: "TEST-123",
          summary: "## ClickUp Ticket (sanitised): Test Task\n_PII patterns have been replaced._",
        }),
      };
    } else {
      return {
        buildContext: async (): Promise<DatadogContext | null> => ({
          source: "datadog",
          issueId: "test-issue-uuid",
          summary: "## Datadog Error Context (sanitised)\n_PII has been replaced._",
        }),
      };
    }
  }
  // Real adapters (production, real network + token validation).
  return {
    buildContext:
      source === "clickup" ? buildClickUpContext : buildDatadogContext,
  };
}

// ─── Engine-level options (exported for unit testing) ────────────────────────

/** Resolved options for the engine-level ingest function. */
export interface IngestEngineOptions {
  source: "clickup" | "datadog";
  refText: string;
  agentId?: string;
  /** Override the Datadog regional API base URL (falls back to URL-derived value). */
  datadogApiBase?: string;
  /** Carry-through correlationId from an upstream envelope (defaults to a fresh UUID). */
  correlationId?: string;
}

// ─── Engine function (exported for unit testing — adapter injectable via mock) ─

/**
 * Engine-level ingest: parse ref → call adapter with env-var tokens → build
 * the initial NodeEnvelope.
 *
 * Exported separately from the citty command so unit tests can call it directly
 * with the adapters mocked (bun:test `mock.module`) — no subprocess, no network.
 *
 * Returns:
 *   `{ envelope }` — success path; status is always "ok" (graceful degradation
 *                    included: context: null when adapter returns null).
 *   `{ exitCode: 2; message: string }` — when the ref is unparseable (input
 *                    error). No fetch is attempted in this case.
 *
 * Never throws past this boundary.
 */
export async function buildIngestEnvelope(
  opts: IngestEngineOptions,
): Promise<{ envelope: NodeEnvelope } | { exitCode: 2; message: string }> {
  const {
    source,
    refText,
    agentId = DEFAULT_AGENT,
    datadogApiBase,
    correlationId = randomUUID(),
  } = opts;

  let context: ClickUpContext | DatadogContext | null = null;

  if (source === "clickup") {
    // Step 2 (decided behaviour): if extract* returns null → input error, exit 2.
    const ref = extractClickUpRef(refText);
    if (!ref) {
      return {
        exitCode: 2,
        message: `could not parse a ClickUp task URL/ID from: ${refText}`,
      };
    }

    // Step 3 (R-02): tokens from env vars only — never CLI args, never echoed.
    const creds = { clickupApiKey: process.env.CLICKUP_API_KEY ?? "" };

    // Step 4 (graceful degradation): adapter returns null for missing token or
    // fetch failure → proceed with context: null, exit 0, clear stderr note.
    const { buildContext } = getIngestAdapters("clickup");
    context = await buildContext(ref, creds);
    if (context === null) {
      stderrLog.info(
        "ClickUp context not available — CLICKUP_API_KEY may be missing or the fetch failed. " +
          "Proceeding with input.context: null",
      );
    }
  } else {
    // source === "datadog"
    const parsed = extractDatadogIssue(refText);
    if (!parsed) {
      return {
        exitCode: 2,
        message: `could not parse a Datadog Error Tracking issue URL from: ${refText}`,
      };
    }

    const apiBase = datadogApiBase ?? parsed.apiBase;

    // R-02: tokens from env vars only.
    const creds = {
      datadogApiKey: process.env.DATADOG_API_KEY ?? "",
      datadogAppKey: process.env.DATADOG_APP_KEY ?? "",
    };

    const { buildContext } = getIngestAdapters("datadog");
    context = await buildContext(parsed.issueId, apiBase, creds);
    if (context === null) {
      stderrLog.info(
        "Datadog context not available — DATADOG_API_KEY/DATADOG_APP_KEY may be missing or " +
          "the fetch failed. Proceeding with input.context: null",
      );
    }
  }

  // Step 5: build the initial NodeEnvelope.
  const prompt =
    source === "clickup"
      ? `Investigate and resolve ClickUp task: ${refText}`
      : `Investigate and resolve Datadog error: ${refText}`;

  const envelope: NodeEnvelope = {
    correlationId,
    agentId,
    status: "ok",
    input: { prompt, context },
    result: { text: "" },
    artifacts: [],
  };

  return { envelope };
}

// ─── citty command definition ─────────────────────────────────────────────────

export const ingestCommand = defineCommand({
  meta: {
    name: "ingest",
    description:
      "Fetch a ClickUp or Datadog ticket and emit an initial NodeEnvelope (--source required)",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Emit a single JSON NodeEnvelope on stdout (--json mode, R-09)",
    },
    envelope: {
      type: "string",
      description: "Inline input envelope (JSON); precedence over stdin",
    },
    source: {
      type: "string",
      description: "Ticket source: clickup | datadog (required)",
    },
    ref: {
      type: "string",
      description: "Ticket URL or ID",
    },
    url: {
      type: "string",
      description: "Ticket URL (alias for --ref)",
    },
    agent: {
      type: "string",
      default: DEFAULT_AGENT,
      description: "Agent ID for the first downstream node",
    },
    "datadog-api-base": {
      type: "string",
      description: "Datadog regional API base URL (overrides URL-derived base)",
    },
  },

  async run({ args }) {
    const json = args.json ?? false;

    // Guarantee stdout purity under --json (R-09).
    if (json) redirectConsolaToStderr();

    // ── 1. Validate --source (exit 2 if missing/invalid) ──────────────────────
    const source = args.source as string | undefined;
    if (!source || !["clickup", "datadog"].includes(source)) {
      stderrLog.error(
        `Input error: --source must be 'clickup' or 'datadog'${
          source ? ` (got: '${source}')` : " (missing)"
        }`,
      );
      process.exit(2);
    }

    // ── 2. Optionally read an input envelope (CLI-RECIPE.md §2 row 3) ─────────
    //
    // For `ingest`, absence of an input envelope is NOT an error — only parse or
    // invariant failures are (exit 2). Presence gives us a carry-through
    // correlationId and a fallback ref via `input.prompt`.
    let inputEnvelope: NodeEnvelope | undefined;

    if (args.envelope !== undefined) {
      // --envelope flag supplied — must parse or exit 2.
      const result = await readInputEnvelope({ envelope: args.envelope });
      if ("error" in result) {
        stderrLog.error(`Input error: ${result.error}`);
        process.exit(2);
      }
      inputEnvelope = result.envelope;
    } else if (!process.stdin.isTTY) {
      // Non-TTY stdin — attempt to read. Absence (empty content) is OK for
      // ingest; parse/invariant failure is exit 2.
      const result = await readInputEnvelope({});
      if ("error" in result) {
        if (result.error.startsWith("No input envelope:")) {
          // Empty stdin — fine for ingest (row 3 synthesis).
        } else {
          stderrLog.error(`Input error: ${result.error}`);
          process.exit(2);
        }
      } else {
        inputEnvelope = result.envelope;
      }
    }
    // else: stdin is a TTY and no --envelope — synthesize from flags (row 3).

    // ── 3. Resolve the reference text: --ref → --url → input.prompt ───────────
    const refText =
      (args.ref as string | undefined) ??
      (args.url as string | undefined) ??
      inputEnvelope?.input.prompt;

    if (!refText || refText.trim().length === 0) {
      stderrLog.error(
        "Input error: no ticket reference — supply --ref or --url, or pipe an envelope " +
          "with input.prompt set to the ticket URL",
      );
      process.exit(2);
    }

    // ── 4 + 5. Engine: extract ref → call adapter → build envelope ────────────
    const buildResult = await buildIngestEnvelope({
      source: source as "clickup" | "datadog",
      refText: refText.trim(),
      agentId: args.agent,
      datadogApiBase: args["datadog-api-base"] as string | undefined,
      correlationId: inputEnvelope?.correlationId,
    });

    if ("exitCode" in buildResult) {
      stderrLog.error(`Input error: ${buildResult.message}`);
      process.exit(buildResult.exitCode);
    }

    // ── Emit (CLI-RECIPE.md §3 + §4) ─────────────────────────────────────────
    writeResult(buildResult.envelope, { json });
    process.exit(statusToExitCode(buildResult.envelope));
  },
});
