import { describe, test, expect, afterEach, mock, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parsePlanFrontmatter,
  findPlansForIssues,
  deletePlanAndTasks,
  prunePlans,
} from "../prune-plans";

let tempDir: string;
function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-prune-"));
  return tempDir;
}

function seedPlan(plansDir: string, slug: string, fm: Record<string, unknown>, tasks: number[] = []) {
  mkdirSync(plansDir, { recursive: true });
  const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
  writeFileSync(join(plansDir, `${slug}.plan.md`), `---\n${fmLines}\n---\n\n# Plan\n`);
  for (const n of tasks) {
    writeFileSync(join(plansDir, `${slug}.T${n}.md`), `# Task ${n}\n`);
  }
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("parsePlanFrontmatter", () => {
  test("returns parsed YAML object from a leading --- block", () => {
    const fm = parsePlanFrontmatter("---\nissue: 42\nrepo: a/b\n---\n\nBody\n");
    expect(fm).toEqual({ issue: 42, repo: "a/b" });
  });

  test("returns null when no frontmatter block is present", () => {
    expect(parsePlanFrontmatter("# Plain markdown\n\nNo block.")).toBeNull();
  });

  test("returns null when the YAML is malformed (does not throw)", () => {
    expect(parsePlanFrontmatter("---\n: : :\n---\n")).toBeNull();
  });
});

describe("findPlansForIssues", () => {
  test("returns only plans whose `issue:` matches one of the supplied numbers", () => {
    const base = makeTempDir();
    const plans = join(base, "plans");
    seedPlan(plans, "p1-target", { issue: 42, repo: "a/b" });
    seedPlan(plans, "p2-other", { issue: 99, repo: "a/b" });
    seedPlan(plans, "p3-untagged", { task_files: "[]" });

    const matches = findPlansForIssues(plans, [42]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEndWith("p1-target.plan.md");
  });

  test("returns [] for empty issue list or missing plans dir", () => {
    const base = makeTempDir();
    expect(findPlansForIssues(join(base, "plans"), [42])).toEqual([]);
    const plans = join(base, "plans");
    seedPlan(plans, "x", { issue: 1 });
    expect(findPlansForIssues(plans, [])).toEqual([]);
  });

  test("coerces string `issue:` values to numbers", () => {
    const base = makeTempDir();
    const plans = join(base, "plans");
    seedPlan(plans, "string-tag", { issue: '"42"', repo: "a/b" });
    expect(findPlansForIssues(plans, [42])).toHaveLength(1);
  });
});

describe("deletePlanAndTasks", () => {
  test("removes the .plan.md and all sibling .T{n}.md files", () => {
    const base = makeTempDir();
    const plans = join(base, "plans");
    seedPlan(plans, "x", { issue: 1 }, [1, 2, 3]);
    seedPlan(plans, "y", { issue: 2 }, [1]); // unrelated plan must survive

    const removed = deletePlanAndTasks(plans, join(plans, "x.plan.md"));
    expect(removed.sort()).toEqual(
      [
        join(plans, "x.plan.md"),
        join(plans, "x.T1.md"),
        join(plans, "x.T2.md"),
        join(plans, "x.T3.md"),
      ].sort(),
    );
    expect(existsSync(join(plans, "x.plan.md"))).toBe(false);
    expect(existsSync(join(plans, "y.plan.md"))).toBe(true);
    expect(existsSync(join(plans, "y.T1.md"))).toBe(true);
  });
});

describe("prunePlans", () => {
  beforeEach(() => {
    // Reset Bun.spawn mock between tests
    spawnExit = 0;
    spawnStdout = "";
    spawnCalls.length = 0;
  });

  test("uses --issue-number directly without consulting `gh`", async () => {
    const base = makeTempDir();
    const plans = join(base, ".software-teams", "plans");
    seedPlan(plans, "p", { issue: 7, repo: "a/b" }, [1, 2]);

    const result = await prunePlans({ cwd: base, issueNumbers: [7] });

    expect(result.resolvedIssues).toEqual([7]);
    expect(result.removed).toHaveLength(3);
    expect(existsSync(join(plans, "p.plan.md"))).toBe(false);
    expect(spawnCalls).toHaveLength(0); // no `gh` invocations
  });

  test("falls back to PR linked-issue lookup when only --pr-number is given", async () => {
    const base = makeTempDir();
    const plans = join(base, ".software-teams", "plans");
    seedPlan(plans, "p", { issue: 11, repo: "a/b" });

    spawnStdout = "11\n"; // fetchPrLinkedIssues -> 11

    const result = await prunePlans({
      cwd: base,
      repo: "a/b",
      prNumber: 99,
      issueNumbers: [],
    });

    expect(result.resolvedIssues).toEqual([11]);
    expect(result.removed).toHaveLength(1);
    expect(spawnCalls[0]).toContain("gh");
    expect(spawnCalls[0]).toContain("pr");
  });

  test("no-ops cleanly when no issues resolve", async () => {
    const base = makeTempDir();
    const result = await prunePlans({ cwd: base, issueNumbers: [], prNumber: undefined });
    expect(result).toEqual({ resolvedIssues: [], removed: [], stateCleared: false });
  });

  test("clears `current_plan` in state.yaml when the removed plan was active", async () => {
    const base = makeTempDir();
    const plans = join(base, ".software-teams", "plans");
    seedPlan(plans, "active", { issue: 5, repo: "a/b" });

    const stateDir = join(base, ".software-teams");
    writeFileSync(
      join(stateDir, "state.yaml"),
      `current_plan:\n  path: .software-teams/plans/active.plan.md\n  tasks: []\n  completed_tasks: []\n  current_task_index: null\n`,
    );

    const result = await prunePlans({ cwd: base, issueNumbers: [5] });

    expect(result.stateCleared).toBe(true);
    const updated = readFileSync(join(stateDir, "state.yaml"), "utf8");
    expect(updated).toContain("path: null");
  });
});

// ── Mock Bun.spawn for prunePlans tests that hit fetchPrLinkedIssues ──
let spawnExit = 0;
let spawnStdout = "";
const spawnCalls: string[][] = [];
const originalSpawn = Bun.spawn;

beforeEach(() => {
  // @ts-expect-error - mocking
  Bun.spawn = mock((cmd: string[], _opts: any) => {
    spawnCalls.push(cmd);
    const encoder = new TextEncoder();
    return {
      stdout: new ReadableStream({
        start(c) {
          if (spawnStdout) c.enqueue(encoder.encode(spawnStdout));
          c.close();
        },
      }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(spawnExit),
    };
  });
});

process.on("beforeExit", () => {
  Bun.spawn = originalSpawn;
});
