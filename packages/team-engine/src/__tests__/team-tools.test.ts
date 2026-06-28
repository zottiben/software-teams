import { beforeEach, describe, expect, test } from 'bun:test';
import { Broker } from '../broker/broker';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import { TEAM_TOOLS, TeamTools } from '../mcp/team-tools';
import type { AgentSpec } from '../types';
import { FakePane } from './helpers/fake-pane';

function spec(name: string, role: string, isLead = false): AgentSpec {
  return { name, role, persona: `p:${role}`, isLead };
}

const ORCH = spec('software-teams-orchestrator', 'orchestrator', true);
const FE = spec('software-teams-frontend', 'frontend');
const BE = spec('software-teams-backend', 'backend');

describe('TeamTools', () => {
  let broker: Broker;
  let tools: TeamTools;
  let orch: FakePane;
  let fe: FakePane;
  let be: FakePane;

  beforeEach(() => {
    broker = new Broker(new ClaudeCodeAdapter());
    tools = new TeamTools(broker);
    orch = new FakePane(ORCH.name);
    fe = new FakePane(FE.name);
    be = new FakePane(BE.name);
    broker.registerPane(ORCH, orch);
    broker.registerPane(FE, fe);
    broker.registerPane(BE, be);
  });

  test('roster lists every teammate with status', () => {
    const result = tools.dispatch('team_roster', ORCH.name, {});
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain(FE.name);
    expect(result.text).toContain('[lead]');
  });

  test('team_send delivers to an idle peer', () => {
    const result = tools.dispatch('team_send', FE.name, { to: BE.name, body: 'Need /users endpoint' });
    expect(result.isError).toBeUndefined();
    expect(be.submitted[0]).toContain('Need /users endpoint');
  });

  test('team_send to a stranger returns an error result (not a throw)', () => {
    const result = tools.dispatch('team_send', FE.name, { to: 'nobody', body: 'hi' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('nobody');
  });

  test('team_send validates required args', () => {
    const result = tools.dispatch('team_send', FE.name, { to: BE.name });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('body');
  });

  test('team_delegate tracks a delegation and auto-generates a ref', () => {
    const result = tools.dispatch('team_delegate', ORCH.name, { to: FE.name, task: 'Build login' });
    expect(result.text).toMatch(/Delegated to .*frontend as D1/);
    const board = broker.status();
    expect(board.delegations).toHaveLength(1);
    expect(board.delegations[0]?.to).toBe(FE.name);
  });

  test('team_delegate honours an explicit ref, team_report closes it', () => {
    tools.dispatch('team_delegate', ORCH.name, { to: BE.name, task: 'Add /healthz', ref: 'T1' });
    const report = tools.dispatch('team_report', BE.name, { summary: 'done abc123', ref: 'T1' });
    expect(report.text).toContain(ORCH.name); // defaulted to the lead
    const record = broker.status().delegations.find((d) => d.correlationId === 'T1');
    expect(record?.status).toBe('reported');
    expect(record?.report).toContain('abc123');
  });

  test('team_status renders the board', () => {
    tools.dispatch('team_delegate', ORCH.name, { to: FE.name, task: 'X', ref: 'T7' });
    const result = tools.dispatch('team_status', ORCH.name, {});
    expect(result.text).toContain('T7');
    expect(result.text).toContain('dispatched');
  });

  test('every declared tool is dispatchable', () => {
    for (const def of TEAM_TOOLS) {
      // missing-arg calls should never throw — they return error results
      const result = tools.dispatch(def.name, ORCH.name, {});
      expect(typeof result.text).toBe('string');
    }
  });

  test('unknown tool name yields an error result', () => {
    const result = tools.dispatch('team_nope', ORCH.name, {});
    expect(result.isError).toBe(true);
  });
});
