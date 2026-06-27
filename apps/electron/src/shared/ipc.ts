/**
 * IPC contract shared by the main process, preload bridge, and renderer. Keeping
 * the channel names and payload shapes in one place lets all three sides stay in
 * sync and lets the payload builders be unit-tested without Electron.
 */

export const IPC = {
  /** renderer → main: get the current team state (for reconnect after a reload). */
  getState: 'team:get-state',
  /** renderer → main: start a team against a repo path. */
  startTeam: 'team:start',
  /** renderer → main: pick a repo directory (returns a path or null). */
  pickRepo: 'team:pick-repo',
  /** renderer → main: stop the team. */
  stopTeam: 'team:stop',
  /** main → renderer: the team is up; carries the agent list. */
  ready: 'team:ready',
  /** main → renderer: a chunk of a pane's terminal output. */
  paneOutput: 'team:pane-output',
  /** renderer → main: raw keystrokes for a pane. */
  paneInput: 'team:pane-input',
  /** renderer → main: resize a pane's PTY to match its terminal view. */
  resize: 'team:resize',
  /** renderer → main: reset one pane's context (/clear). */
  clear: 'team:clear',
  /** renderer → main: reset every pane. */
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
  readonly repoRoot: string;
}

export interface TeamReadyMsg {
  readonly agents: readonly AgentDescriptor[];
  readonly repoRoot: string;
}

export interface TeamStateResponse {
  readonly running: boolean;
  readonly agents: readonly AgentDescriptor[];
  readonly repoRoot: string;
}

export interface PaneOutputMsg {
  readonly agent: string;
  readonly chunk: string;
}

export interface PaneInputMsg {
  readonly agent: string;
  readonly data: string;
}

export interface ResizeMsg {
  readonly agent: string;
  readonly cols: number;
  readonly rows: number;
}

export interface ClearMsg {
  readonly agent: string;
}

export interface ActivityMsg {
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
  readonly roster: readonly RosterMemberMsg[];
}

export interface NoticeMsg {
  readonly level: 'info' | 'error';
  readonly text: string;
}

/** The safe API the preload bridge exposes on `window.teamApi` for the renderer. */
export interface TeamApi {
  getState(): Promise<TeamStateResponse>;
  pickRepo(): Promise<string | null>;
  startTeam(repoRoot: string): Promise<{ ok: boolean; error?: string }>;
  stopTeam(): Promise<{ ok: boolean }>;
  sendInput(agent: string, data: string): void;
  resize(agent: string, cols: number, rows: number): void;
  clear(agent: string): void;
  clearAll(): void;
  onReady(cb: (msg: TeamReadyMsg) => void): () => void;
  onPaneOutput(cb: (msg: PaneOutputMsg) => void): () => void;
  onActivity(cb: (msg: ActivityMsg) => void): () => void;
  onRoster(cb: (msg: RosterMsg) => void): () => void;
  onNotice(cb: (msg: NoticeMsg) => void): () => void;
}
