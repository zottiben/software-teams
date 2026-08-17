import { randomUUID } from "node:crypto";
import {
  scrubPII,
  type ClickUpRef,
  type NodeEnvelope,
} from "@websitelabs/software-teams";

export interface ClickUpCredentials {
  readonly apiToken: string;
  readonly apiBase?: string;
}

export interface SupportTicketComment {
  readonly id?: string;
  readonly text: string;
  readonly author?: string;
  readonly date?: string;
}

export interface SupportTicket {
  readonly source: "manual" | "clickup";
  /** Human-facing ClickUp custom ID where one exists, otherwise the API ID. */
  readonly id: string;
  /** ClickUp's opaque API ID. Kept separately because comment APIs accept either shape. */
  readonly apiId?: string;
  readonly workspaceId?: string;
  readonly url?: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly priority: string;
  readonly tags: string[];
  /** Oldest first, so the model reads the conversation in the order it happened. */
  readonly comments: SupportTicketComment[];
  /** True when the source had more comments than the bounded prompt can retain. */
  readonly commentsTruncated?: boolean;
  readonly acceptanceCriteria: string[];
  readonly subtasks: Array<{ readonly name: string; readonly status: string }>;
  readonly updatedAtMs?: number;
}

export interface TaggedClickUpTask {
  readonly apiId: string;
  readonly id: string;
  readonly workspaceId: string;
  readonly updatedAtMs: number;
}

export interface TaggedTaskQuery {
  readonly workspaceId: string;
  readonly tag: string;
  readonly updatedAfterMs?: number;
  readonly listIds?: readonly string[];
  readonly includeClosed: boolean;
  /** Newest first is used only for the n8n manual-test probe. */
  readonly reverse?: boolean;
  /** Stop once this many non-excluded task rows have been collected. */
  readonly maxTasks?: number;
  /** Boundary IDs already emitted; skipped while paging for unseen tasks. */
  readonly excludeApiIds?: readonly string[];
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class ClickUpApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    // Never include the response body: upstream errors can echo request headers
    // and would turn an n8n execution log into a credential leak.
    super(`ClickUp API request failed with HTTP ${status}`);
    this.name = "ClickUpApiError";
    this.status = status;
  }
}

function apiBase(credentials: ClickUpCredentials): string {
  const value = (credentials.apiBase ?? "https://api.clickup.com").replace(/\/$/, "");
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("ClickUp API Base URL must use HTTPS (HTTP is allowed only for localhost tests)");
  }
  if (url.username || url.password) {
    throw new Error("ClickUp API Base URL must not contain credentials");
  }
  return value;
}

async function requestJson(
  url: URL,
  credentials: ClickUpCredentials,
  fetchImpl: FetchLike,
): Promise<unknown> {
  if (!credentials.apiToken.trim()) throw new Error("ClickUp API token is required");

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: credentials.apiToken,
    },
  });
  if (!response.ok) throw new ClickUpApiError(response.status);

  try {
    return await response.json();
  } catch {
    throw new Error("ClickUp API returned invalid JSON");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is Record<string, unknown> => item !== null);
}

function customRefQuery(url: URL, ref: ClickUpRef): void {
  if (!ref.teamId) return;
  url.searchParams.set("custom_task_ids", "true");
  url.searchParams.set("team_id", ref.teamId);
}

function priorityName(value: unknown): string {
  const priority = record(value);
  const raw = priority?.["id"] ?? value;
  if (typeof raw === "string" && ["urgent", "high", "normal", "low"].includes(raw.toLowerCase())) {
    return raw.toLowerCase();
  }
  const id = numericValue(raw);
  return ({ 1: "urgent", 2: "high", 3: "normal", 4: "low" } as const)[
    id as 1 | 2 | 3 | 4
  ] ?? "normal";
}

function statusName(value: unknown): string {
  return stringValue(record(value)?.["status"]) ?? stringValue(value) ?? "unknown";
}

function parseComments(value: unknown): SupportTicketComment[] {
  const comments = arrayRecords(record(value)?.["comments"]);
  return comments
    .map((comment): SupportTicketComment | null => {
      const richText = arrayRecords(comment["comment"])
        .map((part) => stringValue(part["text"]) ?? "")
        .join("");
      const text = stringValue(comment["comment_text"]) ?? richText;
      if (!text.trim()) return null;

      const user = record(comment["user"]);
      return {
        ...(stringValue(comment["id"]) ? { id: stringValue(comment["id"]) } : {}),
        text,
        ...(stringValue(user?.["username"]) ? { author: stringValue(user?.["username"]) } : {}),
        ...(stringValue(comment["date"]) ? { date: stringValue(comment["date"]) } : {}),
      };
    })
    .filter((comment): comment is SupportTicketComment => comment !== null)
    .sort((a, b) => (numericValue(a.date) ?? 0) - (numericValue(b.date) ?? 0));
}

