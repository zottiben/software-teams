import { describe, test, expect, mock, beforeEach } from "bun:test";
import { isPullRequest, fetchPrLinkedIssues } from "../github";

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
