import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertWithinBase,
  teardownWorktree,
  teardownClone,
  teardownAgentMemories,
  teardownPlanArtefacts,
} from "../teardown";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync: realExecSync } = require("node:child_process") as {
  execSync: (
    cmd: string,
    opts: { cwd: string; encoding: string; env: NodeJS.ProcessEnv },
  ) => string;
};

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(args: string, cwd: string): string {
  return realExecSync(`git ${args}`, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
  }).trim();
}

// ── Shared fixture root ───────────────────────────────────────────────────────

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "st-teardown-test-"));
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

// ── assertWithinBase ──────────────────────────────────────────────────────────

describe("assertWithinBase", () => {
  test("accepts a path strictly inside the base", () => {
    expect(() =>
      assertWithinBase(join(fixtureRoot, "child"), fixtureRoot),
    ).not.toThrow();
  });

  test("accepts a deeply nested path inside the base", () => {
    expect(() =>
      assertWithinBase(join(fixtureRoot, "a", "b", "c"), fixtureRoot),
    ).not.toThrow();
  });

  test("rejects the base directory itself", () => {
    expect(() => assertWithinBase(fixtureRoot, fixtureRoot)).toThrow(
      /base directory itself/,
    );
  });

  test("rejects a path outside the base", () => {
    expect(() => assertWithinBase("/tmp/other", fixtureRoot)).toThrow(
      /outside base/,
    );
  });

  test("rejects a path that traverses above the base", () => {
    expect(() =>
      assertWithinBase(join(fixtureRoot, "..", "escape"), fixtureRoot),
    ).toThrow(/outside base/);
  });

  test("rejects root path /", () => {
    expect(() => assertWithinBase("/", fixtureRoot)).toThrow();
  });
});

// ── teardownClone ─────────────────────────────────────────────────────────────

describe("teardownClone", () => {
  test("removes an existing clone directory", () => {
    const cloneDir = join(fixtureRoot, "runs", "clone-1");
    mkdirSync(cloneDir, { recursive: true });
    writeFileSync(join(cloneDir, "file.txt"), "data");

    const result = teardownClone(cloneDir, join(fixtureRoot, "runs"));
    expect(result.removed).toBe(true);
    expect(existsSync(cloneDir)).toBe(false);
  });

  test("returns removed:false when clone path does not exist", () => {
    const cloneDir = join(fixtureRoot, "runs", "nonexistent");
    const result = teardownClone(cloneDir, join(fixtureRoot, "runs"));
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("does not exist");
  });

  test("is idempotent — second call is a no-op", () => {
    const cloneDir = join(fixtureRoot, "runs", "clone-idem");
    mkdirSync(cloneDir, { recursive: true });

    const first = teardownClone(cloneDir, join(fixtureRoot, "runs"));
    expect(first.removed).toBe(true);

    const second = teardownClone(cloneDir, join(fixtureRoot, "runs"));
    expect(second.removed).toBe(false);
  });

  test("refuses to delete outside runs base dir", () => {
    expect(() => teardownClone("/tmp/evil", fixtureRoot + "/runs")).toThrow(
      /outside base/,
    );
  });

  test("refuses to delete the base dir itself", () => {
    const runsBase = join(fixtureRoot, "runs2");
    mkdirSync(runsBase, { recursive: true });
    expect(() => teardownClone(runsBase, runsBase)).toThrow(
      /base directory itself/,
    );
  });
});

// ── teardownAgentMemories ─────────────────────────────────────────────────────

describe("teardownAgentMemories", () => {
  test("removes files matching the correlationId", () => {
    const memBase = join(fixtureRoot, "memories-1");
    mkdirSync(memBase, { recursive: true });
    writeFileSync(join(memBase, "abc123-agent-backend.md"), "memory");
    writeFileSync(join(memBase, "abc123-agent-frontend.md"), "memory");
    writeFileSync(join(memBase, "other-run.md"), "keep");

    const result = teardownAgentMemories("abc123", memBase);
    expect(result.removed).toBe(true);
    expect(result.detail).toContain("2/2");
    expect(existsSync(join(memBase, "abc123-agent-backend.md"))).toBe(false);
    expect(existsSync(join(memBase, "abc123-agent-frontend.md"))).toBe(false);
    expect(existsSync(join(memBase, "other-run.md"))).toBe(true);
  });

  test("removes directories matching the correlationId", () => {
    const memBase = join(fixtureRoot, "memories-2");
    const subDir = join(memBase, "abc456");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "data.json"), "{}");

    const result = teardownAgentMemories("abc456", memBase);
    expect(result.removed).toBe(true);
    expect(existsSync(subDir)).toBe(false);
  });

  test("returns removed:false when no matches exist", () => {
    const memBase = join(fixtureRoot, "memories-3");
    mkdirSync(memBase, { recursive: true });
    writeFileSync(join(memBase, "unrelated.md"), "data");

    const result = teardownAgentMemories("xyz999", memBase);
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("no matching");
  });

  test("returns removed:false when memories base does not exist", () => {
    const result = teardownAgentMemories(
      "abc123",
      join(fixtureRoot, "no-such-dir"),
    );
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("does not exist");
  });

  test("is idempotent — second call is a no-op", () => {
    const memBase = join(fixtureRoot, "memories-4");
    mkdirSync(memBase, { recursive: true });
    writeFileSync(join(memBase, "run-dup.md"), "data");

    const first = teardownAgentMemories("run-dup", memBase);
    expect(first.removed).toBe(true);

    const second = teardownAgentMemories("run-dup", memBase);
    expect(second.removed).toBe(false);
  });

  test("returns removed:false for empty correlationId", () => {
    const result = teardownAgentMemories("", fixtureRoot);
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("empty");
  });
});

