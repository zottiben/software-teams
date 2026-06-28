import { describe, expect, test } from 'bun:test';
import { buildOrchestratorPersona, buildSpecialistPersona } from '../persona/overlay';
import { DEFAULT_TEAM } from '../persona/persona';

describe('buildOrchestratorPersona', () => {
  const persona = buildOrchestratorPersona(DEFAULT_TEAM);

  test('enumerates each open teammate by name', () => {
    for (const slot of DEFAULT_TEAM) {
      expect(persona).toContain(slot.agent);
    }
  });

  test('routes spawning to team_delegate, not the Task tool', () => {
    expect(persona).toContain('team_delegate');
    expect(persona).toMatch(/NEVER spawn a specialist with the .?Task.? tool/);
  });

  test('maps the Software Teams skills to panes mode', () => {
    expect(persona).toContain('/st:create-plan');
    expect(persona).toContain('/st:implement-plan');
  });
});

describe('buildSpecialistPersona', () => {
  const composed = buildSpecialistPersona('software-teams-backend', 'backend', 'BASE PERSONA BODY');

  test('keeps the canonical persona and appends the team addendum', () => {
    expect(composed).toContain('BASE PERSONA BODY');
    expect(composed).toContain('software-teams-backend');
    expect(composed).toContain('team_report');
    expect(composed).toContain('team_send');
  });
});
