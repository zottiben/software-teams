import { consola } from "consola";
import { extractClickUpRef, fetchClickUpTicket, formatTicketAsContext } from "../../../utils/clickup";
import { extractDatadogIssue, fetchDatadogIssue, formatDatadogAsContext } from "../../../utils/datadog";

/**
 * Scan a text corpus for external context references (ClickUp ticket
 * URLs, Datadog Error Tracking URLs) and fetch each one through its
 * respective sanitised formatter. Returns the formatted markdown
 * blocks ready to be appended to the agent's workspace context.
 *
 * Used by BOTH the label-triggered path (text = issue title + body)
 * AND the comment-triggered path (text = trigger comment + issue
 * title + body). Each fetcher returns null on missing creds /
 * unreachable API / parse failure — failures log once and the run
 * continues without that block.
 *
 * PII safety is enforced inside each formatter (`formatTicketAsContext`
 * for ClickUp, `formatDatadogAsContext` for Datadog) — the scrubber
 * runs at the format step so the raw API responses never enter the
 * agent prompt.
 */
export async function loadExternalContexts(searchText: string): Promise<string[]> {
  if (!searchText) return [];
  const blocks: string[] = [];

  // ClickUp
  const clickUpRef = extractClickUpRef(searchText);
  if (clickUpRef) {
    const label = clickUpRef.teamId
      ? `${clickUpRef.taskId} (team ${clickUpRef.teamId})`
      : clickUpRef.taskId;
    consola.info(`Fetching ClickUp ticket: ${label}`);
    const ticket = await fetchClickUpTicket(clickUpRef);
    if (ticket) {
      blocks.push(formatTicketAsContext(ticket));
      consola.success(`Loaded ClickUp ticket: ${ticket.name}`);
    } else {
      consola.warn(`ClickUp fetch returned no ticket for ${label} — check CLICKUP_API_TOKEN and that the ID exists`);
    }
  }

  // Datadog Error Tracking
  const ddRef = extractDatadogIssue(searchText);
  if (ddRef) {
    consola.info(`Fetching Datadog Error Tracking issue: ${ddRef.issueId}`);
    const issue = await fetchDatadogIssue(ddRef.issueId, ddRef.apiBase);
    if (issue) {
      blocks.push(formatDatadogAsContext(issue));
      consola.success(`Loaded Datadog issue: ${issue.title}`);
    }
  }

  return blocks;
}
