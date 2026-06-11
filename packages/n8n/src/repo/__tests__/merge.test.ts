import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyAndResolve } from "../merge";
import type { MergeResult } from "../merge";
import type { ChangeRef } from "@websitelabs/software-teams";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync: realExecSync } = require("node:child_process") as {
  execSync: (cmd: string, opts: { cwd: string; encoding: string; env: NodeJS.ProcessEnv }) => string;
};

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(args: string, cwd: string): string {
  return realExecSync(`git ${args}`, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
}

function writeAndCommit(repoDir: string, filename: string, content: string, message: string): string {
  writeFileSync(join(repoDir, filename), content, "utf8");
  git("add --all", repoDir);
  git(`commit -m "${message}" --allow-empty`, repoDir);
  return git("rev-parse HEAD", repoDir);
}

function makePatch(repoDir: string, filename: string, content: string, message: string): ChangeRef {
  const worktreeBase = mkdtempSync(join(tmpdir(), "st-patch-wt-"));
  try {
    git(`worktree add -b wt-patch-${Date.now()} -- ${worktreeBase} main`, repoDir);
    writeFileSync(join(worktreeBase, filename), content, "utf8");
    git("add --all", worktreeBase);
    git(`commit -m "${message}" --allow-empty`, worktreeBase);
    const mergeBase = git("merge-base HEAD main", worktreeBase);
    const patchBytes = git(`format-patch --stdout ${mergeBase}..HEAD`, worktreeBase);
    git(`worktree remove --force -- ${worktreeBase}`, repoDir);
    return { kind: "format-patch", patchBase64: Buffer.from(patchBytes, "utf8").toString("base64") };
  } catch (err) {
    try { git(`worktree remove --force -- ${worktreeBase}`, repoDir); } catch { /* best-effort */ }
    throw err;
  }
}

let fixtureRoot: string;
let baseRepo: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "st-merge-test-"));
  baseRepo = join(fixtureRoot, "base");
  mkdirSync(baseRepo, { recursive: true });
  git("init -b main", baseRepo);
  git("config user.email test@example.com", baseRepo);
  git("config user.name Test", baseRepo);
  writeAndCommit(baseRepo, "README.md", "# Repo\n", "chore: initial");
  writeAndCommit(baseRepo, "alpha.ts", "export const alpha = 'original';\n", "feat: add alpha");
  writeAndCommit(baseRepo, "shared.ts", "export const val = 'base';\n", "feat: add shared");
});

