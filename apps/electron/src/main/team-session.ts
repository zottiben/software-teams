import type { TeamEngine, Unsubscribe } from '@websitelabs/software-teams-engine';
import type { AgentDescriptor, RosterMemberMsg } from '../shared/ipc';

/** Session-less chunks; `main` stamps the tab's sessionId before sending to the renderer. */
export interface PaneChunk {
  readonly agent: string;
  readonly chunk: string;
}

export interface ActivityChunk {
  readonly seq: number;
  readonly from: string;
  readonly to: string | null;
  readonly kind: string;
  readonly summary: string;
}

/**
 * Wraps a running {@link TeamEngine} for the GUI: it bridges each pane's terminal
 * output and the broker's activity feed out to listeners (the IPC layer), and
 * routes the renderer's input/clear/resize commands back into the panes. Pure of
 * Electron, so it is unit-tested with the engine's FakePane factory.
 */
export class TeamSession {
  private readonly unsubs: Unsubscribe[] = [];

  constructor(private readonly engine: TeamEngine) {}

  /** The agents in this team (orchestrator first, by registration order). */
  agents(): AgentDescriptor[] {
    return this.engine.broker
      .status()
      .roster.map((member) => ({ name: member.name, role: member.role, isLead: member.isLead }));
  }

  /** Stream every pane's raw terminal output to `listener`. */
  onOutput(listener: (output: PaneChunk) => void): void {
    for (const [name, pane] of this.engine.panes) {
      this.unsubs.push(pane.onOutput((chunk) => listener({ agent: name, chunk })));
    }
  }

  /** Stream inter-agent activity to `listener` (the orchestrator's awareness feed). */
  onActivity(listener: (activity: ActivityChunk) => void): void {
    this.unsubs.push(
      this.engine.broker.onActivity((entry) =>
        listener({
          seq: entry.seq,
          from: entry.from,
          to: entry.to,
          kind: entry.kind,
          summary: entry.summary,
        }),
      ),
    );
  }

  /** Current roster + per-pane status for the UI badges. */
  roster(): RosterMemberMsg[] {
    return this.engine.broker.status().roster.map((member) => ({
      name: member.name,
      role: member.role,
      isLead: member.isLead,
      status: member.status,
      queued: member.queued,
    }));
  }

  /** Forward raw keystrokes from a terminal into a pane. */
  input(agent: string, data: string): void {
    this.engine.panes.get(agent)?.write(data);
  }

  /** Resize a pane's PTY to match its terminal view. */
  resize(agent: string, cols: number, rows: number): void {
    this.engine.panes.get(agent)?.resize(cols, rows);
  }

  clear(agent: string): void {
    this.engine.clear(agent);
  }

  clearAll(): void {
    this.engine.clearAll();
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    await this.engine.stop();
  }
}
