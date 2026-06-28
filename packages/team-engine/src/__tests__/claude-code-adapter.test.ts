import { describe, expect, test } from 'bun:test';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import { getHarnessAdapter } from '../index';
import type { AgentSpec, PaneConfig, TeamMessage } from '../types';

const agent: AgentSpec = {
  name: 'software-teams-frontend',
  role: 'frontend',
  persona: 'You are the frontend specialist. Persona text here.',
  isLead: false,
};

const config: PaneConfig = {
  agent,
  cwd: '/tmp/worktrees/frontend',
  mcpConfigPath: '/tmp/team/mcp.json',
  permissionMode: 'acceptEdits',
  env: { ST_AGENT: 'software-teams-frontend' },
};

/** Return the argv value immediately after `flag`, asserting it is present. */
function argAfter(args: readonly string[], flag: string): string {
  const i = args.indexOf(flag);
  const value = i >= 0 ? args[i + 1] : undefined;
  if (value === undefined) throw new Error(`expected a value after ${flag}`);
  return value;
}

describe('ClaudeCodeAdapter.buildLaunch', () => {
  const launch = new ClaudeCodeAdapter().buildLaunch(config);

  test('invokes the claude binary in the pane worktree', () => {
    expect(launch.command).toBe('claude');
    expect(launch.cwd).toBe('/tmp/worktrees/frontend');
  });

  test('pins the persona via --append-system-prompt', () => {
    expect(argAfter(launch.args, '--append-system-prompt')).toBe(agent.persona);
  });

  test('attaches only the broker MCP config', () => {
    expect(argAfter(launch.args, '--mcp-config')).toBe('/tmp/team/mcp.json');
    expect(launch.args).toContain('--strict-mcp-config');
  });

  test('sets the requested permission mode', () => {
    expect(argAfter(launch.args, '--permission-mode')).toBe('acceptEdits');
  });

  test('merges pane env over the inherited process env', () => {
    expect(launch.env.ST_AGENT).toBe('software-teams-frontend');
    const inheritedPath = process.env.PATH;
    if (inheritedPath !== undefined) {
      expect(launch.env.PATH).toBe(inheritedPath);
    }
  });
});

describe('ClaudeCodeAdapter control + delivery formatting', () => {
  const adapter = new ClaudeCodeAdapter();

  test('clearCommand is /clear', () => {
    expect(adapter.clearCommand()).toBe('/clear');
  });

  test('formatIncoming labels a delegated task with its correlation id', () => {
    const msg: TeamMessage = {
      id: 'm1',
      kind: 'delegate',
      from: 'software-teams-orchestrator',
      to: 'software-teams-frontend',
      body: 'Build the login form.',
      seq: 1,
      correlationId: 'T3',
    };
    const rendered = adapter.formatIncoming(msg);
    expect(rendered).toContain('[ref:T3]');
    expect(rendered).toContain('delegated to you by software-teams-orchestrator');
    expect(rendered).toContain('Build the login form.');
    expect(rendered).toContain('team_report');
  });
});

describe('getHarnessAdapter', () => {
  test('returns the claude-code adapter by default', () => {
    expect(getHarnessAdapter().id).toBe('claude-code');
  });

  test('throws on an unknown harness', () => {
    expect(() => getHarnessAdapter('opencode')).toThrow(/Unknown harness/);
  });
});

describe('ClaudeCodeAdapter.buildLaunch file-based persona + settings', () => {
  const launch = new ClaudeCodeAdapter().buildLaunch({
    agent,
    cwd: '/tmp/wt',
    mcpConfigPath: '/tmp/mcp.json',
    personaFile: '/tmp/personas/frontend.md',
    settingsPath: '/tmp/settings/frontend.settings.json',
    permissionMode: 'acceptEdits',
  });

  test('uses --append-system-prompt-file when a persona file is given', () => {
    const i = launch.args.indexOf('--append-system-prompt-file');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(launch.args[i + 1]).toBe('/tmp/personas/frontend.md');
    expect(launch.args).not.toContain('--append-system-prompt');
  });

  test('passes the merged settings file via --settings', () => {
    const i = launch.args.indexOf('--settings');
    expect(launch.args[i + 1]).toBe('/tmp/settings/frontend.settings.json');
  });
});

describe('ClaudeCodeAdapter.buildLaunch model pinning', () => {
  test('adds --model when the agent has a resolved model', () => {
    const launch = new ClaudeCodeAdapter().buildLaunch({
      ...config,
      agent: { ...agent, model: 'claude-sonnet-4-6' },
    });
    expect(argAfter(launch.args, '--model')).toBe('claude-sonnet-4-6');
  });

  test('omits --model when the agent has no model (harness default)', () => {
    const launch = new ClaudeCodeAdapter().buildLaunch(config);
    expect(launch.args).not.toContain('--model');
  });
});
