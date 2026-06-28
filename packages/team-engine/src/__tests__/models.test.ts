import { describe, expect, test } from 'bun:test';
import { loadModelMap, resolveAgentModel } from '../persona/models';

describe('loadModelMap (active profile from the monorepo config.yaml)', () => {
  const map = loadModelMap();

  test('resolves high-reasoning roles to an opus model', () => {
    expect(map.architect).toContain('opus');
    expect(map.planner).toContain('opus');
  });

  test('resolves implementation/QA roles to a sonnet model', () => {
    expect(map['qa-tester']).toContain('sonnet');
    expect(map.devops).toContain('sonnet');
  });
});

describe('resolveAgentModel', () => {
  const map = { architect: 'claude-opus-4-8', frontend: 'claude-opus-4-6' };

  test('config profile wins, keyed by the name minus software-teams-', () => {
    expect(resolveAgentModel('software-teams-architect', 'opus', map)).toBe('claude-opus-4-8');
    expect(resolveAgentModel('software-teams-frontend', 'sonnet', map)).toBe('claude-opus-4-6');
  });

  test('falls back to the frontmatter alias when not in the profile', () => {
    expect(resolveAgentModel('software-teams-debugger', 'haiku', map)).toBe('haiku');
  });

  test('returns undefined when neither config nor frontmatter provides a model', () => {
    expect(resolveAgentModel('software-teams-orchestrator', undefined, map)).toBeUndefined();
  });
});
