/**
 * Ingestion context adapter — T6
 *
 * Thin wrapper around the project's pull-only ClickUp and Datadog fetch utilities
 * that maps fetched data onto the envelope's `input.context` field and injects
 * credential tokens into the env vars the underlying utils expect.
 *
 * Design notes:
 * - The underlying utils (src/utils/clickup.ts, src/utils/datadog.ts) read tokens
 *   from process.env. In the n8n context, tokens come from the SoftwareTeamsApi
 *   credential (R-02). We temporarily inject them before calling the utils, then
 *   restore the original values in the finally block.
 * - All PII scrubbing is performed by the underlying utils (formatTicketAsContext,
 *   formatDatadogAsContext). This adapter adds no scrubbing of its own.
 * - Missing/unfetchable context → returns null; callers proceed with empty context
 *   and a logged note — mirroring the utils' own graceful-degradation behaviour.
 */

import {
  fetchClickUpTicket,
  formatTicketAsContext,
  fetchDatadogIssue,
  formatDatadogAsContext,
} from "@websitelabs/software-teams";
import type { ClickUpRef } from "@websitelabs/software-teams";

// --------------------------------------------------------------------------
// Credential shapes (mirrors fields on SoftwareTeamsApi credential)
// --------------------------------------------------------------------------

/** The credential fields this adapter reads for ClickUp fetching. */
export interface ClickUpContextCredentials {
  /** Value of the 'clickupApiKey' field from the softwareTeamsApi credential. */
  clickupApiKey: string;
}

/** The credential fields this adapter reads for Datadog fetching. */
export interface DatadogContextCredentials {
  /** Value of the 'datadogApiKey' field from the softwareTeamsApi credential. */
  datadogApiKey: string;
  /** Value of the 'datadogAppKey' field from the softwareTeamsApi credential. */
  datadogAppKey: string;
}

// --------------------------------------------------------------------------
// Context shapes placed on NodeEnvelope.input.context
// --------------------------------------------------------------------------

/** Context object emitted for a ClickUp source. */
export interface ClickUpContext {
  source: "clickup";
  /** The ClickUp task ID resolved for this run. */
  ticketId: string;
  /**
   * PII-scrubbed markdown summary produced by formatTicketAsContext().
   * This is what downstream agent nodes read; the original field values were
   * redacted before this object was written (R-02, CONTRACT.md §2).
   */
  summary: string;
}

/** Context object emitted for a Datadog source. */
export interface DatadogContext {
  source: "datadog";
  /** The Datadog Error Tracking issue ID for this run. */
  issueId: string;
  /**
   * PII-scrubbed markdown summary produced by formatDatadogAsContext().
   * Whitelisted fields only — tags, sample events, and assignee info are NOT
   * fetched (see src/utils/datadog.ts for the full whitelist).
   */
  summary: string;
}

// --------------------------------------------------------------------------
// Adapters
// --------------------------------------------------------------------------

/**
 * Fetch a ClickUp ticket and map it onto the envelope's input.context.
 *
 * Temporarily injects the credential token into process.env.CLICKUP_API_TOKEN
 * (the env var fetchClickUpTicket reads), then restores the previous value.
 * Returns null when the token is absent or the fetch fails — the caller should
 * proceed with `context: null` and log a note to the execution log.
 */
export async function buildClickUpContext(
  ref: ClickUpRef,
  creds: ClickUpContextCredentials,
): Promise<ClickUpContext | null> {
  if (!creds.clickupApiKey) return null;

  const prev = process.env.CLICKUP_API_TOKEN;
  process.env.CLICKUP_API_TOKEN = creds.clickupApiKey;
  try {
    const ticket = await fetchClickUpTicket(ref);
    if (!ticket) return null;
    return {
      source: "clickup",
      ticketId: ticket.id,
      summary: formatTicketAsContext(ticket),
    };
  } catch {
    // Security (T13 / R-02): swallow the raw exception — the error message from
    // the underlying fetch may contain HTTP response details. Callers receive
    // `null` and log a safe note; no credential value appears in exception paths.
    return null;
  } finally {
    // Restore the original value (or remove if it was absent) so we don't
    // bleed the credential token into the process environment beyond this call.
    if (prev === undefined) {
      delete process.env.CLICKUP_API_TOKEN;
    } else {
      process.env.CLICKUP_API_TOKEN = prev;
    }
  }
}

/**
 * Fetch a Datadog Error Tracking issue and map it onto the envelope's input.context.
 *
 * Temporarily injects the credential tokens into DATADOG_API_KEY and
 * DATADOG_APP_KEY (the env vars fetchDatadogIssue reads), then restores them.
 * Returns null when keys are absent or the fetch fails — the caller should
 * proceed with `context: null` and log a note to the execution log.
 */
export async function buildDatadogContext(
  issueId: string,
  apiBase: string,
  creds: DatadogContextCredentials,
): Promise<DatadogContext | null> {
  if (!creds.datadogApiKey || !creds.datadogAppKey) return null;

  const prevApiKey = process.env.DATADOG_API_KEY;
  const prevAppKey = process.env.DATADOG_APP_KEY;
  process.env.DATADOG_API_KEY = creds.datadogApiKey;
  process.env.DATADOG_APP_KEY = creds.datadogAppKey;
  try {
    const issue = await fetchDatadogIssue(issueId, apiBase);
    if (!issue) return null;
    return {
      source: "datadog",
      issueId: issue.id,
      summary: formatDatadogAsContext(issue),
    };
  } catch {
    // Security (T13 / R-02): swallow the raw exception — the error message from
    // the underlying fetch may contain HTTP response details. Callers receive
    // `null` and log a safe note; no credential value appears in exception paths.
    return null;
  } finally {
    if (prevApiKey === undefined) {
      delete process.env.DATADOG_API_KEY;
    } else {
      process.env.DATADOG_API_KEY = prevApiKey;
    }
    if (prevAppKey === undefined) {
      delete process.env.DATADOG_APP_KEY;
    } else {
      process.env.DATADOG_APP_KEY = prevAppKey;
    }
  }
}
