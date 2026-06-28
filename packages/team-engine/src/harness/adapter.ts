import type { LaunchSpec, PaneConfig, TeamMessage } from '../types';

/**
 * A harness adapter knows how to launch and drive one kind of CLI coding agent
 * (Claude Code today; OpenCode and others slot in later). The engine, broker, and
 * UI are written entirely against this interface — nothing else may shell out to a
 * harness binary directly.
 */
export interface HarnessAdapter {
  /** Stable identifier, e.g. `claude-code`. */
  readonly id: string;

  /**
   * Build the process launch description for a pane: binary, argv (persona,
   * MCP config, permission mode), cwd (the pane's worktree), and environment.
   */
  buildLaunch(config: PaneConfig): LaunchSpec;

  /**
   * The in-session text that resets context without killing the process, written
   * to the pane's stdin (e.g. `/clear`). Returned without a trailing newline; the
   * caller appends the submit keystroke.
   */
  clearCommand(): string;

  /**
   * Render a brokered message as the body of a user turn to be injected into the
   * recipient pane's stdin. Adapters format this so the model clearly sees who it
   * is from and how to reply (via the `team_*` tools).
   */
  formatIncoming(message: TeamMessage): string;
}
