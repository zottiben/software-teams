import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPullRequest,
  fetchPrLinkedIssues,
  formatSoftwareTeamsComment,
  formatErrorComment,
  findPrTemplate,
  buildConversationContext,
  ASSISTANT_COMMENT_MARKER,
} from "../github";

let spawnCalls: Array<{ cmd: string[] }> = [];
let mockExitCode = 0;
let mockStdout = "";

const originalSpawn = Bun.spawn;
beforeEach(() => {
  spawnCalls = [];
  mockExitCode = 0;
  mockStdout = "";
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock((cmd: string[], _opts: any) => {
    spawnCalls.push({ cmd });
    const encoder = new TextEncoder();
    return {
      stdout: new ReadableStream({
        start(c) {
          if (mockStdout) c.enqueue(encoder.encode(mockStdout));
          c.close();
        },
      }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(mockExitCode),
    };
  });
});

afterAll(() => {
  Bun.spawn = originalSpawn;
});

describe("isPullRequest", () => {
  test("returns true when `gh api repos/.../pulls/N` exits 0", async () => {
    mockExitCode = 0;
    expect(await isPullRequest("zottiben/test-project-one", 42)).toBe(true);
    expect(spawnCalls[0].cmd).toEqual([
      "gh", "api",
      "repos/zottiben/test-project-one/pulls/42",
      "--silent",
    ]);
  });

  test("returns false when the API call fails (issue, not PR)", async () => {
    mockExitCode = 1;
    expect(await isPullRequest("zottiben/test-project-one", 36)).toBe(false);
  });

  test("returns false short-circuit when repo or number is empty", async () => {
    expect(await isPullRequest("", 36)).toBe(false);
    expect(await isPullRequest("z/x", 0)).toBe(false);
    expect(spawnCalls.length).toBe(0);
  });
});

describe("fetchPrLinkedIssues", () => {
  test("parses one issue per line from gh pr view output", async () => {
    mockStdout = "37\n42\n";
    const result = await fetchPrLinkedIssues("zottiben/test-project-one", 12);
    expect(result).toEqual([37, 42]);
    expect(spawnCalls[0].cmd).toEqual([
      "gh", "pr", "view", "12",
      "--repo", "zottiben/test-project-one",
      "--json", "closingIssuesReferences",
      "--jq", ".closingIssuesReferences[].number",
    ]);
  });

  test("returns [] when the PR has no linked issues", async () => {
    mockStdout = "";
    const result = await fetchPrLinkedIssues("z/r", 1);
    expect(result).toEqual([]);
  });

  test("returns [] when the gh call fails (non-zero exit)", async () => {
    mockExitCode = 1;
    mockStdout = "some error";
    const result = await fetchPrLinkedIssues("z/r", 1);
    expect(result).toEqual([]);
  });

  test("filters out non-numeric or zero values defensively", async () => {
    mockStdout = "37\nnot-a-number\n0\n99\n";
    const result = await fetchPrLinkedIssues("z/r", 1);
    expect(result).toEqual([37, 99]);
  });

  test("returns [] short-circuit on empty repo or pr number", async () => {
    expect(await fetchPrLinkedIssues("", 12)).toEqual([]);
    expect(await fetchPrLinkedIssues("z/r", 0)).toEqual([]);
    expect(spawnCalls.length).toBe(0);
  });
});

describe("formatSoftwareTeamsComment (discreet headers)", () => {
  test("plan command produces a chat-like header with no 'Software Teams' brand", () => {
    const out = formatSoftwareTeamsComment("plan", "all done");
    expect(out).toContain("🔮 Plan is ready!");
    expect(out).not.toContain("Software Teams");
  });

  test("every known command maps to its chat-like header", () => {
    expect(formatSoftwareTeamsComment("implement", "")).toContain("▶ Implementation done!");
    expect(formatSoftwareTeamsComment("quick", "")).toContain("⚡ Quick fix done!");
    expect(formatSoftwareTeamsComment("review", "")).toContain("💠 Review complete");
    expect(formatSoftwareTeamsComment("feedback", "")).toContain("🌀 Feedback addressed");
    expect(formatSoftwareTeamsComment("ping", "")).toContain("🔹 Status");
    expect(formatSoftwareTeamsComment("auth", "")).toContain("🚫 Access denied");
  });

  test("`questions` command header is set for the headless ambiguity gate (phase C)", () => {
    const out = formatSoftwareTeamsComment("questions", "Q1\nQ2");
    expect(out).toContain("🔮 A few questions before I plan");
    expect(out).toContain("Q1");
    expect(out).not.toContain("Software Teams");
  });

  test("unknown command falls back to neutral 'Done' header (still no brand leak)", () => {
    const out = formatSoftwareTeamsComment("nope", "");
    expect(out).toContain("◈ Done");
    expect(out).not.toContain("Software Teams");
  });

  test("every comment carries the invisible HTML marker for thread detection", () => {
    expect(formatSoftwareTeamsComment("plan", "body")).toContain(ASSISTANT_COMMENT_MARKER);
    expect(formatErrorComment("plan", "body")).toContain(ASSISTANT_COMMENT_MARKER);
  });

  test("error comments use the per-command failure copy", () => {
    expect(formatErrorComment("plan", "")).toContain("🔮 Plan didn't work out");
    expect(formatErrorComment("implement", "")).toContain("▶ Implementation didn't go through");
    expect(formatErrorComment("auth", "")).toContain("🚫 Access denied");
    expect(formatErrorComment("plan", "")).not.toContain("Software Teams");
  });
});

describe("findPrTemplate", () => {
  let tempDir: string;
  function fixture(): string {
    tempDir = mkdtempSync(join(tmpdir(), "pr-tpl-"));
    return tempDir;
  }
  function cleanup() {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }

  test("locates `.github/PULL_REQUEST_TEMPLATE.md` (canonical path)", () => {
    const cwd = fixture();
    try {
      mkdirSync(join(cwd, ".github"), { recursive: true });
      writeFileSync(join(cwd, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Summary\n\n<!-- describe -->\n");
      const result = findPrTemplate(cwd);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(".github/PULL_REQUEST_TEMPLATE.md");
      expect(result!.body).toContain("## Summary");
    } finally {
      cleanup();
    }
  });

  test("falls back to root-level `PULL_REQUEST_TEMPLATE.md`", () => {
    const cwd = fixture();
    try {
      writeFileSync(join(cwd, "PULL_REQUEST_TEMPLATE.md"), "root template\n");
      expect(findPrTemplate(cwd)?.path).toBe("PULL_REQUEST_TEMPLATE.md");
    } finally {
      cleanup();
    }
  });

  test("falls back to `docs/PULL_REQUEST_TEMPLATE.md`", () => {
    const cwd = fixture();
    try {
      mkdirSync(join(cwd, "docs"), { recursive: true });
      writeFileSync(join(cwd, "docs", "PULL_REQUEST_TEMPLATE.md"), "docs template\n");
      expect(findPrTemplate(cwd)?.path).toBe("docs/PULL_REQUEST_TEMPLATE.md");
    } finally {
      cleanup();
    }
  });

  test("returns null when no template exists at any canonical path", () => {
    const cwd = fixture();
    try {
      expect(findPrTemplate(cwd)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("skips empty / whitespace-only template files", () => {
    const cwd = fixture();
    try {
      mkdirSync(join(cwd, ".github"), { recursive: true });
      writeFileSync(join(cwd, ".github", "PULL_REQUEST_TEMPLATE.md"), "   \n\n");
      writeFileSync(join(cwd, "PULL_REQUEST_TEMPLATE.md"), "real template\n");
      // First match is empty → falls through to the root-level fallback.
      expect(findPrTemplate(cwd)?.path).toBe("PULL_REQUEST_TEMPLATE.md");
    } finally {
      cleanup();
    }
  });

  test("returns the FIRST match when multiple templates exist (priority order)", () => {
    const cwd = fixture();
    try {
      mkdirSync(join(cwd, ".github"), { recursive: true });
      writeFileSync(join(cwd, ".github", "PULL_REQUEST_TEMPLATE.md"), "canonical\n");
      writeFileSync(join(cwd, "PULL_REQUEST_TEMPLATE.md"), "root\n");
      expect(findPrTemplate(cwd)?.path).toBe(".github/PULL_REQUEST_TEMPLATE.md");
    } finally {
      cleanup();
    }
  });
});

describe("buildConversationContext — assistant-anchored bridge (regression guard for Phase C loop)", () => {
  // Earlier the segment collector only entered "inConversation" mode when
  // a user comment matched `/hey\s+software[\s-]?teams/i`. Phase C posts
  // a `🔮 A few questions before I plan` comment whose body never
  // contains that phrase (discreet mode), so the prior assistant comment
  // was silently dropped from the bridged history. The researcher saw
  // an empty thread on the follow-up run and started from scratch,
  // producing the "answers ignored, new questions asked" loop. The
  // fix: assistant comments (detected via the marker) also start the
  // conversation. These tests pin that contract.

  const assistantComment = (id: number, body: string) => ({
    id,
    author: "github-actions[bot]",
    body,
    createdAt: `2026-05-13T0${id}:00:00Z`,
    isSoftwareTeams: true,
  });
  const userComment = (id: number, author: string, body: string) => ({
    id,
    author,
    body,
    createdAt: `2026-05-13T0${id}:00:00Z`,
    isSoftwareTeams: false,
  });

  test("recognises an assistant questions comment as the conversation anchor", () => {
    const thread = [
      assistantComment(1, "<!-- st-action -->\n🔮 A few questions before I plan\n\n- Q1\n- Q2"),
      userComment(2, "alice", "Hey Software Teams\n\nA1\nA2"),
    ];
    const triggerCommentId = 2; // the user's reply triggered the run
    const result = buildConversationContext(thread, triggerCommentId);
    expect(result.isFollowUp).toBe(true);
    expect(result.previousRuns).toBe(1);
    expect(result.history).toContain("Q1");
    expect(result.history).toContain("Q2");
    expect(result.history).toContain("AI assistant");
  });

  test("still recognises the legacy `Hey software-teams` trigger phrase (back-compat)", () => {
    const thread = [
      userComment(1, "alice", "Hey software-teams plan something"),
      assistantComment(2, "<!-- st-action -->\n🔮 Plan is ready!\n\nbody"),
      userComment(3, "alice", "Hey software-teams refine task 2"),
    ];
    const triggerCommentId = 3;
    const result = buildConversationContext(thread, triggerCommentId);
    expect(result.isFollowUp).toBe(true);
    expect(result.previousRuns).toBe(1);
  });

  test("returns empty when the thread has only the triggering comment (fresh start)", () => {
    const thread = [userComment(1, "alice", "Hey Software Teams plan something fresh")];
    const result = buildConversationContext(thread, 1);
    expect(result.isFollowUp).toBe(false);
    expect(result.previousRuns).toBe(0);
    expect(result.history).toBe("");
  });

  test("includes user follow-ups between the assistant anchor and the trigger comment", () => {
    const thread = [
      assistantComment(1, "<!-- st-action -->\n🔮 A few questions before I plan\n\n- Q1"),
      userComment(2, "alice", "answer to Q1"),
      userComment(3, "alice", "Hey Software Teams here's one more answer"),
    ];
    const triggerCommentId = 3;
    const result = buildConversationContext(thread, triggerCommentId);
    expect(result.history).toContain("answer to Q1");
  });

  test("ignores comments that come BEFORE the assistant conversation anchor", () => {
    // Random unrelated chatter from before the assistant even arrived
    // should NOT pollute the bridged context.
    const thread = [
      userComment(1, "bob", "fyi I noticed something weird about this repo"),
      userComment(2, "alice", "yeah let's see what software teams thinks"),
      assistantComment(3, "<!-- st-action -->\n🔮 A few questions before I plan\n\n- Q1"),
      userComment(4, "alice", "Hey Software Teams answer to Q1"),
    ];
    const triggerCommentId = 4;
    const result = buildConversationContext(thread, triggerCommentId);
    expect(result.history).not.toContain("noticed something weird");
    expect(result.history).not.toContain("let's see what software teams thinks");
    expect(result.history).toContain("Q1");
  });

  test("detects post-implementation state via new `Implementation done!` header", () => {
    const thread = [
      assistantComment(1, "<!-- st-action -->\n🔮 Plan is ready!\n\n..."),
      assistantComment(2, "<!-- st-action -->\n▶ Implementation done!\n\nshipped"),
      userComment(3, "alice", "Hey Software Teams tweak the colour"),
    ];
    const triggerCommentId = 3;
    const result = buildConversationContext(thread, triggerCommentId);
    expect(result.isPostImplementation).toBe(true);
  });
});
