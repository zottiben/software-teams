import { describe, expect, test } from 'bun:test';
import { decideTaskRoute } from '../hooks/route';

const roster = ['software-teams-orchestrator', 'software-teams-backend', 'software-teams-frontend'];

describe('decideTaskRoute', () => {
  test('blocks a Task that spawns a live teammate', () => {
    const decision = decideTaskRoute(
      { tool_name: 'Task', tool_input: { subagent_type: 'software-teams-backend' } },
      roster,
    );
    expect(decision.deny).toBe(true);
    expect(decision.message).toContain('software-teams-backend');
    expect(decision.message).toContain('team_delegate');
  });

  test('allows a Task for an agent that is NOT a live pane', () => {
    const decision = decideTaskRoute(
      { tool_name: 'Task', tool_input: { subagent_type: 'general-purpose' } },
      roster,
    );
    expect(decision.deny).toBe(false);
  });

  test('allows non-Task tools', () => {
    expect(decideTaskRoute({ tool_name: 'Bash', tool_input: {} }, roster).deny).toBe(false);
  });

  test('never interferes inside a subagent context (agent_id present)', () => {
    const decision = decideTaskRoute(
      { tool_name: 'Task', tool_input: { subagent_type: 'software-teams-backend' }, agent_id: 'a1' },
      roster,
    );
    expect(decision.deny).toBe(false);
  });

  test('allows a malformed/empty payload', () => {
    expect(decideTaskRoute({}, roster).deny).toBe(false);
  });
});
