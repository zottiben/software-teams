import type { HarnessAdapter } from '../harness/adapter';
import type { AgentSpec, MessageKind, PaneStatus, TeamMessage } from '../types';
import type { Pane, Unsubscribe } from '../pane/pane';

/** Caller-supplied fields for a new message; the broker assigns `id`/`seq`. */
export interface MessageInput {
  readonly kind: MessageKind;
  readonly from: string;
  readonly to: string | null;
  readonly body: string;
  readonly correlationId?: string;
}

/** A tracked task dispatch (orchestrator → specialist) and its eventual report. */
export interface DelegationRecord {
  readonly correlationId: string;
  readonly from: string;
  readonly to: string;
  readonly task: string;
  status: 'dispatched' | 'reported';
  report?: string;
}

/** One entry in the team activity feed surfaced to the UI and `team_status`. */
export interface ActivityEntry {
  readonly seq: number;
  readonly kind: MessageKind;
  readonly from: string;
  readonly to: string | null;
  readonly summary: string;
}

/** Snapshot of who is on the team and what they are doing right now. */
export interface RosterMember {
  readonly name: string;
  readonly role: string;
  readonly isLead: boolean;
  readonly status: PaneStatus;
  readonly queued: number;
}

/** The board returned by `team_status`. */
export interface TeamStatus {
  readonly roster: readonly RosterMember[];
  readonly delegations: readonly DelegationRecord[];
  readonly recentActivity: readonly ActivityEntry[];
}

/** Thrown when a message targets an agent that is not on the team. */
export class UnknownRecipientError extends Error {
  constructor(
    readonly recipient: string,
    readonly known: readonly string[],
  ) {
    super(`Unknown teammate '${recipient}'. On the team: ${known.join(', ') || '(none)'}.`);
    this.name = 'UnknownRecipientError';
  }
}

interface PaneEntry {
  readonly spec: AgentSpec;
  readonly pane: Pane;
  readonly queue: TeamMessage[];
  readonly unsubscribe: Unsubscribe;
}

const ACTIVITY_LIMIT = 200;

/**
 * The Broker is the engine's message bus. Panes register with it; the MCP tools
 * call {@link Broker.submit} to send/delegate/report/broadcast; the broker queues
 * each message and delivers it into the recipient pane as a user turn the moment
 * that pane is idle (one message per idle, so deliveries never interleave with an
 * in-flight turn). Peer-to-peer traffic is recorded in an activity feed the lead
 * (orchestrator) can pull via `team_status`, keeping it updated without derailing
 * it with injected chatter.
 */
export class Broker {
  private readonly panes = new Map<string, PaneEntry>();
  private readonly delegations = new Map<string, DelegationRecord>();
  private readonly activity: ActivityEntry[] = [];
  private readonly activityListeners = new Set<(entry: ActivityEntry) => void>();
  private seqCounter = 0;

  constructor(private readonly adapter: HarnessAdapter) {}

  /** Register a running pane and wire its idle/exit signals to delivery. */
  registerPane(spec: AgentSpec, pane: Pane): void {
    const offIdle = pane.onIdle(() => this.flush(spec.name));
    const offExit = pane.onExit(() => this.panes.delete(spec.name));
    const unsubscribe = (): void => {
      offIdle();
      offExit();
    };
    this.panes.set(spec.name, { spec, pane, queue: [], unsubscribe });
  }

  /** The single lead/orchestrator pane spec, if one is registered. */
  lead(): AgentSpec | undefined {
    return [...this.panes.values()].find((entry) => entry.spec.isLead)?.spec;
  }

  /** All registered agent names. */
  names(): readonly string[] {
    return [...this.panes.keys()];
  }

  /**
   * Accept an outbound message from a pane's MCP tool. Assigns identity/sequence,
   * records activity, updates the delegation board, enqueues for the recipient(s),
   * and attempts immediate delivery if a recipient is already idle.
   *
   * @throws {UnknownRecipientError} when a directed message targets a stranger.
   */
  submit(input: MessageInput): TeamMessage {
    this.seqCounter += 1;
    const seq = this.seqCounter;
    const message: TeamMessage = {
      id: `m${seq}`,
      seq,
      kind: input.kind,
      from: input.from,
      to: input.to,
      body: input.body,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };

    this.record(message);
    this.updateDelegations(message);

    if (message.kind === 'broadcast') {
      this.recipientsForBroadcast(message.from).forEach((name) => this.enqueue(name, message));
      return message;
    }

    const recipient = message.to;
    if (recipient === null) {
      throw new UnknownRecipientError('(none)', this.names());
    }
    if (!this.panes.has(recipient)) {
      throw new UnknownRecipientError(recipient, this.names());
    }
    this.enqueue(recipient, message);
    return message;
  }

  /** Inject the harness clear command into one pane (resets its context). */
  clear(name: string): void {
    const entry = this.panes.get(name);
    if (!entry) throw new UnknownRecipientError(name, this.names());
    entry.pane.submit(this.adapter.clearCommand());
  }

  /** Clear every pane's context. */
  clearAll(): void {
    this.panes.forEach((entry) => entry.pane.submit(this.adapter.clearCommand()));
  }

  /** Current team board for the UI / `team_status`. */
  status(): TeamStatus {
    const roster: RosterMember[] = [...this.panes.values()].map((entry) => ({
      name: entry.spec.name,
      role: entry.spec.role,
      isLead: entry.spec.isLead,
      status: entry.pane.status(),
      queued: entry.queue.length,
    }));
    return {
      roster,
      delegations: [...this.delegations.values()],
      recentActivity: this.activity.slice(-50),
    };
  }

  /** Subscribe to the live activity feed (used by the GUI). */
  onActivity(listener: (entry: ActivityEntry) => void): Unsubscribe {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  /** Tear down all pane subscriptions (does not kill the processes). */
  dispose(): void {
    this.panes.forEach((entry) => entry.unsubscribe());
    this.panes.clear();
    this.activityListeners.clear();
  }

  private recipientsForBroadcast(from: string): readonly string[] {
    return [...this.panes.keys()].filter((name) => name !== from);
  }

  private enqueue(name: string, message: TeamMessage): void {
    const entry = this.panes.get(name);
    if (!entry) throw new UnknownRecipientError(name, this.names());
    entry.queue.push(message);
    this.flush(name);
  }

  /** Deliver at most one queued message into a pane, only while it is idle. */
  private flush(name: string): void {
    const entry = this.panes.get(name);
    if (!entry || entry.pane.status() !== 'idle') return;
    const next = entry.queue.shift();
    if (!next) return;
    entry.pane.submit(this.adapter.formatIncoming(next));
  }

  private updateDelegations(message: TeamMessage): void {
    if (message.kind === 'delegate' && message.correlationId && message.to) {
      this.delegations.set(message.correlationId, {
        correlationId: message.correlationId,
        from: message.from,
        to: message.to,
        task: message.body,
        status: 'dispatched',
      });
      return;
    }
    if (message.kind === 'report' && message.correlationId) {
      const existing = this.delegations.get(message.correlationId);
      if (existing) {
        existing.status = 'reported';
        existing.report = message.body;
      }
    }
  }

  private record(message: TeamMessage): void {
    const entry: ActivityEntry = {
      seq: message.seq,
      kind: message.kind,
      from: message.from,
      to: message.to,
      summary: message.body.length > 120 ? `${message.body.slice(0, 117)}...` : message.body,
    };
    this.activity.push(entry);
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.shift();
    this.activityListeners.forEach((listener) => listener(entry));
  }
}
