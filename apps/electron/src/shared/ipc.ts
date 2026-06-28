/**
 * IPC contract shared by the main process, preload bridge, and renderer.
 *
 * Every per-team message carries a `sessionId` (a tab). The main process runs one
 * independent {@link TeamSession} per session id (its own engine, broker, control
 * server, panes and worktrees); the renderer shows one tab per session id.
 */

export const IPC = {
  /** renderer → main: list running sessions (reconnect after a reload). */
  getState: 'team:get-state',
  /** renderer → main: pick a repo directory (returns a path or null). */
  pickRepo: 'team:pick-repo',
  /** renderer → main: start a team for a tab against a repo path. */
  startTeam: 'team:start',
  /** renderer → main: stop a tab's team. */
  stopTeam: 'team:stop',
  /** main → renderer: a tab's team is up; carries the agent list. */
  ready: 'team:ready',
  /** main → renderer: a chunk of a pane's terminal output. */
  paneOutput: 'team:pane-output',
  /** renderer → main: raw keystrokes for a pane. */
  paneInput: 'team:pane-input',
  /** renderer → main: resize a pane's PTY to match its terminal view. */
  resize: 'team:resize',
  /** renderer → main: reset one pane's context (/clear). */
  clear: 'team:clear',
  /** renderer → main: reset every pane in a tab. */
  clearAll: 'team:clear-all',
  /** main → renderer: a new inter-agent activity entry. */
  activity: 'team:activity',
  /** main → renderer: a fresh roster/status snapshot. */
  roster: 'team:roster',
  /** main → renderer: a non-fatal error/notice to surface. */
  notice: 'team:notice',
} as const;

export interface AgentDescriptor {
  readonly name: string;
  readonly role: string;
  readonly isLead: boolean;
}

export interface StartTeamRequest {
  readonly sessionId: string;
  readonly repoRoot: string;
}

export interface StopTeamRequest {
  readonly sessionId: string;
}

export interface TeamReadyMsg {
  readonly sessionId: string;
  readonly agents: readonly AgentDescriptor[];
  readonly repoRoot: string;
}

export interface SessionState {
  readonly sessionId: string;
  readonly agents: readonly AgentDescriptor[];
  readonly repoRoot: string;
}

export interface SessionsStateResponse {
  readonly sessions: readonly SessionState[];
}

export interface PaneOutputMsg {
  readonly sessionId: string;
  readonly agent: string;
  readonly chunk: string;
}

export interface PaneInputMsg {
  readonly sessionId: string;
  readonly agent: string;
  readonly data: string;
}

export interface ResizeMsg {
  readonly sessionId: string;
  readonly agent: string;
  readonly cols: number;
  readonly rows: number;
}

export interface ClearMsg {
  readonly sessionId: string;
  readonly agent: string;
}

export interface ClearAllMsg {
  readonly sessionId: string;
}

export interface ActivityMsg {
  readonly sessionId: string;
  readonly seq: number;
  readonly from: string;
  readonly to: string | null;
  readonly kind: string;
  readonly summary: string;
}

export interface RosterMemberMsg {
  readonly name: string;
  readonly role: string;
  readonly isLead: boolean;
  readonly status: string;
  readonly queued: number;
}

export interface RosterMsg {
  readonly sessionId: string;
  readonly roster: readonly RosterMemberMsg[];
}

export interface NoticeMsg {
  readonly sessionId?: string;
  readonly level: 'info' | 'error';
  readonly text: string;
}

/** The safe API the preload bridge exposes on `window.teamApi` for the renderer. */
export interface TeamApi {
  getState(): Promise<SessionsStateResponse>;
  pickRepo(): Promise<string | null>;
  startTeam(sessionId: string, repoRoot: string): Promise<{ ok: boolean; error?: string }>;
  stopTeam(sessionId: string): Promise<{ ok: boolean }>;
  sendInput(sessionId: string, agent: string, data: string): void;
  resize(sessionId: string, agent: string, cols: number, rows: number): void;
  clear(sessionId: string, agent: string): void;
  clearAll(sessionId: string): void;
  onReady(cb: (msg: TeamReadyMsg) => void): () => void;
  onPaneOutput(cb: (msg: PaneOutputMsg) => void): () => void;
  onActivity(cb: (msg: ActivityMsg) => void): () => void;
  onRoster(cb: (msg: RosterMsg) => void): () => void;
  onNotice(cb: (msg: NoticeMsg) => void): () => void;
}
