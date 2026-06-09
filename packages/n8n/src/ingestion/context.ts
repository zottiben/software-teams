import {
  fetchClickUpTicket,
  formatTicketAsContext,
  fetchDatadogIssue,
  formatDatadogAsContext,
} from "@websitelabs/software-teams";
import type { ClickUpRef } from "@websitelabs/software-teams";

/** The credential fields this adapter reads for ClickUp fetching. */
export interface ClickUpContextCredentials {
  clickupApiKey: string;
}

/** The credential fields this adapter reads for Datadog fetching. */
export interface DatadogContextCredentials {
  datadogApiKey: string;
  datadogAppKey: string;
}

/** Context object emitted for a ClickUp source. */
export interface ClickUpContext {
  source: "clickup";
  ticketId: string;
  /** PII-scrubbed markdown summary produced by formatTicketAsContext() (R-02, CONTRACT.md §2). */
  summary: string;
}

/** Context object emitted for a Datadog source. */
export interface DatadogContext {
  source: "datadog";
  issueId: string;
  /** PII-scrubbed markdown summary produced by formatDatadogAsContext(). Whitelisted fields only. */
  summary: string;
}

/**
 * Fetch a ClickUp ticket and map it onto the envelope's input.context.
 * Temporarily injects the credential token into process.env.CLICKUP_API_TOKEN
 * (the env var fetchClickUpTicket reads), then restores the previous value.
 * Returns null when the token is absent or the fetch fails (graceful degradation).
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
    // Security (T13 / R-02): swallow the raw exception — error messages from
    // the underlying fetch may contain HTTP response details with credential values.
    return null;
  } finally {
    if (prev === undefined) {
      delete process.env.CLICKUP_API_TOKEN;
    } else {
      process.env.CLICKUP_API_TOKEN = prev;
    }
  }
}

/**
 * Fetch a Datadog Error Tracking issue and map it onto the envelope's input.context.
 * Temporarily injects the credential tokens into DATADOG_API_KEY and DATADOG_APP_KEY,
 * then restores them. Returns null when keys are absent or the fetch fails.
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
    // Security (T13 / R-02): swallow the raw exception — error messages may contain credential values.
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
