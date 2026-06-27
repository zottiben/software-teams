import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TeamEngine } from '../engine';
import type { PaneFactory } from '../engine';
import type { PaneConfig } from '../types';
import { FakePane } from './helpers/fake-pane';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('TeamEngine.start (assembly)', () => {
  let repo: string;
  let engine: TeamEngine | undefined;
  const panes = new Map<string, FakePane>();
  const cwds = new Map<string, string>();

  const factory: PaneFactory = (config: PaneConfig) => {
    const pane = new FakePane(config.agent.name);
    panes.set(config.agent.name, pane);
    cwds.set(config.agent.name, config.cwd);
    return pane;
  };

  beforeEach(() => {
    panes.clear();
    cwds.clear();
    repo = mkdtempSync(join(tmpdir(), 'st-engine-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@example.com']);
    git(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'README.md'), '# t\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await engine?.stop({ removeWorktrees: true });
    engine = undefined;
    rmSync(repo, { recursive: true, force: true });
  });

  async function startTeam(): Promise<TeamEngine> {
    return TeamEngine.start({
      repoRoot: repo,
      roster: [
        { role: 'backend', agent: 'software-teams-backend' },
        { role: 'frontend', agent: 'software-teams-frontend' },
      ],
      proxyPath: '/nonexistent/mcp-proxy.mjs', // never executed: FakePane ignores the launch spec
      routeHookPath: '/nonexistent/team-route-hook.mjs',
      createPane: factory,
    });
  }

  test('spawns an orchestrator lead plus one pane per specialist', async () => {
    engine = await startTeam();
    expect(engine.panes.size).toBe(3);
    expect(engine.panes.has('software-teams-orchestrator')).toBe(true);
    expect(engine.panes.has('software-teams-backend')).toBe(true);
  });

  test('lead works in the repo root; specialists get their own worktree', async () => {
    engine = await startTeam();
    expect(cwds.get('software-teams-orchestrator')).toBe(repo);
    const backendCwd = cwds.get('software-teams-backend') ?? '';
    expect(backendCwd).toContain(join('.software-teams', 'team', 'worktrees', 'software-teams-backend'));
    expect(existsSync(backendCwd)).toBe(true);
  });

  test('writes an mcp-config per pane', async () => {
    engine = await startTeam();
    const cfg = join(repo, '.software-teams', 'team', 'mcp', 'software-teams-backend.mcp.json');
    expect(existsSync(cfg)).toBe(true);
  });

  test('writes a roster file the route hook consults', async () => {
    engine = await startTeam();
    const rosterPath = join(repo, '.software-teams', 'team', 'roster.json');
    expect(existsSync(rosterPath)).toBe(true);
    const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as string[];
    expect(roster).toContain('software-teams-orchestrator');
    expect(roster).toContain('software-teams-backend');
  });

  test('the broker delivers a delegated task into the right specialist pane', async () => {
    engine = await startTeam();
    engine.broker.submit({
      kind: 'delegate',
      from: 'software-teams-orchestrator',
      to: 'software-teams-backend',
      body: 'Add /healthz',
      correlationId: 'T1',
    });
    expect(panes.get('software-teams-backend')?.submitted.some((s) => s.includes('Add /healthz'))).toBe(true);
  });

  test('clearAll resets every pane', async () => {
    engine = await startTeam();
    engine.clearAll();
    for (const pane of panes.values()) {
      expect(pane.submitted).toContain('/clear');
    }
  });

  test('stop removes provisioned worktrees', async () => {
    engine = await startTeam();
    const backendCwd = cwds.get('software-teams-backend') ?? '';
    await engine.stop({ removeWorktrees: true });
    engine = undefined; // already stopped
    expect(existsSync(backendCwd)).toBe(false);
  });

  test('tears down already-spawned panes when a later pane fails to spawn', async () => {
    const created = new Map<string, FakePane>();
    const failing: PaneFactory = (config) => {
      if (config.agent.name === 'software-teams-backend') throw new Error('spawn boom');
      const pane = new FakePane(config.agent.name);
      created.set(config.agent.name, pane);
      return pane;
    };
    await expect(
      TeamEngine.start({
        repoRoot: repo,
        roster: [{ role: 'backend', agent: 'software-teams-backend' }],
        proxyPath: '/nonexistent/mcp-proxy.mjs',
        routeHookPath: '/nonexistent/team-route-hook.mjs',
        createPane: failing,
      }),
    ).rejects.toThrow('spawn boom');
    // the orchestrator pane was created before backend threw → it must be disposed
    expect(created.get('software-teams-orchestrator')?.status()).toBe('exited');
  });
});
