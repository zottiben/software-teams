import { defineCommand } from "citty";
import { randomUUID } from "crypto";
import type { NodeEnvelope } from "../contract/envelope";
import { extractClickUpRef } from "../utils/clickup";
import { extractDatadogIssue } from "../utils/datadog";
import { buildClickUpContext, buildDatadogContext } from "../../../n8n/src/ingestion/context";
import type {
  ClickUpContext,
  DatadogContext,
  ClickUpContextCredentials,
  DatadogContextCredentials,
} from "../../../n8n/src/ingestion/context";
import type { ClickUpRef } from "../utils/clickup";
import {
  readInputEnvelope,
  writeResult,
  statusToExitCode,
  stderrLog,
  redirectConsolaToStderr,
} from "./_envelope-io";

const DEFAULT_AGENT = "software-teams-researcher";

interface ClickUpAdapters {
  buildContext: (ref: ClickUpRef, creds: ClickUpContextCredentials) => Promise<ClickUpContext | null>;
}
interface DatadogAdapters {
  buildContext: (issueId: string, apiBase: string, creds: DatadogContextCredentials) => Promise<DatadogContext | null>;
}

function getIngestAdapters(source: "clickup"): ClickUpAdapters;
function getIngestAdapters(source: "datadog"): DatadogAdapters;
function getIngestAdapters(source: "clickup" | "datadog"): ClickUpAdapters | DatadogAdapters {
  if (process.env.ST_CLI_TEST_STUB === "1") {
    if (source === "clickup") {
      const clickUpStub: ClickUpAdapters = {
        buildContext: async () => ({
          source: "clickup",
          ticketId: "TEST-123",
          summary: "## ClickUp Ticket (sanitised): Test Task\n_PII patterns have been replaced._",
        }),
      };
      return clickUpStub;
    } else {
      const datadogStub: DatadogAdapters = {
        buildContext: async () => ({
          source: "datadog",
          issueId: "test-issue-uuid",
          summary: "## Datadog Error Context (sanitised)\n_PII has been replaced._",
        }),
      };
      return datadogStub;
    }
  }
  if (source === "clickup") {
    return { buildContext: buildClickUpContext };
  }
  return { buildContext: buildDatadogContext };
}

export interface IngestEngineOptions {
  source: "clickup" | "datadog";
  refText: string;
  agentId?: string;
  /** Override the Datadog regional API base URL (falls back to URL-derived value). */
  datadogApiBase?: string;
  /** Carry-through correlationId from an upstream envelope (defaults to a fresh UUID). */
  correlationId?: string;
}

async function resolveIngestContext(
  source: "clickup" | "datadog",
  refText: string,
  datadogApiBase: string | undefined,
): Promise<{ context: ClickUpContext | DatadogContext | null } | { error: string }> {
  if (source === "clickup") {
    const ref = extractClickUpRef(refText);
    if (!ref) return { error: `could not parse a ClickUp task URL/ID from: ${refText}` };
    const creds = { clickupApiKey: process.env.CLICKUP_API_KEY ?? "" };
    const { buildContext } = getIngestAdapters("clickup");
    const ctx = await buildContext(ref, creds);
    if (ctx === null) stderrLog.info("ClickUp context not available — CLICKUP_API_KEY may be missing or the fetch failed. Proceeding with input.context: null");
    return { context: ctx };
  } else {
    const parsed = extractDatadogIssue(refText);
    if (!parsed) return { error: `could not parse a Datadog Error Tracking issue URL from: ${refText}` };
    const apiBase = datadogApiBase ?? parsed.apiBase;
    const creds = { datadogApiKey: process.env.DATADOG_API_KEY ?? "", datadogAppKey: process.env.DATADOG_APP_KEY ?? "" };
    const { buildContext } = getIngestAdapters("datadog");
    const ctx = await buildContext(parsed.issueId, apiBase, creds);
    if (ctx === null) stderrLog.info("Datadog context not available — DATADOG_API_KEY/DATADOG_APP_KEY may be missing or the fetch failed. Proceeding with input.context: null");
    return { context: ctx };
  }
}

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

  const contextResult = await resolveIngestContext(source, refText, datadogApiBase);
  if ("error" in contextResult) return { exitCode: 2, message: contextResult.error };
  const context = contextResult.context;

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
    const inputEnvelope: NodeEnvelope | undefined = await (async () => {
      if (args.envelope !== undefined) {
        const result = await readInputEnvelope({ envelope: args.envelope });
        if ("error" in result) {
          stderrLog.error(`Input error: ${result.error}`);
          process.exit(2);
        }
        return result.envelope;
      }
      if (!process.stdin.isTTY) {
        const result = await readInputEnvelope({});
        if ("error" in result) {
          if (!result.error.startsWith("No input envelope:")) {
            stderrLog.error(`Input error: ${result.error}`);
            process.exit(2);
          }
          return undefined;
        }
        return result.envelope;
      }
      return undefined;
    })();
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
