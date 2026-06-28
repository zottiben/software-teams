import { describe, expect, test } from 'bun:test';
import { DEFAULT_TEAM, defaultAgentsDir, loadPersona } from '../persona/persona';

describe('persona loader (reuses CLI canonical specs)', () => {
  test('resolves the CLI agents directory in the monorepo', () => {
    const dir = defaultAgentsDir();
    expect(dir).toContain('packages/cli/agents');
  });

  test('loads a specialist persona with frontmatter stripped', () => {
    const p = loadPersona('software-teams-frontend');
    expect(p.name).toBe('software-teams-frontend');
    expect(p.model).toBe('sonnet');
    expect(p.persona.startsWith('---')).toBe(false);
    expect(p.persona).toContain('Frontend Engineer');
    // frontmatter keys must not leak into the persona body
    expect(p.persona).not.toContain('tools:');
  });

  test('every default-team agent file exists and loads', () => {
    for (const slot of DEFAULT_TEAM) {
      const p = loadPersona(slot.agent);
      expect(p.persona.length).toBeGreaterThan(50);
    }
  });
});
