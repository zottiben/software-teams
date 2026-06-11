import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeRef } from "./repo-context.js";
import { applyPortableChange } from "./git.js";

const execFile = promisify(execFileCb);

async function run(
  cmd: string,
  args: readonly string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
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
    "git binary not found. Install git and ensure it is on PATH.",
  );
}

async function hasConflictMarkers(git: string, repoDir: string): Promise<readonly string[]> {
  const statusResult = await run(git, ["status", "--porcelain"], { cwd: repoDir }).catch(
    () => ({ stdout: "" }),
  );
  const conflicted = statusResult.stdout
    .split("\n")
    .filter((l) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(l.trim()))
    .map((l) => l.trim().slice(3).trim())
    .filter(Boolean);
  if (conflicted.length > 0) return conflicted;

  const checkResult = await run(git, ["diff", "--check"], { cwd: repoDir }).catch(
    (err: { stdout?: string }) => ({ stdout: err.stdout ?? "" }),
  );
  if (checkResult.stdout.trim()) {
    return checkResult.stdout
      .split("\n")
      .map((l) => l.split(":")[0]?.trim() ?? "")
      .filter(Boolean)
      .filter((f, idx, arr) => arr.indexOf(f) === idx);
  }

  return [];
}

async function checkoutBranch(opts: {
  readonly git: string;
  readonly repoDir: string;
  readonly branchName: string;
  readonly baseBranch: string;
}): Promise<void> {
  const { git, repoDir, branchName, baseBranch } = opts;
  await run(git, ["checkout", "-b", branchName, baseBranch], { cwd: repoDir }).catch(
    async () => {
      await run(git, ["checkout", branchName], { cwd: repoDir });
    },
  );
}

async function stageAndCommit(opts: {
  readonly git: string;
  readonly repoDir: string;
  readonly message: string;
}): Promise<void> {
  const { git, repoDir, message } = opts;
  const statusResult = await run(git, ["status", "--porcelain"], { cwd: repoDir });
  if (!statusResult.stdout.trim()) return;
  await run(git, ["add", "--all"], { cwd: repoDir });
  await run(git, ["commit", "-m", message, "--allow-empty"], { cwd: repoDir });
}

export interface MergeSuccess {
  readonly kind: "success";
  readonly branch: string;
}

export interface MergeFailure {
  readonly kind: "bounded-failure";
  readonly conflictingFiles: readonly string[];
  readonly turnsExhausted: number;
}

export type MergeResult = MergeSuccess | MergeFailure;

const MAX_RESOLVER_TURNS = 3;

export interface ApplyAndResolveOpts {
  readonly repoDir: string;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly changeRefs: readonly ChangeRef[];
  readonly resolver: (conflictingFiles: readonly string[]) => Promise<void>;
}

/**
 * Apply each changeRef onto branchName (forked from baseBranch in repoDir),
 * then run up to MAX_RESOLVER_TURNS of the injected resolver for any conflicts.
 *
 * The resolver is injected so T11 can mock it without invoking claude.
 * Returns MergeSuccess when the tree is conflict-free, MergeFailure (with the
 * conflicting file list) when MAX_RESOLVER_TURNS are exhausted.
 *
 * NEVER pushes. NEVER loops beyond MAX_RESOLVER_TURNS (R-16).
 */
export async function applyAndResolve(opts: ApplyAndResolveOpts): Promise<MergeResult> {
  const { repoDir, branchName, baseBranch, changeRefs, resolver } = opts;
  const git = await findGit();

  await checkoutBranch({ git, repoDir, branchName, baseBranch });

  for (const changeRef of changeRefs) {
    await applyPortableChange({ changeRef, targetDir: repoDir }).catch(async (err: Error) => {
      process.stderr.write(`[merge] applyPortableChange failed: ${err.message}\n`);
      const conflicts = await hasConflictMarkers(git, repoDir);
      if (conflicts.length === 0) {
        await run(git, ["am", "--abort"], { cwd: repoDir }).catch(() => undefined);
      }
    });
  }

  const initialConflicts = await hasConflictMarkers(git, repoDir);

  if (initialConflicts.length === 0) {
    await stageAndCommit({ git, repoDir, message: "chore: merge agent changes" });
    return { kind: "success", branch: branchName };
  }

  for (const attempt of Array.from({ length: MAX_RESOLVER_TURNS }, (_value, index) => index)) {
    const conflictsBeforeTurn = await hasConflictMarkers(git, repoDir);
    if (conflictsBeforeTurn.length === 0) {
      await stageAndCommit({ git, repoDir, message: "chore: merge agent changes" });
      return { kind: "success", branch: branchName };
    }

    await resolver(conflictsBeforeTurn);

    const conflictsAfterTurn = await hasConflictMarkers(git, repoDir);
    if (conflictsAfterTurn.length === 0) {
      await stageAndCommit({
        git,
        repoDir,
        message: `chore: merge agent changes (resolved, attempt ${attempt + 1})`,
      });
      return { kind: "success", branch: branchName };
    }
  }

  const remainingConflicts = await hasConflictMarkers(git, repoDir);
  return {
    kind: "bounded-failure",
    conflictingFiles: remainingConflicts,
    turnsExhausted: MAX_RESOLVER_TURNS,
  };
}

export async function pushBranch(opts: {
  readonly repoDir: string;
  readonly branchName: string;
  readonly remote: string;
  readonly githubToken: string;
}): Promise<void> {
  const { repoDir, branchName, remote, githubToken } = opts;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "git",
      ["push", "--set-upstream", remote, branchName],
      {
        cwd: repoDir,
        env: { ...process.env, GITHUB_TOKEN: githubToken, GIT_ASKPASS: "echo" },
        stdio: ["ignore", "inherit", "pipe"],
      },
    );

    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on("close", (code: number | null) => {
      const stderrText = Buffer.concat(stderrChunks).toString("utf8");
      if (stderrText) process.stderr.write(`[merge] git push: ${stderrText}\n`);
      if (code === 0) resolve();
      else reject(new Error(`git push failed with exit code ${code}`));
    });

    proc.on("error", reject);
  });
}
