export interface ClickUpTicket {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  acceptanceCriteria: string[];
  subtasks: { name: string; status: string }[];
}

const CLICKUP_URL_PATTERNS = [
  /app\.clickup\.com\/t\/([a-z0-9]+)/i,
  /sharing\.clickup\.com\/t\/([a-z0-9]+)/i,
  /clickup\.com\/t\/([a-z0-9]+)/i,
];

export function extractClickUpId(text: string): string | null {
  for (const pattern of CLICKUP_URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchClickUpTicket(
  taskId: string,
): Promise<ClickUpTicket | null> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(
      `https://api.clickup.com/api/v2/task/${taskId}`,
      { headers: { Authorization: token } },
    );

    if (!res.ok) return null;

    const data = await res.json();

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
    const subtasks = (data.subtasks ?? []).map((st: any) => ({
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
      priority: priorityMap[data.priority?.id] ?? "normal",
      acceptanceCriteria,
      subtasks,
    };
  } catch {
    return null;
  }
}

export function formatTicketAsContext(ticket: ClickUpTicket): string {
  const lines = [
    `## ClickUp Ticket: ${ticket.name}`,
    `- **ID:** ${ticket.id}`,
    `- **Status:** ${ticket.status}`,
    `- **Priority:** ${ticket.priority}`,
    ``,
    `### Description`,
    ticket.description || "_No description_",
  ];

  if (ticket.acceptanceCriteria.length > 0) {
    lines.push(``, `### Acceptance Criteria`);
    for (const ac of ticket.acceptanceCriteria) {
      lines.push(`- [ ] ${ac}`);
    }
  }

  if (ticket.subtasks.length > 0) {
    lines.push(``, `### Subtasks`);
    for (const st of ticket.subtasks) {
      const check = st.status === "complete" ? "x" : " ";
      lines.push(`- [${check}] ${st.name}`);
    }
  }

  return lines.join("\n");
}
