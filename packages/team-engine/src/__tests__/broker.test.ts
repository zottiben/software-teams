import { beforeEach, describe, expect, test } from 'bun:test';
import { Broker, UnknownRecipientError } from '../broker/broker';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import type { AgentSpec } from '../types';
import { FakePane } from './helpers/fake-pane';

function spec(name: string, role: string, isLead = false): AgentSpec {
  return { name, role, persona: `persona:${role}`, isLead };
}

const ORCH = spec('software-teams-orchestrator', 'orchestrator', true);
const FE = spec('software-teams-frontend', 'frontend');
const BE = spec('software-teams-backend', 'backend');

describe('Broker delivery loop', () => {
  let broker: Broker;
  let orch: FakePane;
  let fe: FakePane;
  let be: FakePane;

  beforeEach(() => {
    broker = new Broker(new ClaudeCodeAdapter());
    orch = new FakePane(ORCH.name);
    fe = new FakePane(FE.name);
    be = new FakePane(BE.name);
    broker.registerPane(ORCH, orch);
    broker.registerPane(FE, fe);
    broker.registerPane(BE, be);
  });

  test('delivers a delegated task immediately when the recipient is idle', () => {
    broker.submit({
      kind: 'delegate',
      from: ORCH.name,
      to: FE.name,
      body: 'Build the login form.',
      correlationId: 'T3',
    });
    expect(fe.submitted).toHaveLength(1);
    expect(fe.submitted[0]).toContain('Build the login form.');
    expect(fe.submitted[0]).toContain('[ref:T3]');

    const board = broker.status();
    expect(board.delegations).toHaveLength(1);
    expect(board.delegations[0]?.status).toBe('dispatched');
  });

  test('queues for a busy pane and delivers on the next idle', () => {
    be.submit('keep me busy'); // be is now busy
    broker.submit({ kind: 'send', from: FE.name, to: BE.name, body: 'Need an endpoint.' });
    // still busy → only the manual submit is present
    expect(be.submitted).toHaveLength(1);

    be.goIdle();
    expect(be.submitted).toHaveLength(2);
    expect(be.submitted[1]).toContain('Need an endpoint.');
  });

  test('delivers only one queued message per idle (no interleaving)', () => {
    fe.submit('busy'); // busy
    broker.submit({ kind: 'send', from: BE.name, to: FE.name, body: 'first' });
    broker.submit({ kind: 'send', from: BE.name, to: FE.name, body: 'second' });
    expect(fe.submitted).toHaveLength(1);

    fe.goIdle();
    expect(fe.submitted).toHaveLength(2);
    expect(fe.submitted[1]).toContain('first');

    fe.goIdle();
    expect(fe.submitted).toHaveLength(3);
    expect(fe.submitted[2]).toContain('second');
  });

  test('a report closes out its delegation on the board', () => {
    broker.submit({ kind: 'delegate', from: ORCH.name, to: BE.name, body: 'Add /healthz', correlationId: 'T1' });
    broker.submit({ kind: 'report', from: BE.name, to: ORCH.name, body: 'Done, commit abc123', correlationId: 'T1' });

    const record = broker.status().delegations.find((d) => d.correlationId === 'T1');
    expect(record?.status).toBe('reported');
    expect(record?.report).toContain('abc123');
  });

  test('broadcast reaches every teammate except the sender', () => {
    broker.submit({ kind: 'broadcast', from: ORCH.name, to: null, body: 'standup in 5' });
    expect(fe.submitted).toHaveLength(1);
    expect(be.submitted).toHaveLength(1);
    expect(orch.submitted).toHaveLength(0);
  });

  test('directed message to a stranger throws UnknownRecipientError', () => {
    expect(() =>
      broker.submit({ kind: 'send', from: FE.name, to: 'software-teams-ghost', body: 'hi' }),
    ).toThrow(UnknownRecipientError);
  });

  test('records peer traffic in the activity feed for the lead to pull', () => {
    const seen: string[] = [];
    broker.onActivity((entry) => seen.push(`${entry.from}->${entry.to}`));
    broker.submit({ kind: 'send', from: FE.name, to: BE.name, body: 'peer ping' });

    expect(seen).toContain(`${FE.name}->${BE.name}`);
    const activity = broker.status().recentActivity;
    expect(activity.at(-1)?.summary).toContain('peer ping');
  });

  test('clear injects the harness clear command', () => {
    broker.clear(FE.name);
    expect(fe.submitted).toEqual(['/clear']);
    broker.clearAll();
    expect(orch.submitted).toContain('/clear');
    expect(be.submitted).toContain('/clear');
  });
});