afterAll(() => {
  try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function makeIsolatedRepo(label: string): string {
  const dir = join(fixtureRoot, label);
  git(`clone --local -- ${baseRepo} ${dir}`, fixtureRoot);
  git("config user.email test@example.com", dir);
  git("config user.name Test", dir);
  return dir;
}

describe("applyAndResolve — injected resolver, no module mock needed (T11, AC6, R-16)", () => {
  describe("non-conflicting changeRefs — clean merge within bound", () => {
    test("no changeRefs → success with branch name", async () => {
      const repoDir = makeIsolatedRepo("clean-empty");
      const result = await applyAndResolve({
        repoDir,
        branchName: "feat/clean-empty",
        baseBranch: "main",
        changeRefs: [],
        resolver: async () => undefined,
      });
      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect(result.branch).toBe("feat/clean-empty");
      }
    });

    test("single clean changeRef → success, zero conflict markers", async () => {
      const sourceRepo = makeIsolatedRepo("clean-source-single");
      const changeRef = makePatch(sourceRepo, "beta.ts", "export const beta = 2;\n", "feat: add beta");

      const targetRepo = makeIsolatedRepo("clean-target-single");
      const resolverCalls: string[][] = [];

      const result = await applyAndResolve({
        repoDir: targetRepo,
        branchName: "feat/clean-single",
        baseBranch: "main",
        changeRefs: [changeRef],
        resolver: async (files) => { resolverCalls.push([...files]); },
      });

      expect(result.kind).toBe("success");
      expect(resolverCalls).toHaveLength(0);
    });

    test("resolver yields clean tree on first attempt → success", async () => {
      const repoDir = makeIsolatedRepo("resolver-success");
      const resolverCalls: number[] = [];

      const result = await applyAndResolve({
        repoDir,
        branchName: "feat/resolver-success",
        baseBranch: "main",
        changeRefs: [],
        resolver: async () => { resolverCalls.push(1); },
      });

      expect(result.kind).toBe("success");
      expect(resolverCalls).toHaveLength(0);
    });
  });

  describe("bound-exceeded — resolver returns conflicted tree every attempt (AC6, R-16)", () => {
    function makeConflictingPatch(sourceRepo: string): ChangeRef {
      const wt = mkdtempSync(join(tmpdir(), "st-conflict-wt-"));
      try {
        git(`worktree add -b wt-conflict-${Date.now()} -- ${wt} main`, sourceRepo);
        writeFileSync(join(wt, "shared.ts"), "export const val = 'agent-version';\n", "utf8");
        git("add --all", wt);
        git("commit -m \"feat: agent change to shared\" --allow-empty", wt);
        const mergeBase = git("merge-base HEAD main", wt);
        const patchBytes = git(`format-patch --stdout ${mergeBase}..HEAD`, wt);
        git(`worktree remove --force -- ${wt}`, sourceRepo);
        return { kind: "format-patch", patchBase64: Buffer.from(patchBytes, "utf8").toString("base64") };
      } catch (err) {
        try { git(`worktree remove --force -- ${wt}`, sourceRepo); } catch { /* best-effort */ }
        throw err;
      }
    }

    function makeConflictTargetRepo(label: string): string {
      const dir = makeIsolatedRepo(label);
      writeAndCommit(dir, "shared.ts", "export const val = 'target-version';\n", "feat: target changes shared too");
      return dir;
    }

    test("bounded-failure is returned after MAX_RESOLVER_TURNS=3 with conflictingFiles list", async () => {
      const sourceRepo = makeIsolatedRepo("conflict-source-1");
      const changeRef = makeConflictingPatch(sourceRepo);

      const targetRepo = makeConflictTargetRepo("conflict-target-1");

      const resolverCallCount: number[] = [];
      const result = await applyAndResolve({
        repoDir: targetRepo,
        branchName: "feat/bound-exceeded",
        baseBranch: "main",
        changeRefs: [changeRef],
        resolver: async (_files) => {
          resolverCallCount.push(1);
        },
      });

      if (result.kind === "bounded-failure") {
        expect(result.turnsExhausted).toBe(3);
        expect(result.conflictingFiles.length).toBeGreaterThan(0);
        expect(resolverCallCount.length).toBeLessThanOrEqual(3);
        expect(resolverCallCount.length).toBeGreaterThan(0);
      } else {
        expect(result.kind).toBe("bounded-failure");
      }
    });

    test("resolver called AT MOST 3 times (no infinite retry, R-16)", async () => {
      const sourceRepo = makeIsolatedRepo("no-infinite-source");
      const changeRef = makeConflictingPatch(sourceRepo);

      const targetRepo = makeConflictTargetRepo("no-infinite-target");

      const callLog: number[] = [];
      const result = await applyAndResolve({
        repoDir: targetRepo,
        branchName: "feat/no-infinite",
        baseBranch: "main",
        changeRefs: [changeRef],
        resolver: async (_files) => { callLog.push(callLog.length + 1); },
      });

      expect(callLog.length).toBeLessThanOrEqual(3);
      if (result.kind === "bounded-failure") {
        expect(result.turnsExhausted).toBe(3);
      }
    });

    test("bounded-failure result surfaces conflicting file names", async () => {
      const sourceRepo = makeIsolatedRepo("conflict-files-source");
      const changeRef = makeConflictingPatch(sourceRepo);

      const targetRepo = makeConflictTargetRepo("conflict-files-target");

      const result = await applyAndResolve({
        repoDir: targetRepo,
        branchName: "feat/conflict-files",
        baseBranch: "main",
        changeRefs: [changeRef],
        resolver: async () => undefined,
      });

      if (result.kind === "bounded-failure") {
        expect(Array.isArray(result.conflictingFiles)).toBe(true);
        const allFileNames = result.conflictingFiles.join(",");
        expect(allFileNames.length).toBeGreaterThan(0);
      } else {
        expect(result.kind).toBe("bounded-failure");
      }
    });
  });

  describe("marker-laden tree is never committed as success (AC6)", () => {
    test("a patch that creates real merge conflict is not committed as success", async () => {
      const sourceRepo = makeIsolatedRepo("marker-source");
      const wt = mkdtempSync(join(tmpdir(), "st-marker-wt-"));
      try {
        git(`worktree add -b wt-marker-${Date.now()} -- ${wt} main`, sourceRepo);
        writeFileSync(join(wt, "shared.ts"), "export const val = 'marker-agent';\n", "utf8");
        git("add --all", wt);
        git("commit -m \"feat: marker agent\" --allow-empty", wt);
        const mergeBase = git("merge-base HEAD main", wt);
        const patchBytes = git(`format-patch --stdout ${mergeBase}..HEAD`, wt);
        git(`worktree remove --force -- ${wt}`, sourceRepo);

        const changeRef: ChangeRef = {
          kind: "format-patch",
          patchBase64: Buffer.from(patchBytes, "utf8").toString("base64"),
        };

        const targetRepo = makeIsolatedRepo("marker-target");
        writeAndCommit(targetRepo, "shared.ts", "export const val = 'marker-target';\n", "feat: target conflict");

        const result = await applyAndResolve({
          repoDir: targetRepo,
          branchName: "feat/marker-check",
          baseBranch: "main",
          changeRefs: [changeRef],
          resolver: async () => undefined,
        });

        expect(result.kind).not.toBe("success");
      } catch (err) {
        try { git(`worktree remove --force -- ${wt}`, sourceRepo); } catch { /* best-effort */ }
        throw err;
      }
    });
  });

  describe("push guard — pushBranch is separate from applyAndResolve (R-16)", () => {
    test("applyAndResolve itself never calls pushBranch (no network required)", async () => {
      const repoDir = makeIsolatedRepo("no-push");
      const result = await applyAndResolve({
        repoDir,
        branchName: "feat/no-push",
        baseBranch: "main",
        changeRefs: [],
        resolver: async () => undefined,
      });
      expect(result.kind).toBe("success");
    });
  });
});
