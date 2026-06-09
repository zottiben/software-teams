import { scrubPII } from "./pii-scrubber";

export interface ClickUpTicket {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  acceptanceCriteria: string[];
  subtasks: { name: string; status: string }[];
}

/** Raw subtask shape returned by the ClickUp v2 API. */
interface ClickUpApiSubtask {
  name: string;
  status?: { status?: string };
}

/** Raw task shape returned by the ClickUp v2 API. */
interface ClickUpApiTask {
  id: string;
  name: string;
  description?: string;
  status?: { status?: string };
  priority?: { id?: number };
  checklists?: Array<{ items?: Array<{ name: string }> }>;
  subtasks?: ClickUpApiSubtask[];
}

/**
 * What we pull out of a ClickUp URL. Two shapes are supported:
 *
 *   1. Simple — `app.clickup.com/t/<task_id>` (no team prefix). The
 *      captured value IS the API's task ID; `teamId` is undefined.
 *   2. With team — `app.clickup.com/t/<team_id>/<custom_task_id>`.
 *      The first segment is the team ID and the second is a custom
 *      task alias (e.g. `NDP-33700`). The API call needs BOTH the
 *      custom task ID AND `?custom_task_ids=true&team_id=...` query
 *      params; otherwise ClickUp returns 404 and the ticket context
 *      is silently dropped — the bug observed on issue 6201.
 */
export interface ClickUpRef {
  taskId: string;
  teamId?: string;
}

// Order matters — the team-prefix form must be tested before the
// simple form, otherwise the simple regex matches the team_id segment
// alone and skips the real task alias.
const CLICKUP_URL_PATTERNS_WITH_TEAM = [
  /app\.clickup\.com\/t\/(\d+)\/([A-Za-z0-9_-]+)/,
  /sharing\.clickup\.com\/t\/(\d+)\/([A-Za-z0-9_-]+)/,
  /clickup\.com\/t\/(\d+)\/([A-Za-z0-9_-]+)/,
];
const CLICKUP_URL_PATTERNS_SIMPLE = [
  /app\.clickup\.com\/t\/([a-z0-9]+)(?![/\w-])/i,
  /sharing\.clickup\.com\/t\/([a-z0-9]+)(?![/\w-])/i,
  /clickup\.com\/t\/([a-z0-9]+)(?![/\w-])/i,
];

export function extractClickUpRef(text: string): ClickUpRef | null {
  // Try team-prefix form FIRST so we don't truncate `team/task` into
  // just `team`.
  for (const pattern of CLICKUP_URL_PATTERNS_WITH_TEAM) {
    const match = text.match(pattern);
    if (match) {
      const teamId = match[1];
      const taskId = match[2];
      if (taskId.length > 40) return null; // sanity bound
      return { taskId, teamId };
    }
  }
  for (const pattern of CLICKUP_URL_PATTERNS_SIMPLE) {
    const match = text.match(pattern);
    if (match) {
      const id = match[1];
      if (id.length > 20) return null;
      return { taskId: id };
    }
  }
  return null;
}

/**
 * Back-compat shim. Existing callers that only want the task ID
 * string can continue using this — but the runner uses
 * `extractClickUpRef` so it can pass `teamId` to the fetcher.
 */
export function extractClickUpId(text: string): string | null {
  return extractClickUpRef(text)?.taskId ?? null;
}

export async function fetchClickUpTicket(
  ref: ClickUpRef | string,
): Promise<ClickUpTicket | null> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return null;

  // Normalise: accept a bare string for back-compat with older callers.
  const { taskId, teamId } =
    typeof ref === "string" ? { taskId: ref, teamId: undefined as string | undefined } : ref;

  // Custom task IDs (URLs like `/t/{team_id}/{NDP-33700}`) need the
  // custom_task_ids=true + team_id=... query params; ClickUp 404s
  // without them. Plain task IDs work against the bare endpoint.
  const clickupBase = (process.env.CLICKUP_API_BASE || "https://api.clickup.com").replace(/\/$/, "");
  const url = teamId
    ? `${clickupBase}/api/v2/task/${encodeURIComponent(taskId)}?custom_task_ids=true&team_id=${encodeURIComponent(teamId)}`
    : `${clickupBase}/api/v2/task/${encodeURIComponent(taskId)}`;

  try {
    const res = await fetch(url, { headers: { Authorization: token } });

    if (!res.ok) return null;

    const data = (await res.json()) as ClickUpApiTask;

    // Extract acceptance criteria from checklists
    const acceptanceCriteria: string[] = [];
    if (data.checklists) {
      for (const checklist of data.checklists) {
        for (const item of checklist.items ?? []) {
          acceptanceCriteria.push(item.name);
        }
      }
    }

    // Extract subtasks
    const subtasks = (data.subtasks ?? []).map((st) => ({
      name: st.name,
      status: st.status?.status ?? "unknown",
    }));

    const priorityMap: Record<number, string> = {
      1: "urgent",
      2: "high",
      3: "normal",
      4: "low",
    };

    return {
      id: data.id,
      name: data.name,
      description: data.description ?? "",
      status: data.status?.status ?? "unknown",
      priority: (data.priority?.id != null ? priorityMap[data.priority.id] : undefined) ?? "normal",
      acceptanceCriteria,
      subtasks,
    };
  } catch {
    return null;
  }
}

export function formatTicketAsContext(ticket: ClickUpTicket): string {
  // Route every user-authored text field through the PII scrubber.
  // ClickUp tickets are internal team data but ticket descriptions
  // routinely contain customer references ("Customer <email> reports
  // …") — same scrubber as Datadog context for consistency.
  const lines = [
    `## ClickUp Ticket (sanitised): ${scrubPII(ticket.name)}`,
    `- **ID:** ${ticket.id}`,
    `- **Status:** ${ticket.status}`,
    `- **Priority:** ${ticket.priority}`,
    ``,
    `_PII patterns (email/phone/card/SSN/JWT/long-token/numeric IDs) have been replaced with placeholders before this context entered the prompt._`,
    ``,
    `### Description`,
    ticket.description ? scrubPII(ticket.description) : "_No description_",
  ];

  if (ticket.acceptanceCriteria.length > 0) {
    lines.push(``, `### Acceptance Criteria`);
    for (const ac of ticket.acceptanceCriteria) {
      lines.push(`- [ ] ${scrubPII(ac)}`);
    }
  }

  if (ticket.subtasks.length > 0) {
    lines.push(``, `### Subtasks`);
    for (const st of ticket.subtasks) {
      const check = st.status === "complete" ? "x" : " ";
      lines.push(`- [${check}] ${scrubPII(st.name)}`);
    }
  }

  return lines.join("\n");
}
