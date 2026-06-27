/**
 * @websitelabs/software-teams-engine
 *
 * Headless core for the live-team feature: launches a persistent set of harness
 * panes (each a `claude` process pinned to one specialist persona, isolated in its
 * own git worktree) and brokers messages between them. Consumed by the tmux harness
 * (validation) and the Electron app (the GUI).
 */
export * from './types';
export type { HarnessAdapter } from './harness/adapter';
export { ClaudeCodeAdapter } from './harness/claude-code';

export type { Pane, Unsubscribe } from './pane/pane';
export { IdleDetector } from './pane/idle';
export { PtyPane, type PtyPaneOptions } from './pane/pty-pane';
export { ensureSpawnHelperExecutable } from './pane/spawn-helper';

export {
  Broker,
  UnknownRecipientError,
  type MessageInput,
  type DelegationRecord,
  type ActivityEntry,
  type RosterMember,
  type TeamStatus,
} from './broker/broker';

export { TeamTools, TEAM_TOOLS, type TeamToolDef, type ToolResult } from './mcp/team-tools';
export { ControlServer, type ControlServerOptions } from './mcp/control-server';
export {
  buildMcpConfig,
  writeMcpConfig,
  type McpConfigInput,
  type McpConfigDocument,
} from './mcp/mcp-config';
export {
  buildPaneSettings,
  writePaneSettings,
  type SettingsDocument,
  type PaneSettingsInput,
  type TaskRouteHook,
} from './mcp/settings';

export { Tmux, type TmuxOptions } from './tmux/tmux';
export { TmuxPane, type TmuxDriver } from './tmux/tmux-pane';
export { launchTmux, type LaunchTmuxOptions, type TmuxTeam } from './tmux/launch';

export {
  DEFAULT_TEAM,
  defaultAgentsDir,
  loadPersona,
  type PersonaFile,
  type RosterSlot,
} from './persona/persona';
export { DEFAULT_ORCHESTRATOR_PERSONA } from './persona/orchestrator';
export {
  ORCHESTRATOR_NAME,
  buildOrchestratorPersona,
  buildSpecialistPersona,
} from './persona/overlay';

export { decideTaskRoute, type HookPayload, type RouteDecision } from './hooks/route';

export { WorktreeManager, type WorktreeInfo, type ProvisionOptions } from './worktree/worktree';

export {
  TeamEngine,
  defaultProxyPath,
  defaultRouteHookPath,
  type TeamEngineOptions,
  type PaneFactory,
} from './engine';

import type { HarnessAdapter } from './harness/adapter';
import { ClaudeCodeAdapter } from './harness/claude-code';

/** Built-in harness adapters, keyed by {@link HarnessAdapter.id}. */
export const HARNESS_ADAPTERS: ReadonlyMap<string, HarnessAdapter> = new Map([
  ['claude-code', new ClaudeCodeAdapter()],
]);

/** Resolve a harness adapter by id, defaulting to Claude Code. */
export function getHarnessAdapter(id = 'claude-code'): HarnessAdapter {
  const adapter = HARNESS_ADAPTERS.get(id);
  if (!adapter) {
    throw new Error(
      `Unknown harness '${id}'. Available: ${[...HARNESS_ADAPTERS.keys()].join(', ')}`,
    );
  }
  return adapter;
}
