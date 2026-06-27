/**
 * Core domain types for the Software Teams Team Engine.
 *
 * The engine runs a persistent team of harness panes (each pane = one long-lived
 * `claude` process pinned to a single specialist persona) and brokers messages
 * between them. These types are harness-agnostic; harness-specific launch details
 * live behind {@link HarnessAdapter}.
 */

/** Claude Code permission modes accepted at launch (`--permission-mode`). */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'auto'
  | 'dontAsk'
  | 'bypassPermissions';

/**
 * A specialist persona pinned to a pane. `name` is the addressable identity used
 * for messaging (e.g. `software-teams-frontend`); `role` is the short routing key
 * (e.g. `frontend`); `persona` is the system-prompt text injected at launch.
 */
export interface AgentSpec {
  /** Addressable identity, matches a `.claude/agents/<name>.md` / canonical persona file. */
  readonly name: string;
  /** Short routing key used by the orchestrator and UI (e.g. `frontend`, `orchestrator`). */
  readonly role: string;
  /** System-prompt text injected via the harness (frontmatter already stripped). */
  readonly persona: string;
  /** True for the single pane the human drives directly (the orchestrator). */
  readonly isLead: boolean;
}

/**
 * Everything the engine needs to launch one pane. The working directory is the
 * pane's own git worktree (per-agent isolation); `mcpConfigPath` points at the
 * broker's generated MCP config so the pane gets the `team_*` tools.
 */
export interface PaneConfig {
  readonly agent: AgentSpec;
  /** Absolute path to this pane's git worktree (its isolated checkout). */
  readonly cwd: string;
  /** Absolute path to the generated `--mcp-config` file wiring the broker tools. */
  readonly mcpConfigPath: string;
  readonly permissionMode: PermissionMode;
  /**
   * Path to a file holding the persona; preferred over the inline string so the
   * launch fits cleanly on a command line (`--append-system-prompt-file`).
   */
  readonly personaFile?: string;
  /**
   * Path to a generated settings file merged at launch (`--settings`) — carries
   * this pane's Stop hook for idle signalling without touching project settings.
   */
  readonly settingsPath?: string;
  /** Extra environment for the child process (e.g. the broker URL/token, agent id). */
  readonly env?: Readonly<Record<string, string>>;
}

/** A concrete process launch description produced by a {@link HarnessAdapter}. */
export interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** How one pane addresses another, plus the kind of traffic. */
export type MessageKind = 'send' | 'broadcast' | 'delegate' | 'report';

/** A brokered message between panes. */
export interface TeamMessage {
  readonly id: string;
  readonly kind: MessageKind;
  /** Sender agent name. */
  readonly from: string;
  /** Recipient agent name, or `null` for a broadcast. */
  readonly to: string | null;
  readonly body: string;
  /** Monotonic sequence assigned by the broker on receipt (ordering / dedupe). */
  readonly seq: number;
  /** For `delegate`/`report`: correlates a task dispatch with its report. */
  readonly correlationId?: string;
}

/** Lifecycle/activity state of a pane, surfaced to the UI and used for delivery gating. */
export type PaneStatus = 'starting' | 'idle' | 'busy' | 'exited';
