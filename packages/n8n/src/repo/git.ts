import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { ChangeRef } from "./repo-context.js";

const execFile = promisify(execFileCb);

type ExecResult = { stdout: string; stderr: string };

async function run(
  cmd: string,
  args: readonly string[],
  opts?: { cwd?: string },
): Promise<ExecResult> {
  return execFile(cmd, [...args], { cwd: opts?.cwd });
}

async function findGit(): Promise<string> {
  try {
    const { stdout } = await execFile("which", ["git"]);
    const path = stdout.trim();
    if (path) return path;
  } catch {
    // not found via which
  }
  throw new Error(
    "git binary not found. Install git and ensure it is on PATH. " +
      "@websitelabs/n8n-nodes-software-teams requires a self-hosted n8n instance " +
      "with the `git` binary available on the worker.",
  );
}

/**
 * Shallow-clone `cloneUrl` at `branch` into `destDir`.
 * Fails fast with an actionable message if `git` is missing (mirrors findClaude).
 * All args are passed as argv arrays — never shell-concatenated (R-08).
 * Diagnostics go to stderr to protect stream-json purity (R-09).
 */
export async function cloneRepo(opts: {
  readonly cloneUrl: string;
  readonly branch: string;
  readonly destDir: string;
}): Promise<void> {
  const git = await findGit();
  const { cloneUrl, branch, destDir } = opts;
  const result = await run(git, [
    "clone",
    "--depth=1",
    "--branch",
    branch,
    "--",
    cloneUrl,
    destDir,
  ]).catch((err: Error) => {
    process.stderr.write(
      `[git] clone failed: ${err.message}\n`,
    );
    throw err;
  });
  if (result.stderr) {
    process.stderr.write(`[git] clone: ${result.stderr}\n`);
  }
}

/**
 * Create an isolated git worktree for an agent turn under `<repoDir>/worktrees/<agentId>`.
 * The worktree is checked out at a new branch named after the agentId + correlationId suffix.
 * Returns the absolute path to the new worktree.
 */
export async function createWorktree(opts: {
  readonly repoDir: string;
  readonly agentId: string;
  readonly correlationId: string;
  readonly baseBranch: string;
}): Promise<string> {
  const git = await findGit();
  const { repoDir, agentId, correlationId, baseBranch } = opts;
  const slug = correlationId.slice(0, 8);
  const branchName = `wt/${agentId}/${slug}`;
  const worktreePath = join(repoDir, "worktrees", `${agentId}-${slug}`);

  const result = await run(
    git,
    ["worktree", "add", "-b", branchName, "--", worktreePath, baseBranch],
    { cwd: repoDir },
  ).catch((err: Error) => {
    process.stderr.write(`[git] worktree add failed: ${err.message}\n`);
    throw err;
  });
  if (result.stderr) {
    process.stderr.write(`[git] worktree add: ${result.stderr}\n`);
  }
  return worktreePath;
}

/**
 * Remove the worktree rooted at `worktreePath` and prune the tracking entry.
 */
export async function removeWorktree(opts: {
  readonly repoDir: string;
  readonly worktreePath: string;
}): Promise<void> {
  const git = await findGit();
  const { repoDir, worktreePath } = opts;
  const result = await run(
    git,
    ["worktree", "remove", "--force", "--", worktreePath],
    { cwd: repoDir },
  ).catch((err: Error) => {
    process.stderr.write(`[git] worktree remove failed: ${err.message}\n`);
    throw err;
  });
  if (result.stderr) {
    process.stderr.write(`[git] worktree remove: ${result.stderr}\n`);
  }
  await run(git, ["worktree", "prune"], { cwd: repoDir }).catch(() => {
    // best-effort
  });
}

/**
 * Stage all changes in `worktreePath` and commit them.
 * Returns the commit SHA of the new commit, or null if there is nothing to commit.
 */
