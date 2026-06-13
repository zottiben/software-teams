import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exec } from "../../utils/git";
import { mergeWorktree } from "../worktree-merge";

async function git(root: string, ...args: string[]) {
  const r = await exec(["git", ...args], root);
  return r;
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "st-wtm-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@t.t");
  await git(root, "config", "user.name", "t");
  await git(root, "config", "commit.gpgsign", "false");
  await writeFile(join(root, "base.txt"), "base\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "base");
  return root;
}

/** Create a worktree `name` and commit `files` in it. */
async function worktreeWithCommit(root: string, name: string, files: Record<string, string>) {
  const wtPath = join(root, ".worktrees", name);
  await git(root, "worktree", "add", "-b", name, wtPath, "HEAD");
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(wtPath, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
  await git(wtPath, "add", "-A");
  await git(wtPath, "commit", "-q", "-m", `work in ${name}`);
  return wtPath;
}

describe("mergeWorktree", () => {
  let root: string;
  beforeEach(async () => { root = await makeRepo(); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  test("merges committed work from the worktree branch into the current branch", async () => {
    await worktreeWithCommit(root, "feat-a", { "a.txt": "from a\n" });
    const res = await mergeWorktree(root, { name: "feat-a" });
    expect(res.merged).toBe(true);
    expect(existsSync(join(root, "a.txt"))).toBe(true); // landed on main tree
  });

  test("--remove deletes the worktree and branch after merge", async () => {
    await worktreeWithCommit(root, "feat-b", { "b.txt": "from b\n" });
    const res = await mergeWorktree(root, { name: "feat-b", remove: true });
    expect(res.merged).toBe(true);
    expect(res.removed).toBe(true);
    expect(existsSync(join(root, ".worktrees", "feat-b"))).toBe(false);
    const { stdout } = await git(root, "branch", "--list", "feat-b");
    expect(stdout.trim()).toBe("");
  });

  test("refuses when the worktree has uncommitted changes", async () => {
    const wtPath = await worktreeWithCommit(root, "feat-c", { "c.txt": "v1\n" });
    await writeFile(join(wtPath, "c.txt"), "v2 uncommitted\n"); // dirty
    const res = await mergeWorktree(root, { name: "feat-c" });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe("uncommitted");
  });

  test("reports nothing-to-merge when the branch has no new commits", async () => {
    await git(root, "worktree", "add", "-b", "feat-d", join(root, ".worktrees", "feat-d"), "HEAD");
    const res = await mergeWorktree(root, { name: "feat-d" });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe("nothing-to-merge");
  });

  test("aborts cleanly on conflict (no merge left in progress)", async () => {
    await worktreeWithCommit(root, "feat-e", { "base.txt": "worktree edit\n" });
    // Diverge the current branch on the same file.
    await writeFile(join(root, "base.txt"), "main edit\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "main change");

    const res = await mergeWorktree(root, { name: "feat-e" });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe("conflict");
    // No merge state left behind.
    const { exitCode } = await git(root, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    expect(exitCode).not.toBe(0);
  });

  test("returns not-found for an unknown worktree with no active state", async () => {
    const res = await mergeWorktree(root, { name: undefined });
    expect(res.merged).toBe(false);
    expect(res.reason).toBe("not-found");
  });
});
