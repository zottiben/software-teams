import { describe, expect, test } from "bun:test";
import {
  createClickUpFetchErrorEnvelope,
  createSupportEnvelope,
  fetchClickUpSupportTicket,
  formatSupportTicketContext,
  listClickUpTaggedTasks,
  parseManualSupportTicket,
} from "../support-ticket";

const TASK_RESPONSE = {
  id: "task-api-id",
  custom_id: "NDP-34603",
  name: "Customer cannot complete checkout",
  description: "Customer jane@example.com receives error 503.",
  status: { status: "complete" },
  priority: { id: 2 },
  tags: [{ name: "software-teams" }, { name: "support" }],
  date_updated: "1770000000000",
  url: "https://app.clickup.com/t/36826178/NDP-34603",
  checklists: [{ items: [{ name: "Reproduce" }, { name: "Add regression test" }] }],
  subtasks: [{ name: "Check logs", status: { status: "complete" } }],
};

const COMMENTS_RESPONSE = {
  comments: [
    {
      id: "comment-2",
      comment_text: "Resolved for jane@example.com after the deploy.",
      user: { username: "Support Person", email: "support@example.com" },
      date: "1770000000000",
    },
    {
      id: "comment-1",
      comment: [{ text: "Original report from +44 7700 900123" }],
      user: { username: "Customer Person", email: "jane@example.com" },
      date: "1769990000000",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("support-ticket ingestion boundary", () => {
  test("fetches a custom-ID task and its comments with an explicit credential", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return url.endsWith("/comment?custom_task_ids=true&team_id=36826178")
        ? jsonResponse(COMMENTS_RESPONSE)
        : jsonResponse(TASK_RESPONSE);
    };

    const ticket = await fetchClickUpSupportTicket(
      { taskId: "NDP-34603", teamId: "36826178" },
      { apiToken: "pk_test", apiBase: "https://clickup.example" },
      fakeFetch,
    );

    expect(calls).toEqual([
      {
        url:
          "https://clickup.example/api/v2/task/NDP-34603?custom_task_ids=true&team_id=36826178",
        authorization: "pk_test",
      },
      {
        url:
          "https://clickup.example/api/v2/task/NDP-34603/comment?custom_task_ids=true&team_id=36826178",
        authorization: "pk_test",
      },
    ]);
    expect(ticket.id).toBe("NDP-34603");
    expect(ticket.apiId).toBe("task-api-id");
    expect(ticket.comments.map((comment) => comment.id)).toEqual(["comment-1", "comment-2"]);
    expect(ticket.acceptanceCriteria).toEqual(["Reproduce", "Add regression test"]);
  });

  test("paginates ticket comments using ClickUp's start and start_id cursor pair", async () => {
    const commentUrls: URL[] = [];
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/comment")) return jsonResponse(TASK_RESPONSE);
      commentUrls.push(url);
      if (url.searchParams.has("start")) {
        return jsonResponse({
          comments: [{ id: "older", comment_text: "Oldest", date: "100" }],
        });
      }
      return jsonResponse({
        comments: Array.from({ length: 25 }, (_, index) => ({
          id: `new-${index}`,
          comment_text: `Comment ${index}`,
          date: String(1000 - index),
        })),
      });
    };

    const ticket = await fetchClickUpSupportTicket(
      { taskId: "NDP-34603", teamId: "36826178" },
      { apiToken: "pk_test" },
      fakeFetch,
    );
    expect(commentUrls).toHaveLength(2);
    expect(commentUrls[1]?.searchParams.get("start")).toBe("976");
    expect(commentUrls[1]?.searchParams.get("start_id")).toBe("new-24");
    expect(ticket.comments).toHaveLength(26);
    expect(ticket.comments[0]?.id).toBe("older");
  });

  test("truncates a long comment history instead of wedging the polling boundary", async () => {
    let commentPage = 0;
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/comment")) return jsonResponse(TASK_RESPONSE);
      commentPage += 1;
      return jsonResponse({
        comments: Array.from({ length: 25 }, (_, index) => ({
          id: `${commentPage}-${index}`,
          comment_text: `Comment ${commentPage}-${index}`,
          date: String(10_000 - commentPage * 100 - index),
        })),
      });
    };

    const ticket = await fetchClickUpSupportTicket(
      { taskId: "task-api-id" },
      { apiToken: "pk_test" },
      fakeFetch,
    );
    expect(commentPage).toBe(8);
    expect(ticket.comments).toHaveLength(200);
    expect(ticket.commentsTruncated).toBeTrue();
    expect(formatSupportTicketContext(ticket)).toContain(
      "Only the 200 most recent comments are included",
    );
  });

  test("never writes the ClickUp token to the shared worker environment", async () => {
    const before = process.env.CLICKUP_API_TOKEN;
    const fakeFetch = async (input: string | URL | Request): Promise<Response> =>
      String(input).includes("/comment") ? jsonResponse({ comments: [] }) : jsonResponse(TASK_RESPONSE);

    await fetchClickUpSupportTicket(
      { taskId: "NDP-34603", teamId: "36826178" },
      { apiToken: "pk_must_not_escape" },
      fakeFetch,
    );

    expect(process.env.CLICKUP_API_TOKEN).toBe(before);
  });

  test("scrubs ticket body, comments, and author names before prompt context", () => {
    const ticket = parseManualSupportTicket(
      JSON.stringify({
        id: "SUP-1",
        title: "Call jane@example.com",
        description: "Phone +44 7700 900123",
        comments: [{ text: "Card 4111 1111 1111 1111", author: "jane@example.com" }],
      }),
    );

    const context = formatSupportTicketContext(ticket);
    expect(context).not.toContain("jane@example.com");
    expect(context).not.toContain("7700 900123");
    expect(context).not.toContain("4111 1111 1111 1111");
    expect(context).toContain("<email>");
  });

  test("manual and ClickUp tickets produce the same envelope shape with a ticket budget", () => {
    const ticket = parseManualSupportTicket(
      JSON.stringify({ id: "SUP-2", title: "A report", description: "Details" }),
    );
    const envelope = createSupportEnvelope(ticket, {
      prompt: "Triage this ticket",
      agentId: "software-teams-support-triage",
      budgetUsd: 1.25,
      now: "2026-06-15T12:00:00.000Z",
      correlationId: "11111111-2222-4333-8444-555555555555",
    });

    expect(envelope.input.context).toEqual({
      source: "manual",
      ticket,
      summary: formatSupportTicketContext(ticket),
    });
    expect(envelope.budget).toEqual({ limitUsd: 1.25, spentUsd: 0 });
    expect(envelope.audit).toEqual([
      {
        at: "2026-06-15T12:00:00.000Z",
        actor: "software-teams-ticket",
        action: "ticket-ingested",
        status: "ok",
        details: { source: "manual", ticketId: "SUP-2" },
      },
    ]);
  });

  test("tag polling uses the workspace endpoint and the exact tag/update filters", async () => {
    const requests: string[] = [];
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      requests.push(String(input));
      return jsonResponse({
        tasks: [
          {
            id: "api-1",
            custom_id: "NDP-34603",
            date_updated: "1770000000000",
            tags: [{ name: "software-teams" }],
          },
        ],
      });
    };

    const tasks = await listClickUpTaggedTasks(
      {
        workspaceId: "36826178",
        tag: "software-teams",
        updatedAfterMs: 1760000000000,
        listIds: ["list-a", "list-b"],
        includeClosed: false,
      },
      { apiToken: "pk_test" },
      fakeFetch,
    );

    const url = new URL(requests[0]!);
    expect(url.pathname).toBe("/api/v2/team/36826178/task");
    expect(url.searchParams.getAll("tags[]")).toEqual(["software-teams"]);
    expect(url.searchParams.getAll("list_ids[]")).toEqual(["list-a", "list-b"]);
    expect(url.searchParams.get("date_updated_gt")).toBe("1760000000000");
    expect(url.searchParams.get("order_by")).toBe("updated");
    expect(url.searchParams.get("reverse")).toBe("false");
    expect(tasks[0]).toEqual({
      apiId: "api-1",
      id: "NDP-34603",
      workspaceId: "36826178",
      updatedAtMs: 1770000000000,
    });
  });

  test("manual probe requests newest-first ordering", async () => {
    const requests: URL[] = [];
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      requests.push(new URL(String(input)));
      return jsonResponse({ tasks: [] });
    };
    await listClickUpTaggedTasks(
      { workspaceId: "36826178", tag: "software-teams", includeClosed: false, reverse: true },
      { apiToken: "pk_test" },
      fakeFetch,
    );
    expect(requests[0]?.searchParams.get("order_by")).toBe("updated");
    expect(requests[0]?.searchParams.get("reverse")).toBe("true");
  });

  test("tag polling crosses ClickUp's 100-task page boundary", async () => {
    const pages: string[] = [];
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page") ?? "0";
      pages.push(page);
      const count = page === "0" ? 100 : 1;
      return jsonResponse({
        tasks: Array.from({ length: count }, (_, index) => ({
          id: `${page}-${index}`,
          date_updated: String(1770000000000 + Number(page) * 100 + index),
        })),
      });
    };

    const tasks = await listClickUpTaggedTasks(
      { workspaceId: "36826178", tag: "software-teams", includeClosed: false },
      { apiToken: "pk_test" },
      fakeFetch,
    );
    expect(pages).toEqual(["0", "1"]);
    expect(tasks).toHaveLength(101);
  });

  test("refuses a bounded watermark when ClickUp does not honor ascending order", async () => {
    const fakeFetch = async (): Promise<Response> =>
      jsonResponse({
        tasks: [
          { id: "newer", date_updated: "2000" },
          { id: "older", date_updated: "1000" },
        ],
      });
    expect(
      listClickUpTaggedTasks(
        {
          workspaceId: "36826178",
          tag: "software-teams",
          includeClosed: false,
          maxTasks: 1,
        },
        { apiToken: "pk_test" },
        fakeFetch,
      ),
    ).rejects.toThrow("refusing to advance the poll watermark");
  });

  test("stops paging once a bounded unseen-task batch is full", async () => {
    const pages: string[] = [];
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page") ?? "0";
      pages.push(page);
      return jsonResponse({
        tasks: Array.from({ length: 100 }, (_, index) => ({
          id: `${page}-${index}`,
          date_updated: String(1770000000000 + Number(page) * 100 + index),
        })),
      });
    };

    const tasks = await listClickUpTaggedTasks(
      {
        workspaceId: "36826178",
        tag: "software-teams",
        includeClosed: false,
        maxTasks: 5,
        excludeApiIds: ["0-0", "0-1"],
      },
      { apiToken: "pk_test" },
      fakeFetch,
    );
    expect(pages).toEqual(["0"]);
    expect(tasks.map((task) => task.apiId)).toEqual(["0-2", "0-3", "0-4", "0-5", "0-6"]);
  });

  test("rejects plaintext remote API origins before sending the token", async () => {
    expect(
      fetchClickUpSupportTicket(
        { taskId: "NDP-34603" },
        { apiToken: "pk_secret", apiBase: "http://clickup-proxy.example" },
      ),
    ).rejects.toThrow("must use HTTPS");
  });

  test("one inaccessible ticket becomes a recoverable error item without raw secrets", () => {
    const envelope = createClickUpFetchErrorEnvelope(
      { apiId: "opaque", id: "NDP-34603", workspaceId: "36826178", updatedAtMs: 1770000000000 },
      {
        prompt: "Triage",
        agentId: "software-teams-support-triage",
        budgetUsd: 1,
        message: "ClickUp API request failed with HTTP 404",
        now: "2026-06-15T12:00:00.000Z",
      },
    );
    expect(envelope.status).toBe("error");
    expect(envelope.result.text).toBe("ClickUp API request failed with HTTP 404");
    expect(envelope.audit?.at(-1)?.action).toBe("ticket-ingestion-failed");
    expect(JSON.stringify(envelope)).not.toContain("pk_secret");
  });

  test("API failures are loud but never include response bodies or credentials", async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response("token pk_secret rejected: internal details", { status: 401 });

    expect(
      fetchClickUpSupportTicket(
        { taskId: "NDP-34603", teamId: "36826178" },
        { apiToken: "pk_secret" },
        fakeFetch,
      ),
    ).rejects.toThrow("ClickUp API request failed with HTTP 401");
  });
});
