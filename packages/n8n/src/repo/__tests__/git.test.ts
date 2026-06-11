import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync: realExecSync } = require("node:child_process") as {
  execSync: (cmd: string, opts: { cwd: string; encoding: string; env: NodeJS.ProcessEnv }) => string;
};
import {
  createWorktree,
  removeWorktree,
  capturePortableChange,
  applyPortableChange,
  listChangedFiles,
  gitStatus,
} from "../git";

// ── Fixture git repo ──────────────────────────────────────────────────────────
// All tests share one bare-enough repo created in beforeAll and torn down in
// afterAll. Each test that needs isolation creates its own worktrees / temp dirs
// and cleans them up individually (afterAll handles the root).

let fixtureRoot: string;
let fixtureCloneDir: string;

function git(args: string, cwd: string): string {
  return realExecSync(`git ${args}`, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

function writeAndCommit(repoDir: string, filename: string, content: string, message: string): void {
  writeFileSync(join(repoDir, filename), content, "utf8");
  git("add --all", repoDir);
  git(`commit -m "${message}"`, repoDir);
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "st-git-test-root-"));
  fixtureCloneDir = join(fixtureRoot, "repo");
  mkdirSync(fixtureCloneDir, { recursive: true });

  git("init -b main", fixtureCloneDir);
  git("config user.email test@example.com", fixtureCloneDir);
  git("config user.name Test", fixtureCloneDir);

  writeAndCommit(fixtureCloneDir, "README.md", "# Fixture repo\n", "chore: initial commit");
  writeAndCommit(fixtureCloneDir, "alpha.ts", "export const alpha = 1;\n", "feat: add alpha");
});

afterAll(() => {
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ── createWorktree / removeWorktree ───────────────────────────────────────────

describe("createWorktree", () => {
  test("creates a worktree directory and returns its path", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "backend",
      correlationId: "aabbccdd-1234-5678",
      baseBranch: "main",
    });

    const { existsSync } = await import("node:fs");
    expect(existsSync(worktreePath)).toBe(true);
    expect(worktreePath).toContain("backend-aabbccdd");

    // cleanup
    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });

  test("worktree path is nested under <repoDir>/worktrees/", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "frontend",
      correlationId: "deadbeef-0000-0000",
      baseBranch: "main",
    });

    expect(worktreePath).toContain(join(fixtureCloneDir, "worktrees"));

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });

  test("two worktrees with different agentIds do not collide", async () => {
    const wt1 = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "agent-one",
      correlationId: "aaaaaaaa-0000-0001",
      baseBranch: "main",
    });
    const wt2 = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "agent-two",
      correlationId: "bbbbbbbb-0000-0002",
      baseBranch: "main",
    });

    expect(wt1).not.toBe(wt2);

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath: wt1 });
    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath: wt2 });
  });
});

describe("removeWorktree", () => {
  test("removes the worktree directory", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "removeme",
      correlationId: "ffffffff-0000-0000",
      baseBranch: "main",
    });

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });

    const { existsSync } = await import("node:fs");
    expect(existsSync(worktreePath)).toBe(false);
  });
});

// ── capturePortableChange / applyPortableChange ───────────────────────────────

describe("capturePortableChange", () => {
  test("returns null when worktree is clean with no diverging commits", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "clean-agent",
      correlationId: "00000000-clean-0000",
      baseBranch: "main",
    });

    const changeRef = await capturePortableChange({
      worktreePath,
      baseBranch: "main",
    });

    expect(changeRef).toBeNull();

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });

  test("returns a ChangeRef with kind 'format-patch' after a file change", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "writer-agent",
      correlationId: "11111111-write-1111",
      baseBranch: "main",
    });

    writeFileSync(join(worktreePath, "new-file.ts"), "export const x = 42;\n", "utf8");
    git("config user.email test@example.com", worktreePath);
    git("config user.name Test", worktreePath);

    const changeRef = await capturePortableChange({
      worktreePath,
      baseBranch: "main",
    });

    expect(changeRef).not.toBeNull();
    expect(changeRef?.kind).toBe("format-patch");
    expect(typeof changeRef?.patchBase64).toBe("string");
    expect(changeRef!.patchBase64.length).toBeGreaterThan(0);

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });

  test("patchBase64 decodes to a valid git format-patch header", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "patch-header-agent",
      correlationId: "22222222-head-2222",
      baseBranch: "main",
    });

    writeFileSync(join(worktreePath, "patch-header.ts"), "export const y = 99;\n", "utf8");
    git("config user.email test@example.com", worktreePath);
    git("config user.name Test", worktreePath);

    const changeRef = await capturePortableChange({
      worktreePath,
      baseBranch: "main",
    });

    const decoded = Buffer.from(changeRef!.patchBase64, "base64").toString("utf8");
    expect(decoded).toContain("From ");
    expect(decoded).toContain("diff --git");

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });
});

