import { describe, expect, test } from 'bun:test';
import { Broker } from '../broker/broker';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import { buildPaneSettings } from '../mcp/settings';
import { TmuxPane, type TmuxDriver } from '../tmux/tmux-pane';
import type { AgentSpec } from '../types';

class FakeTmux implements TmuxDriver {
  readonly submits: { target: string; text: string }[] = [];
  readonly pastes: { target: string; text: string; bracketed?: boolean }[] = [];
  readonly killed: string[] = [];
  submitText(target: string, text: string): void {
    this.submits.push({ target, text });
  }
  pasteText(target: string, text: string, bracketed?: boolean): void {
    this.pastes.push({ target, text, bracketed });
  }
  killPane(target: string): void {
    this.killed.push(target);
  }
}

const BE: AgentSpec = { name: 'software-teams-backend', role: 'backend', persona: 'p', isLead: false };

describe('TmuxPane', () => {
  test('starts "starting", goes idle only on a Stop-hook signal', () => {
    const tmux = new FakeTmux();
    const pane = new TmuxPane(BE.name, tmux, '%3');
    expect(pane.status()).toBe('starting');
    const idle: number[] = [];
    pane.onIdle(() => idle.push(1));
    pane.signalIdle();
    expect(pane.status()).toBe('idle');
    expect(idle).toHaveLength(1);
  });

  test('submit delivers via tmux and marks the pane busy', () => {
    const tmux = new FakeTmux();
    const pane = new TmuxPane(BE.name, tmux, '%3');
    pane.signalIdle();
    pane.submit('do the thing');
    expect(tmux.submits).toEqual([{ target: '%3', text: 'do the thing' }]);
    expect(pane.status()).toBe('busy');
  });

  test('dispose kills the tmux pane and fires exit', () => {
    const tmux = new FakeTmux();
    const pane = new TmuxPane(BE.name, tmux, '%3');
    const exits: number[] = [];
    pane.onExit((c) => exits.push(c));
    void pane.dispose();
    expect(tmux.killed).toEqual(['%3']);
    expect(exits).toEqual([0]);
    expect(pane.status()).toBe('exited');
  });

  test('broker queues for a starting pane and flushes on the idle signal', () => {
    const broker = new Broker(new ClaudeCodeAdapter());
    const tmux = new FakeTmux();
    const pane = new TmuxPane(BE.name, tmux, '%3');
    broker.registerPane(BE, pane);

    broker.submit({ kind: 'delegate', from: 'lead', to: BE.name, body: 'Add /healthz', correlationId: 'T1' });
    expect(tmux.submits).toHaveLength(0); // still "starting" — not delivered yet

    pane.signalIdle();
    expect(tmux.submits).toHaveLength(1);
    expect(tmux.submits[0]?.text).toContain('Add /healthz');
    expect(tmux.submits[0]?.text).toContain('[ref:T1]');
  });
});

describe('buildPaneSettings', () => {
  test('emits a Stop hook that curls /idle with the pane token', () => {
    const doc = buildPaneSettings({ controlUrl: 'http://127.0.0.1:9', token: 'tok-be' });
    const command = doc.hooks.Stop?.[0]?.hooks[0]?.command ?? '';
    expect(command).toContain('curl');
    expect(command).toContain('http://127.0.0.1:9/idle');
    expect(command).toContain('tok-be');
    expect(doc.hooks.PreToolUse).toBeUndefined();
  });

  test('adds a PreToolUse(Task) route hook when taskRoute is given', () => {
    const doc = buildPaneSettings({
      controlUrl: 'http://127.0.0.1:9',
      token: 'tok-be',
      taskRoute: { hookScript: '/abs/dist/team-route-hook.mjs', rosterPath: '/abs/roster.json' },
    });
    const entry = doc.hooks.PreToolUse?.[0];
    expect(entry?.matcher).toBe('Task');
    expect(entry?.hooks[0]?.command).toContain('/abs/dist/team-route-hook.mjs');
    expect(entry?.hooks[0]?.command).toContain('/abs/roster.json');
  });
});
