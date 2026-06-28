import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** A provisioned per-agent worktree. */
export interface WorktreeInfo {
  readonly agent: string;
  readonly path: string;
  readonly branch: string;
}

export interface ProvisionOptions {
  readonly repoRoot: string;
  /** Ref the new branch is created from (default `HEAD`). */
  readonly baseRef?: string;
  /** Parent directory for worktrees (default `<repoRoot>/.software-teams/team/worktrees`). */
  readonly rootDir?: string;
  /** Branch name prefix (default `st-team/`). */
  readonly branchPrefix?: string;
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function worktreesRoot(opts: ProvisionOptions): string {
  return opts.rootDir ?? join(opts.repoRoot, '.software-teams', 'team', 'worktrees');
}

/**
 * Manages one git worktree per specialist so panes editing in parallel never
 * collide. The orchestrator pane works in the repo root directly; each specialist
 * gets its own checkout on its own branch, which the orchestrator merges back at
 * integration time (reusing the same model as the CLI's `worktree-merge`).
 */
export class WorktreeManager {
  /** Create (or reuse) a worktree for one agent. Idempotent on the path. */
  provision(agent: string, opts: ProvisionOptions): WorktreeInfo {
    const branch = `${opts.branchPrefix ?? 'st-team/'}${agent}`;
    const root = worktreesRoot(opts);
    const path = join(root, agent);
    if (existsSync(path)) {
      return { agent, path, branch };
    }
    mkdirSync(root, { recursive: true });
    git(opts.repoRoot, ['worktree', 'add', '-B', branch, path, opts.baseRef ?? 'HEAD']);
    return { agent, path, branch };
  }

  /** Remove a worktree; optionally delete its branch too. */
  remove(info: WorktreeInfo, repoRoot: string, deleteBranch = false): void {
    if (existsSync(info.path)) {
      git(repoRoot, ['worktree', 'remove', '--force', info.path]);
    }
    if (deleteBranch) {
      try {
        git(repoRoot, ['branch', '-D', info.branch]);
      } catch {
        // branch may have been merged/removed already
      }
    }
  }

  /** Merge a specialist's branch into the current branch of `repoRoot`. */
  mergeBranch(repoRoot: string, branch: string, message?: string): void {
    git(repoRoot, ['merge', '--no-ff', branch, '-m', message ?? `merge ${branch}`]);
  }

  /** Paths of all registered worktrees (porcelain). */
  list(repoRoot: string): readonly string[] {
    return git(repoRoot, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  }
}
