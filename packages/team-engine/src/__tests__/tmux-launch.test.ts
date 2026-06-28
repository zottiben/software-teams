import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, describe } from 'bun:test';
import type { HarnessAdapter } from '../harness/adapter';
import { launchTmux, type TmuxTeam } from '../tmux/launch';
import { Tmux } from '../tmux/tmux';
import { TmuxPane } from '../tmux/tmux-pane';
import type { LaunchSpec, PaneConfig, TeamMessage } from '../types';

/** Fake harness: each pane runs `cat` (echoes stdin) instead of a real `claude`. */
const catAdapter: HarnessAdapter = {
  id: 'fake-cat',
  buildLaunch: (config: PaneConfig): LaunchSpec => ({
    command: 'cat',
    args: [],
    cwd: config.cwd,
    env: {},
  }),
  clearCommand: () => '/clear',
  formatIncoming: (message: TeamMessage) => `[task] ${message.body}`,
};

const socket = `st-test-${randomUUID().slice(0, 8)}`;
const liveDescribe = Tmux.available(socket) ? describe : describe.skip;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

liveDescribe('launchTmux (full assembly, fake claude)', () => {
  let repo: string;
  let team: TmuxTeam | undefined;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'st-tmuxlaunch-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# t\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  });

  afterAll(async () => {
    await team?.engine.stop({ removeWorktrees: true });
    team?.tmux.killSession();
    rmSync(repo, { recursive: true, force: true });
  });

  test('opens a tmux session with a pane per agent and delivers into one', async () => {
    team = await launchTmux({
      repoRoot: repo,
      roster: [{ role: 'backend', agent: 'software-teams-backend' }],
      adapter: catAdapter,
      proxyPath: '/nonexistent/mcp-proxy.mjs', // never used: cat ignores it
      routeHookPath: '/nonexistent/team-route-hook.mjs',
      sessionName: `st-${randomUUID().slice(0, 8)}`,
      socketName: socket,
    });

    // orchestrator + backend
    expect(team.engine.panes.size).toBe(2);
    await wait(700); // let the `cat` processes come up

    const backend = team.engine.panes.get('software-teams-backend');
    expect(backend).toBeInstanceOf(TmuxPane);
    const pane = backend as TmuxPane;

    // Simulate the Stop-hook idle signal, then delegate a task through the broker.
    pane.signalIdle();
    team.engine.broker.submit({
      kind: 'delegate',
      from: 'software-teams-orchestrator',
      to: 'software-teams-backend',
      body: 'TMUX_LAUNCH_MARKER',
      correlationId: 'T1',
    });

    await wait(600);
    expect(team.tmux.capturePane(pane.target)).toContain('TMUX_LAUNCH_MARKER');
  });
});
