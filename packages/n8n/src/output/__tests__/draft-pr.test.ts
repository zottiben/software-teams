import { describe, test, expect, mock, afterEach } from "bun:test";

// Capture what actually reaches the GitHub API, because `draft` is the whole
// point of a stacked run: a slice PR that reads as ready-to-merge before the
// review loop has passed is worse than no PR at all.
const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
const realFetch = globalThis.fetch;

function stubFetch(status = 201) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      path: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({ html_url: "https://github.com/o/r/pull/7", number: 7 }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const { createPullRequest } = await import("../github");

const base = {
  owner: "positivegroup",
  repo: "nodifi-data",
  title: "slice: quotes",
  body: "body",
  head: "feat/st-abc123-slice-1",
  base: "epic/st-abc123",
  token: "gh-token",
};

describe("createPullRequest draft handling", () => {
  test("sends draft true when requested", async () => {
    stubFetch();
    await createPullRequest({ ...base, draft: true });
    expect(calls[0]!.body["draft"]).toBe(true);
  });

  test("omits draft entirely when not requested", async () => {
    stubFetch();
    await createPullRequest({ ...base, draft: false });
    // Not `draft: false` - some GitHub plans reject the field outright, so
    // sending it unconditionally would break PR creation on those repos.
    expect("draft" in calls[0]!.body).toBe(false);
  });

  test("omits draft when the flag is absent", async () => {
    stubFetch();
    await createPullRequest(base);
    expect("draft" in calls[0]!.body).toBe(false);
  });

  test("still targets the requested base branch", async () => {
    stubFetch();
    await createPullRequest({ ...base, draft: true });
    expect(calls[0]!.body["base"]).toBe("epic/st-abc123");
    expect(calls[0]!.body["head"]).toBe("feat/st-abc123-slice-1");
  });

  test("surfaces a GitHub error rather than reporting a PR", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ message: "Draft pull requests are not supported" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(createPullRequest({ ...base, draft: true })).rejects.toThrow(
      /Draft pull requests are not supported/,
    );
  });
});
