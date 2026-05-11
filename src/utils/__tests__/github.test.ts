import { describe, test, expect, mock, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPullRequest,
  fetchPrLinkedIssues,
  formatSoftwareTeamsComment,
  formatErrorComment,
  findPrTemplate,
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

process.on("beforeExit", () => {
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
