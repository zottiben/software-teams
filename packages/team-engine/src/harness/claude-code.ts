import type { HarnessAdapter } from './adapter';
import type { LaunchSpec, PaneConfig, TeamMessage } from '../types';

/** Strip `undefined`-valued keys so the result satisfies `Record<string, string>`. */
function definedEnv(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** One-line lead-in describing how a delivered message should be read by the model. */
function leadIn(message: TeamMessage): string {
  switch (message.kind) {
    case 'delegate':
      return `New task delegated to you by ${message.from}`;
    case 'report':
      return `Progress report from ${message.from}`;
    case 'broadcast':
      return `Broadcast from ${message.from} to the whole team`;
    case 'send':
    default:
      return `Message from ${message.from}`;
  }
}

/**
 * Adapter for Anthropic's Claude Code CLI (`claude`).
 *
 * Launch contract (all verified against the current CLI reference):
 *  - persona pinned with `--append-system-prompt` (interactive-safe)
 *  - broker tools attached with `--mcp-config` + `--strict-mcp-config`
 *  - unattended editing via `--permission-mode`
 *  - context reset in-session with `/clear` (process survives)
 *  - inbound delivery is a user turn written to stdin (handled by the pane)
 */
export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = 'claude-code';

  buildLaunch(config: PaneConfig): LaunchSpec {
    const personaArgs = config.personaFile
      ? ['--append-system-prompt-file', config.personaFile]
      : ['--append-system-prompt', config.agent.persona];
    const settingsArgs = config.settingsPath ? ['--settings', config.settingsPath] : [];
    const args: readonly string[] = [
      ...personaArgs,
      '--mcp-config',
      config.mcpConfigPath,
      '--strict-mcp-config',
      '--permission-mode',
      config.permissionMode,
      ...settingsArgs,
    ];
    return {
      command: 'claude',
      args,
      cwd: config.cwd,
      env: definedEnv({ ...process.env, ...config.env }),
    };
  }

  clearCommand(): string {
    return '/clear';
  }

  formatIncoming(message: TeamMessage): string {
    const correlation = message.correlationId ? ` [ref:${message.correlationId}]` : '';
    return (
      `[team]${correlation} ${leadIn(message)}:\n\n` +
      `${message.body}\n\n` +
      `(Reply with the team tools: use \`team_report\` to update the orchestrator on a delegated task, ` +
      `or \`team_send\` to reach a specific teammate by name.)`
    );
  }
}