async function stageAndCommit(opts: {
  readonly git: string;
  readonly worktreePath: string;
  readonly message: string;
}): Promise<string | null> {
  const { git, worktreePath, message } = opts;
  const statusResult = await run(git, ["status", "--porcelain"], {
    cwd: worktreePath,
  });
  if (!statusResult.stdout.trim()) return null;

  await run(git, ["add", "--all"], { cwd: worktreePath });
  await run(git, ["commit", "-m", message, "--allow-empty"], {
    cwd: worktreePath,
  });

  const revResult = await run(git, ["rev-parse", "HEAD"], {
    cwd: worktreePath,
  });
  return revResult.stdout.trim();
}

/**
 * Capture the agent turn's changes as a portable `ChangeRef`.
 * Uses `git format-patch` from the merge-base of the worktree branch and
 * `baseBranch`, encodes the combined patch bytes as base64.
 * If there are no commits ahead of baseBranch, stages and commits any
 * uncommitted changes first. Returns null when the worktree is clean and
 * has no diverging commits.
 */
export async function capturePortableChange(opts: {
  readonly worktreePath: string;
  readonly baseBranch: string;
}): Promise<ChangeRef | null> {
  const git = await findGit();
  const { worktreePath, baseBranch } = opts;

  await stageAndCommit({
    git,
    worktreePath,
    message: "chore: capture agent turn changes",
  });

  const mergeBaseResult = await run(
    git,
    ["merge-base", "HEAD", baseBranch],
    { cwd: worktreePath },
  ).catch(() => ({ stdout: "", stderr: "" }));
  const mergeBase = mergeBaseResult.stdout.trim();

  const patchRange = mergeBase ? `${mergeBase}..HEAD` : baseBranch;

  const patchResult = await run(
    git,
    ["format-patch", "--stdout", patchRange],
    { cwd: worktreePath },
  );

  const patchBytes = patchResult.stdout;
  if (!patchBytes.trim()) return null;

  const patchBase64 = Buffer.from(patchBytes, "utf8").toString("base64");
  return { kind: "format-patch", patchBase64 };
}

/**
 * Apply a portable `ChangeRef` in `targetDir` via `git am`.
 * Decodes base64 patch bytes and pipes them to `git am`.
 * Queue-mode-safe: the targetDir may be on a different worker than where
 * the ChangeRef was produced.
 */
export async function applyPortableChange(opts: {
  readonly changeRef: ChangeRef;
  readonly targetDir: string;
}): Promise<void> {
  const git = await findGit();
  const { changeRef, targetDir } = opts;
  const patchBytes = Buffer.from(changeRef.patchBase64, "base64").toString("utf8");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(git, ["am", "--3way"], {
      cwd: targetDir,
      stdio: ["pipe", "inherit", "pipe"],
    });

    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    proc.on("close", (code: number | null) => {
      const stderrText = Buffer.concat(stderrChunks).toString("utf8");
      if (stderrText) process.stderr.write(`[git] am: ${stderrText}\n`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git am failed with exit code ${code}`));
      }
    });

    proc.on("error", reject);
    proc.stdin?.write(patchBytes);
    proc.stdin?.end();
  });
}

/**
 * List files that differ between `targetRef` and `sourceRef` (or HEAD if absent).
 * Returns an array of relative file paths. Used by the Finaliser to detect
 * conflicts and build the run summary.
 */
export async function listChangedFiles(opts: {
  readonly repoDir: string;
  readonly baseRef: string;
  readonly headRef?: string;
}): Promise<readonly string[]> {
  const git = await findGit();
  const { repoDir, baseRef, headRef } = opts;
  const args = headRef
    ? ["diff", "--name-only", baseRef, headRef]
    : ["diff", "--name-only", baseRef, "HEAD"];

  const result = await run(git, args, { cwd: repoDir });
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Return the short git status of `repoDir` (porcelain v1).
 * Each line is in the form `XY filename`. Used by the Finaliser to detect
 * conflict markers in the working tree.
 */
export async function gitStatus(opts: {
  readonly repoDir: string;
}): Promise<readonly string[]> {
  const git = await findGit();
  const result = await run(git, ["status", "--porcelain"], {
    cwd: opts.repoDir,
  });
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
