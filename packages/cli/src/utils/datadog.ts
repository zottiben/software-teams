/**
 * Datadog Error Tracking integration.
 *
 * When an issue/comment carries a Datadog error-tracking URL, the
 * runner fetches the issue summary from Datadog's API and adds it as
 * sanitised context to the researcher's prompt. This gives the agent
 * the error type, stacktrace top frames, and service/env metadata up
 * front — same UX pattern as ClickUp ticket context.
 *
 * PII safety — four layers (see `utils/pii-scrubber.ts` for the
 * scrubbing logic; this file enforces the whitelist + bounds):
 *
 *   1. Whitelist what we fetch. The Error Tracking API issue endpoint
 *      returns more than we should consume. We pick only fields known
 *      to be PII-safe in shape (error type, file paths, function
 *      names, timestamps) and discard tags, custom attributes, sample
 *      events, assignee info, etc.
 *
 *   2. Scrub every text field through `scrubPII` before it lands in
 *      the formatted context. Even safe-shaped fields can have user
 *      data interpolated (`"invalid email john@example.com"`).
 *
 *   3. Bound everything — top N stacktrace frames, capped error
 *      message length, capped per-frame function name length —
 *      prevents pathological inputs from blowing up the prompt.
 *
 *   4. Visible scrub markers + a header note in the formatted output
 *      so a reviewer can audit what was redacted and the agent knows
 *      not to invent the original value.
 *
 * Auth: `DATADOG_API_KEY` and `DATADOG_APP_KEY` env vars (both
 * required — Datadog's query endpoints reject API-key-only requests).
 * Missing keys → `fetchDatadogIssue` returns null with a single
 * informational log line; the run proceeds without Datadog context.
 */

import { consola } from "consola";
import { scrubPII } from "./pii-scrubber";

const STACKTRACE_FRAME_LIMIT = 5;
const ERROR_MESSAGE_MAX_CHARS = 500;
const FUNCTION_NAME_MAX_CHARS = 100;

export interface DatadogStackFrame {
  file: string;
  line: number;
  function: string;
}

export interface DatadogIssue {
  id: string;
  title: string;
  errorType: string;
  errorMessage: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  service: string;
  env: string;
  version: string;
  stacktrace: DatadogStackFrame[];
}

/**
 * Datadog regional API base URLs. The web app host determines the
 * region (`app.datadoghq.com` = US1, `app.datadoghq.eu` = EU,
 * `app.us3.datadoghq.com` = US3, `app.us5.datadoghq.com` = US5,
 * `app.ap1.datadoghq.com` = AP1, `app.ddog-gov.com` = US1-FED).
 *
 * The API host swaps `app` for `api`. We don't need a full enum —
 * just preserve the subdomain prefix.
 */
function apiBaseFromWebHost(webHost: string): string {
  // `app.datadoghq.com` → `https://api.datadoghq.com`
  // `app.us5.datadoghq.com` → `https://api.us5.datadoghq.com`
  // `app.datadoghq.eu` → `https://api.datadoghq.eu`
  // `app.ddog-gov.com` → `https://api.ddog-gov.com`
  return `https://${webHost.replace(/^app\./, "api.")}`;
}

/**
 * Pull a Datadog Error Tracking issue ID + region from text. The URL
 * looks like:
 *
 *   https://app.datadoghq.com/error-tracking?...issueId%22%3A%22<UUID>%22...
 *
 * The `issueId` is URL-encoded JSON inside the `sp` query param. We
 * regex-match the UUID directly rather than decoding the param, which
 * is robust to format drift in the surrounding JSON.
 *
 * Returns null when no Error Tracking issue URL is present.
 */
export function extractDatadogIssue(
  text: string,
): { issueId: string; apiBase: string } | null {
  if (!text) return null;
  // The host must match `app.*datadoghq.com` (or `.eu`, or
  // `.ddog-gov.com`) so we only pick up Datadog URLs and only
  // Error Tracking paths.
  const urlMatch = text.match(/https?:\/\/(app\.(?:[a-z0-9-]+\.)?(?:datadoghq\.com|datadoghq\.eu|ddog-gov\.com))\/error-tracking[^\s)]+/i);
  if (!urlMatch) return null;
  const webHost = urlMatch[1].toLowerCase();
  const url = urlMatch[0];

  // Match a UUID anywhere after the `issueId` key. The chars between
  // `issueId` and the UUID are JSON encoding artefacts (`%22%3A%22` =
  // `":"`) — we don't care what's there, just that a real UUID follows.
  // Use a length-bounded lazy `.*?` (max 30 chars of slack) — we can't
  // use `[^0-9a-f]*` because `2` and `3` ARE hex chars and appear in
  // the URL encoding (`%22`, `%3A`).
  const idMatch = url.match(/issueId.{0,30}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!idMatch) return null;

  return { issueId: idMatch[1], apiBase: apiBaseFromWebHost(webHost) };
}