// ── teardownPlanArtefacts ─────────────────────────────────────────────────────

describe("teardownPlanArtefacts", () => {
  test("removes files whose name includes the correlationId", () => {
    const plansDir = join(fixtureRoot, "plans-1");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "1-01-corr123.T1.md"), "task");
    writeFileSync(join(plansDir, "1-01-corr123.spec.md"), "spec");
    writeFileSync(join(plansDir, "2-01-other.T1.md"), "keep");

    const result = teardownPlanArtefacts("corr123", plansDir);
    expect(result.removed).toBe(true);
    expect(result.detail).toContain("2/2");
    expect(existsSync(join(plansDir, "1-01-corr123.T1.md"))).toBe(false);
    expect(existsSync(join(plansDir, "1-01-corr123.spec.md"))).toBe(false);
    expect(existsSync(join(plansDir, "2-01-other.T1.md"))).toBe(true);
  });

  test("removes a subdirectory named after the correlationId", () => {
    const plansDir = join(fixtureRoot, "plans-2");
    const subDir = join(plansDir, "run-abc789");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "task.md"), "data");

    const result = teardownPlanArtefacts("run-abc789", plansDir);
    expect(result.removed).toBe(true);
    expect(existsSync(subDir)).toBe(false);
  });

  test("never deletes the plans directory itself", () => {
    const plansDir = join(fixtureRoot, "plans-3");
    mkdirSync(plansDir, { recursive: true });

    const result = teardownPlanArtefacts("nonexistent", plansDir);
    expect(result.removed).toBe(false);
    expect(existsSync(plansDir)).toBe(true);
  });

  test("refuses paths outside the plans base", () => {
    // correlationId that would try to escape is caught by assertWithinBase
    expect(() =>
      teardownPlanArtefacts("../../escape", join(fixtureRoot, "plans-safe")),
    ).toThrow(/outside base/);
  });

  test("returns removed:false when plans dir does not exist", () => {
    const result = teardownPlanArtefacts(
      "abc",
      join(fixtureRoot, "no-plans-dir"),
    );
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("does not exist");
  });

  test("is idempotent — second call is a no-op", () => {
    const plansDir = join(fixtureRoot, "plans-4");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "dup-run.T1.md"), "data");

    const first = teardownPlanArtefacts("dup-run", plansDir);
    expect(first.removed).toBe(true);

    const second = teardownPlanArtefacts("dup-run", plansDir);
    expect(second.removed).toBe(false);
  });

  test("returns removed:false for empty correlationId", () => {
    const result = teardownPlanArtefacts("", fixtureRoot);
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("empty");
  });
});

// ── teardownWorktree ──────────────────────────────────────────────────────────

describe("teardownWorktree", () => {
  let repoDir: string;

  beforeAll(() => {
    // Create a minimal git repo for worktree tests
    repoDir = join(fixtureRoot, "wt-repo");
    mkdirSync(repoDir, { recursive: true });
    git("init", repoDir);
    writeFileSync(join(repoDir, "README.md"), "init");
    git("add --all", repoDir);
    git('commit -m "initial"', repoDir);
  });

  test("returns removed:false when worktree path does not exist", async () => {
    const result = await teardownWorktree(
      repoDir,
      join(repoDir, "worktrees", "nonexistent"),
    );
    expect(result.removed).toBe(false);
    expect(result.detail).toContain("does not exist");
  });

  test("removes an existing worktree and returns removed:true", async () => {
    const wtPath = join(repoDir, "worktrees", "agent-test");
    git(
      `worktree add -b wt/test-branch -- ${wtPath} HEAD`,
      repoDir,
    );
    expect(existsSync(wtPath)).toBe(true);

    const result = await teardownWorktree(repoDir, wtPath);
    expect(result.removed).toBe(true);
    expect(existsSync(wtPath)).toBe(false);
  });

  test("is idempotent — second call returns removed:false", async () => {
    const wtPath = join(repoDir, "worktrees", "agent-idem");
    git(
      `worktree add -b wt/idem-branch -- ${wtPath} HEAD`,
      repoDir,
    );

    const first = await teardownWorktree(repoDir, wtPath);
    expect(first.removed).toBe(true);

    const second = await teardownWorktree(repoDir, wtPath);
    expect(second.removed).toBe(false);
  });
});