function parseTask(
  value: unknown,
  ref: ClickUpRef,
  comments: SupportTicketComment[],
  commentsTruncated: boolean,
): SupportTicket {
  const task = record(value);
  if (!task) throw new Error("ClickUp task response must be an object");

  const apiId = stringValue(task["id"]);
  const customId = stringValue(task["custom_id"]);
  const title = stringValue(task["name"]);
  if (!apiId || !title) throw new Error("ClickUp task response is missing id or name");

  const acceptanceCriteria = arrayRecords(task["checklists"]).flatMap((checklist) =>
    arrayRecords(checklist["items"])
      .map((item) => stringValue(item["name"]))
      .filter((name): name is string => name !== undefined),
  );
  const subtasks = arrayRecords(task["subtasks"])
    .map((subtask) => {
      const name = stringValue(subtask["name"]);
      return name ? { name, status: statusName(subtask["status"]) } : null;
    })
    .filter((subtask): subtask is { name: string; status: string } => subtask !== null);
  const tags = arrayRecords(task["tags"])
    .map((tag) => stringValue(tag["name"]))
    .filter((tag): tag is string => tag !== undefined);

  return {
    source: "clickup",
    id: customId ?? ref.taskId ?? apiId,
    apiId,
    ...(ref.teamId ? { workspaceId: ref.teamId } : {}),
    ...(stringValue(task["url"]) ? { url: stringValue(task["url"]) } : {}),
    title,
    description:
      stringValue(task["markdown_description"]) ?? stringValue(task["description"]) ?? "",
    status: statusName(task["status"]),
    priority: priorityName(task["priority"]),
    tags,
    comments,
    ...(commentsTruncated ? { commentsTruncated: true } : {}),
    acceptanceCriteria,
    subtasks,
    ...(numericValue(task["date_updated"]) !== undefined
      ? { updatedAtMs: numericValue(task["date_updated"]) }
      : {}),
  };
}