// ── Cross-directory patch apply (AC9 / R-15 queue-safe reconstruction) ────────

describe("applyPortableChange — cross-directory patch apply (AC9 queue-safe)", () => {
  test("change captured in worktree dir A is applied in separate dir B", async () => {
    // Dir A: produce a change
    const wtA = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "queue-a",
      correlationId: "33333333-qsaf-3333",
      baseBranch: "main",
    });

    writeFileSync(
      join(wtA, "queue-safe.ts"),
      "export const queueSafe = true;\n",
      "utf8",
    );
    git("config user.email test@example.com", wtA);
    git("config user.name Test", wtA);

    const changeRef = await capturePortableChange({
      worktreePath: wtA,
      baseBranch: "main",
    });

    expect(changeRef).not.toBeNull();

    // Dir B: separate worktree on the SAME base — simulates a different worker
    const wtB = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "queue-b",
      correlationId: "44444444-qsaf-4444",
      baseBranch: "main",
    });

    git("config user.email test@example.com", wtB);
    git("config user.name Test", wtB);

    await applyPortableChange({
      changeRef: changeRef!,
      targetDir: wtB,
    });

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(wtB, "queue-safe.ts"))).toBe(true);

    const applied = await import("node:fs").then((fs) =>
      fs.readFileSync(join(wtB, "queue-safe.ts"), "utf8"),
    );
    expect(applied).toContain("queueSafe = true");

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath: wtA });
    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath: wtB });
  });

  test("applying a ChangeRef that modifies an existing file reconstructs the edit in dir B", async () => {
    const wtA = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "edit-a",
      correlationId: "55555555-edit-5555",
      baseBranch: "main",
    });

    git("config user.email test@example.com", wtA);
    git("config user.name Test", wtA);
    // Modify an existing file
    writeFileSync(join(wtA, "alpha.ts"), "export const alpha = 999;\n", "utf8");

    const changeRef = await capturePortableChange({
      worktreePath: wtA,
      baseBranch: "main",
    });

    expect(changeRef).not.toBeNull();

    const wtB = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "edit-b",
      correlationId: "66666666-edit-6666",
      baseBranch: "main",
    });

    git("config user.email test@example.com", wtB);
    git("config user.name Test", wtB);

    await applyPortableChange({ changeRef: changeRef!, targetDir: wtB });

    const content = await import("node:fs").then((fs) =>
      fs.readFileSync(join(wtB, "alpha.ts"), "utf8"),
    );
    expect(content).toContain("999");

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath: wtA });
    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath: wtB });
  });
});

// ── listChangedFiles ──────────────────────────────────────────────────────────

describe("listChangedFiles", () => {
  test("returns empty array when no files differ from base", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "list-clean",
      correlationId: "77777777-list-7777",
      baseBranch: "main",
    });

    git("config user.email test@example.com", worktreePath);
    git("config user.name Test", worktreePath);

    const files = await listChangedFiles({
      repoDir: worktreePath,
      baseRef: "main",
      headRef: "HEAD",
    });

    expect(files).toHaveLength(0);

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });

  test("returns file names after a commit that adds a new file", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "list-changed",
      correlationId: "88888888-list-8888",
      baseBranch: "main",
    });

    git("config user.email test@example.com", worktreePath);
    git("config user.name Test", worktreePath);
    writeAndCommit(worktreePath, "listed.ts", "export const listed = 1;\n", "feat: listed");

    const files = await listChangedFiles({
      repoDir: worktreePath,
      baseRef: "main",
      headRef: "HEAD",
    });

    expect(files).toContain("listed.ts");

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });
});

// ── gitStatus ─────────────────────────────────────────────────────────────────

describe("gitStatus", () => {
  test("returns empty array for a clean repo directory", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "status-clean",
      correlationId: "99999999-stat-9999",
      baseBranch: "main",
    });

    const status = await gitStatus({ repoDir: worktreePath });
    expect(status).toHaveLength(0);

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });

  test("returns status lines for uncommitted changes", async () => {
    const worktreePath = await createWorktree({
      repoDir: fixtureCloneDir,
      agentId: "status-dirty",
      correlationId: "aaaaaaaa-stat-aaaa",
      baseBranch: "main",
    });

    writeFileSync(join(worktreePath, "untracked.ts"), "export const u = 1;\n", "utf8");

    const status = await gitStatus({ repoDir: worktreePath });
    expect(status.length).toBeGreaterThan(0);
    const hasUntracked = status.some((line) => line.includes("untracked.ts"));
    expect(hasUntracked).toBe(true);

    await removeWorktree({ repoDir: fixtureCloneDir, worktreePath });
  });
});
