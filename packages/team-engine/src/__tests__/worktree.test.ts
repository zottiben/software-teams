import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { WorktreeManager } from '../worktree/worktree';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('WorktreeManager', () => {
  let repo: string;
  const manager = new WorktreeManager();

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'st-wt-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'README.md'), '# temp\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('provisions a worktree on its own branch', () => {
    const info = manager.provision('software-teams-frontend', { repoRoot: repo });
    expect(existsSync(info.path)).toBe(true);
    expect(info.branch).toBe('st-team/software-teams-frontend');
    const head = git(info.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(head).toBe('st-team/software-teams-frontend');
    expect(manager.list(repo).some((p) => p.endsWith('software-teams-frontend'))).toBe(true);
  });

  test('provision is idempotent on the path', () => {
    const a = manager.provision('software-teams-backend', { repoRoot: repo });
    const b = manager.provision('software-teams-backend', { repoRoot: repo });
    expect(b.path).toBe(a.path);
  });

  test('a specialist branch merges back into the orchestrator checkout', () => {
    const info = manager.provision('software-teams-devops', { repoRoot: repo });
    writeFileSync(join(info.path, 'ci.yml'), 'jobs: {}\n');
    git(info.path, ['add', '.']);
    git(info.path, ['commit', '-q', '-m', 'add ci']);
    manager.mergeBranch(repo, info.branch, 'integrate devops');
    expect(existsSync(join(repo, 'ci.yml'))).toBe(true);
  });

  test('remove cleans up the worktree and branch', () => {
    const info = manager.provision('software-teams-ux-designer', { repoRoot: repo });
    manager.remove(info, repo, true);
    expect(existsSync(info.path)).toBe(false);
  });
});