async function fetchAllComments(
  initialUrl: URL,
  credentials: ClickUpCredentials,
  fetchImpl: FetchLike,
): Promise<{ comments: SupportTicketComment[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let url = new URL(initialUrl);
  // ClickUp returns 25 comments newest-first. Bound one ticket to 200 comments
  // so a pathological history cannot monopolise a polling worker.
  for (let page = 0; page < 8; page += 1) {
    const body = record(await requestJson(url, credentials, fetchImpl));
    if (!body) throw new Error("ClickUp comment response must be an object");
    const pageRows = arrayRecords(body["comments"]);
    rows.push(...pageRows);
    if (pageRows.length < 25) {
      return { comments: parseComments({ comments: rows }), truncated: false };
    }

    const last = pageRows[pageRows.length - 1]!;
    const start = stringValue(last["date"]);
    const startId = stringValue(last["id"]);
    if (!start || !startId) {
      return { comments: parseComments({ comments: rows }), truncated: false };
    }
    url = new URL(initialUrl);
    url.searchParams.set("start", start);
    url.searchParams.set("start_id", startId);
  }
  return { comments: parseComments({ comments: rows }), truncated: true };
}

export async function fetchClickUpSupportTicket(
  ref: ClickUpRef,
  credentials: ClickUpCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<SupportTicket> {
  const taskPath = `/api/v2/task/${encodeURIComponent(ref.taskId)}`;
  const taskUrl = new URL(`${apiBase(credentials)}${taskPath}`);
  customRefQuery(taskUrl, ref);

  const commentsUrl = new URL(`${apiBase(credentials)}${taskPath}/comment`);
  customRefQuery(commentsUrl, ref);

  // Deliberately sequential. If the task itself is unavailable there is no
  // reason to spend another request, and deterministic ordering makes audit
  // and tests easier to interpret.
  const task = await requestJson(taskUrl, credentials, fetchImpl);
  const { comments, truncated } = await fetchAllComments(commentsUrl, credentials, fetchImpl);
  return parseTask(task, ref, comments, truncated);
}

export async function listClickUpTaggedTasks(
  query: TaggedTaskQuery,
  credentials: ClickUpCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<TaggedClickUpTask[]> {
  if (!query.workspaceId.trim()) throw new Error("ClickUp Workspace ID is required");
  if (!query.tag.trim()) throw new Error("ClickUp pickup tag is required");

  const url = new URL(
    `${apiBase(credentials)}/api/v2/team/${encodeURIComponent(query.workspaceId)}/task`,
  );
  url.searchParams.set("order_by", "updated");
  url.searchParams.set("reverse", String(query.reverse ?? false));
  url.searchParams.set("include_closed", String(query.includeClosed));
  url.searchParams.set("include_markdown_description", "true");
  url.searchParams.append("tags[]", query.tag);
  if (query.updatedAfterMs !== undefined) {
    url.searchParams.set("date_updated_gt", String(query.updatedAfterMs));
  }
  for (const listId of query.listIds ?? []) {
    if (listId.trim()) url.searchParams.append("list_ids[]", listId.trim());
  }

  const tasks: TaggedClickUpTask[] = [];
  const excluded = new Set(query.excludeApiIds ?? []);
  const maxTasks = Math.max(0, query.maxTasks ?? Number.POSITIVE_INFINITY);
  if (maxTasks === 0) return [];
  let previousUpdatedAtMs = Number.NEGATIVE_INFINITY;

  // ClickUp returns at most 100 workspace tasks per page. Production requests
  // `order_by=updated&reverse=false`, whose ascending order makes a bounded
  // prefix safe to watermark. Validate that contract at runtime: a changed or
  // ignored server order fails the poll loudly instead of silently skipping the
  // unseen suffix. Manual newest-first probes opt out and sort client-side.
  for (let page = 0; ; page += 1) {
    url.searchParams.set("page", String(page));
    const body = record(await requestJson(url, credentials, fetchImpl));
    if (!body) throw new Error("ClickUp task-list response must be an object");
    const pageRows = arrayRecords(body["tasks"]);
    for (const task of pageRows) {
      const apiId = stringValue(task["id"]);
      const customId = stringValue(task["custom_id"]);
      const updatedAtMs = numericValue(task["date_updated"]);
      if (!apiId || updatedAtMs === undefined) continue;
      if (!query.reverse && updatedAtMs < previousUpdatedAtMs) {
        throw new Error(
          "ClickUp returned tasks out of ascending updated order; refusing to advance the poll watermark",
        );
      }
      previousUpdatedAtMs = updatedAtMs;
      if (excluded.has(apiId)) continue;
      if (tasks.length < maxTasks) {
        tasks.push({
          apiId,
          id: customId ?? apiId,
          workspaceId: query.workspaceId,
          updatedAtMs,
        });
      }
    }
    // Validate the whole page before accepting a partial prefix. Production's
    // cap stays below one page, so descending server order cannot hide behind
    // an early return at the first row.
    if (tasks.length >= maxTasks || pageRows.length < 100) return tasks;
  }
}

function manualComment(value: unknown): SupportTicketComment | null {
  if (typeof value === "string") return value.trim() ? { text: value } : null;
  const item = record(value);
  const text = stringValue(item?.["text"]) ?? stringValue(item?.["comment_text"]);
  if (!text?.trim()) return null;
  return {
    ...(stringValue(item?.["id"]) ? { id: stringValue(item?.["id"]) } : {}),
    text,
    ...(stringValue(item?.["author"]) ? { author: stringValue(item?.["author"]) } : {}),
    ...(stringValue(item?.["date"]) ? { date: stringValue(item?.["date"]) } : {}),
  };
}

export function parseManualSupportTicket(input: string): SupportTicket {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Ticket JSON or text is required");

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    value = { title: trimmed.split(/\r?\n/, 1)[0], description: trimmed };
  }

  const ticket = record(value);
  if (!ticket) throw new Error("Ticket input must be a JSON object or plain text");

  const title = stringValue(ticket["title"]) ?? stringValue(ticket["name"]);
  if (!title?.trim()) throw new Error("Ticket input must include title or name");

  const comments = (Array.isArray(ticket["comments"]) ? ticket["comments"] : [])
    .map(manualComment)
    .filter((comment): comment is SupportTicketComment => comment !== null);
  const tags = (Array.isArray(ticket["tags"]) ? ticket["tags"] : [])
    .map((tag) => (typeof tag === "string" ? tag : stringValue(record(tag)?.["name"])))
    .filter((tag): tag is string => tag !== undefined);

  return {
    source: "manual",
    id: stringValue(ticket["id"]) ?? "manual-ticket",
    ...(stringValue(ticket["url"]) ? { url: stringValue(ticket["url"]) } : {}),
    title,
    description: stringValue(ticket["description"]) ?? stringValue(ticket["text_content"]) ?? "",
    status: statusName(ticket["status"]),
    priority: priorityName(ticket["priority"]),
    tags,
    comments,
    acceptanceCriteria: (Array.isArray(ticket["acceptanceCriteria"])
      ? ticket["acceptanceCriteria"]
      : []
    ).filter((item): item is string => typeof item === "string"),
    subtasks: arrayRecords(ticket["subtasks"])
      .map((subtask) => {
        const name = stringValue(subtask["name"]);
        return name ? { name, status: statusName(subtask["status"]) } : null;
      })
      .filter((subtask): subtask is { name: string; status: string } => subtask !== null),
    ...(numericValue(ticket["updatedAtMs"] ?? ticket["date_updated"]) !== undefined
      ? { updatedAtMs: numericValue(ticket["updatedAtMs"] ?? ticket["date_updated"]) }
      : {}),
  };
}

export function sanitiseSupportTicket(ticket: SupportTicket): SupportTicket {
  return {
    ...ticket,
    title: scrubPII(ticket.title),
    description: scrubPII(ticket.description),
    tags: ticket.tags.map(scrubPII),
    comments: ticket.comments.map((comment) => ({
      ...comment,
      text: scrubPII(comment.text),
      ...(comment.author ? { author: scrubPII(comment.author) } : {}),
    })),
    acceptanceCriteria: ticket.acceptanceCriteria.map(scrubPII),
    subtasks: ticket.subtasks.map((subtask) => ({
      name: scrubPII(subtask.name),
      status: scrubPII(subtask.status),
    })),
  };
}

export function formatSupportTicketContext(input: SupportTicket): string {
  const ticket = sanitiseSupportTicket(input);
  const lines = [
    `## Support Ticket: ${ticket.title}`,
    `- **ID:** ${ticket.id}`,
    `- **Source:** ${ticket.source}`,
    `- **Status:** ${ticket.status}`,
    `- **Priority:** ${ticket.priority}`,
    ...(ticket.tags.length > 0 ? [`- **Tags:** ${ticket.tags.join(", ")}`] : []),
    "",
    "_User-authored text has been PII-scrubbed before entering the model prompt._",
    "",
    "### Description",
    ticket.description || "_No description_",
  ];

  if (ticket.comments.length > 0) {
    lines.push("", "### Conversation");
    if (ticket.commentsTruncated) {
      lines.push("_Only the 200 most recent comments are included._");
    }
    for (const comment of ticket.comments) {
      const who = comment.author ? ` (${comment.author})` : "";
      lines.push(`- ${comment.date ?? "unknown date"}${who}: ${comment.text}`);
    }
  }
  if (ticket.acceptanceCriteria.length > 0) {
    lines.push("", "### Acceptance Criteria");
    for (const criterion of ticket.acceptanceCriteria) lines.push(`- [ ] ${criterion}`);
  }
  if (ticket.subtasks.length > 0) {
    lines.push("", "### Subtasks");
    for (const subtask of ticket.subtasks) {
      lines.push(`- [${subtask.status === "complete" ? "x" : " "}] ${subtask.name}`);
    }
  }
  return lines.join("\n");
}

export function createClickUpFetchErrorEnvelope(
  task: TaggedClickUpTask,
  options: {
    readonly prompt: string;
    readonly agentId: string;
    readonly budgetUsd: number;
    readonly message: string;
    readonly now?: string;
  },
): NodeEnvelope {
  const at = options.now ?? new Date().toISOString();
  return {
    correlationId: randomUUID(),
    agentId: options.agentId,
    status: "error",
    input: {
      prompt: options.prompt,
      context: {
        source: "clickup",
        ticket: {
          id: task.id,
          apiId: task.apiId,
          workspaceId: task.workspaceId,
          updatedAtMs: task.updatedAtMs,
        },
        summary: `ClickUp ticket ${task.id} could not be fetched for triage.`,
      },
    },
    result: { text: options.message },
    artifacts: [],
    budget: { limitUsd: options.budgetUsd, spentUsd: 0 },
    audit: [
      {
        at,
        actor: "software-teams-clickup-trigger",
        action: "ticket-ingestion-failed",
        status: "error",
        details: { source: "clickup", ticketId: task.id, reason: options.message },
      },
    ],
  };
}

export function createSupportEnvelope(
  input: SupportTicket,
  options: {
    readonly prompt: string;
    readonly agentId: string;
    readonly budgetUsd: number;
    readonly correlationId?: string;
    readonly now?: string;
  },
): NodeEnvelope {
  const ticket = sanitiseSupportTicket(input);
  const at = options.now ?? new Date().toISOString();
  return {
    correlationId: options.correlationId ?? randomUUID(),
    agentId: options.agentId,
    status: "ok",
    input: {
      prompt: options.prompt,
      context: {
        source: ticket.source,
        ticket,
        summary: formatSupportTicketContext(ticket),
      },
    },
    result: { text: "" },
    artifacts: [],
    budget: { limitUsd: options.budgetUsd, spentUsd: 0 },
    audit: [
      {
        at,
        actor: "software-teams-ticket",
        action: "ticket-ingested",
        status: "ok",
        details: { source: ticket.source, ticketId: ticket.id },
      },
    ],
  };
}
