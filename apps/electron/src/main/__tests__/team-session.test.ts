import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TeamEngine } from '@websitelabs/software-teams-engine';
import type { Pane, PaneStatus, Unsubscribe } from '@websitelabs/software-teams-engine';
import { TeamSession } from '../team-session';

/** Minimal Pane double (the engine's helper isn't exported). */
class FakePane implements Pane {
  readonly written: string[] = [];
  readonly submitted: string[] = [];
  lastResize: { cols: number; rows: number } | undefined;
  private readonly outListeners = new Set<(chunk: string) => void>();
  constructor(readonly name: string) {}
  status(): PaneStatus {
    return 'idle';
  }
  submit(text: string): void {
    this.submitted.push(text);
  }
  write(text: string): void {
    this.written.push(text);
  }
  resize(cols: number, rows: number): void {
    this.lastResize = { cols, rows };
  }
  onOutput(listener: (chunk: string) => void): Unsubscribe {
    this.outListeners.add(listener);
    return () => this.outListeners.delete(listener);
  }
  onIdle(): Unsubscribe {
    return () => undefined;
  }
  onExit(): Unsubscribe {
    return () => undefined;
  }
  async dispose(): Promise<void> {}
  emit(chunk: string): void {
    this.outListeners.forEach((l) => l(chunk));
  }
}

describe('TeamSession', () => {
  let repo: string;
  let engine: TeamEngine;
  let session: TeamSession;
  const fakes = new Map<string, FakePane>();

  beforeEach(async () => {
    fakes.clear();
    repo = mkdtempSync(join(tmpdir(), 'cockpit-'));
    engine = await TeamEngine.start({
      repoRoot: repo,
      isolation: 'shared',
      roster: [{ role: 'backend', agent: 'software-teams-backend' }],
      proxyPath: '/nonexistent/mcp-proxy.mjs',
      routeHookPath: '/nonexistent/team-route-hook.mjs',
      createPane: (config) => {
        const pane = new FakePane(config.agent.name);
        fakes.set(config.agent.name, pane);
        return pane;
      },
    });
    session = new TeamSession(engine);
  });

  afterEach(async () => {
    await session.stop();
    rmSync(repo, { recursive: true, force: true });
  });

  test('agents() lists the orchestrator and specialists', () => {
    const names = session.agents().map((a) => a.name);
    expect(names).toContain('software-teams-orchestrator');
    expect(names).toContain('software-teams-backend');
  });

  test('onOutput streams a pane chunk tagged with the agent', () => {
    const got: { agent: string; chunk: string }[] = [];
    session.onOutput((o) => got.push(o));
    fakes.get('software-teams-backend')?.emit('hello-term');
    expect(got).toContainEqual({ agent: 'software-teams-backend', chunk: 'hello-term' });
  });

  test('input/resize route to the right pane', () => {
    session.input('software-teams-backend', 'keystrokes');
    session.resize('software-teams-backend', 80, 24);
    const pane = fakes.get('software-teams-backend');
    expect(pane?.written).toContain('keystrokes');
    expect(pane?.lastResize).toEqual({ cols: 80, rows: 24 });
  });

  test('clearAll resets every pane', () => {
    session.clearAll();
    for (const pane of fakes.values()) expect(pane.submitted).toContain('/clear');
  });

  test('onActivity streams broker activity', () => {
    const got: string[] = [];
    session.onActivity((a) => got.push(a.summary));
    engine.broker.submit({
      kind: 'send',
      from: 'software-teams-orchestrator',
      to: 'software-teams-backend',
      body: 'activity-ping',
    });
    expect(got.some((s) => s.includes('activity-ping'))).toBe(true);
  });
});