/**
 * Fetch the issue from Datadog's Error Tracking API. Returns null on
 * any failure (missing keys, 4xx, 5xx, malformed response). All
 * failures log a single informational line; we never throw, the run
 * continues without Datadog context.
 */
export async function fetchDatadogIssue(
  issueId: string,
  apiBase: string,
): Promise<DatadogIssue | null> {
  const apiKey = process.env.DATADOG_API_KEY;
  const appKey = process.env.DATADOG_APP_KEY;
  if (!apiKey || !appKey) {
    consola.info(
      `Datadog context skipped — DATADOG_API_KEY and DATADOG_APP_KEY must both be set in repo secrets to fetch error-tracking issues`,
    );
    return null;
  }

  try {
    const res = await fetch(`${apiBase}/api/v2/error-tracking/issues/${issueId}`, {
      headers: {
        "DD-API-KEY": apiKey,
        "DD-APPLICATION-KEY": appKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      consola.warn(`Datadog API returned ${res.status} for issue ${issueId} — skipping context`);
      return null;
    }
    const json = (await res.json()) as DatadogIssueApiResponse;
    return projectIssue(json);
  } catch (err) {
    consola.warn(`Datadog fetch failed for issue ${issueId}: ${err}`);
    return null;
  }
}

/**
 * Format the issue as a markdown context block for the prompt. Runs
 * every text field through `scrubPII` and bounds stacktrace depth +
 * field lengths. Output starts with an explicit "sanitised" header
 * note so a reviewer can audit what was redacted.
 */
export function formatDatadogAsContext(issue: DatadogIssue): string {
  const errorMessage = capLength(scrubPII(issue.errorMessage), ERROR_MESSAGE_MAX_CHARS);
  const frames = issue.stacktrace.slice(0, STACKTRACE_FRAME_LIMIT);

  const lines = [
    `## Datadog Error Context (sanitised)`,
    ``,
    `_Production PII has been replaced with placeholders. \`<email>\`, \`<phone>\`, \`<card>\`, \`<ssn>\`, \`<jwt>\`, \`<long-token>\`, \`<id>\` are scrub markers — the original values were never read by an agent. Whitelisted fields only: title, error type/message, timestamps, service/env/version, and stacktrace frames (file + line + function). Tags, custom attributes, and sample event payloads are NOT fetched._`,
    ``,
    `- **Issue ID:** \`${issue.id}\``,
    `- **Title:** ${scrubPII(issue.title)}`,
    `- **Error type:** \`${scrubPII(issue.errorType)}\``,
    `- **Service:** \`${issue.service}\` (env: \`${issue.env}\`${issue.version ? `, version: \`${issue.version}\`` : ""})`,
    `- **First seen:** ${issue.firstSeen}`,
    `- **Last seen:** ${issue.lastSeen}`,
    `- **Occurrences:** ${issue.count.toLocaleString()}`,
    ``,
    `### Error message`,
    ``,
    "```",
    errorMessage,
    "```",
  ];

  if (frames.length > 0) {
    lines.push(``, `### Stacktrace (top ${frames.length} frames)`);
    lines.push(``);
    for (const f of frames) {
      const fn = capLength(scrubPII(f.function || "<anonymous>"), FUNCTION_NAME_MAX_CHARS);
      lines.push(`- \`${f.file}:${f.line}\` — \`${fn}\``);
    }
  }

  return lines.join("\n");
}

function capLength(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

interface DatadogIssueApiResponse {
  data?: {
    id?: string;
    attributes?: {
      title?: string;
      error?: { type?: string; message?: string };
      first_seen?: string;
      last_seen?: string;
      count?: number;
      service?: string;
      env?: string;
      version?: string;
      stacktrace?: Array<{ file?: string; line?: number; function?: string }>;
    };
  };
}

/**
 * Project the raw API response onto our whitelisted shape. Anything
 * not on this list (tags, attributes, assignee, related events, etc.)
 * is dropped — even if the API adds new fields later, they won't
 * silently leak into the agent prompt.
 */
function projectIssue(json: DatadogIssueApiResponse): DatadogIssue {
  const a = json.data?.attributes ?? {};
  const stacktrace = (a.stacktrace ?? [])
    .filter((f) => typeof f?.file === "string" && typeof f?.line === "number")
    .map((f) => ({
      file: String(f.file),
      line: Number(f.line),
      function: String(f.function ?? ""),
    }));

  return {
    id: String(json.data?.id ?? ""),
    title: String(a.title ?? ""),
    errorType: String(a.error?.type ?? ""),
    errorMessage: String(a.error?.message ?? ""),
    firstSeen: String(a.first_seen ?? ""),
    lastSeen: String(a.last_seen ?? ""),
    count: Number(a.count ?? 0),
    service: String(a.service ?? ""),
    env: String(a.env ?? ""),
    version: String(a.version ?? ""),
    stacktrace,
  };
}
