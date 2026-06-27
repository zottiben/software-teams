import { Broker, UnknownRecipientError } from '../broker/broker';

/** A transport-agnostic tool result (the proxy wraps this into MCP content). */
export interface ToolResult {
  readonly text: string;
  readonly isError?: boolean;
}

/** Declarative spec for one team tool, used to register it on the MCP proxy. */
export interface TeamToolParam {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

export interface TeamToolDef {
  readonly name: string;
  readonly description: string;
  readonly params: readonly TeamToolParam[];
  /** Advisory: this tool is meant for the orchestrator/lead pane. */
  readonly leadOnly?: boolean;
}

/**
 * The single source of truth for the team tools exposed to every pane. The MCP
 * proxy registers exactly these; the engine docs and the orchestrator overlay
 * reference them by name.
 */
export const TEAM_TOOLS: readonly TeamToolDef[] = [
  {
    name: 'team_roster',
    description: 'List your teammates: their names, roles, and whether each is idle or busy right now.',
    params: [],
  },
  {
    name: 'team_send',
    description:
      'Send a direct message to one teammate by name (e.g. ask the backend specialist for an endpoint). Delivered as a turn when they are next idle.',
    params: [
      { name: 'to', required: true, description: 'Recipient agent name (from team_roster).' },
      { name: 'body', required: true, description: 'The message / request.' },
    ],
  },
  {
    name: 'team_broadcast',
    description: 'Send a message to every teammate at once.',
    params: [{ name: 'body', required: true, description: 'The message.' }],
  },
  {
    name: 'team_delegate',
    description:
      'Orchestrator tool: hand a task to a specialist pane and track it. Provide the task slice and an optional task id (e.g. T3) to correlate the eventual report.',
    leadOnly: true,
    params: [
      { name: 'to', required: true, description: 'Specialist agent name to own the task.' },
      { name: 'task', required: true, description: 'The task / slice to perform.' },
      { name: 'ref', required: false, description: 'Task id to correlate the report (e.g. T3). Auto-generated if omitted.' },
    ],
  },
  {
    name: 'team_report',
    description:
      'Report progress or completion of a delegated task back to the orchestrator (defaults to the lead). Include the task id you were given.',
    params: [
      { name: 'summary', required: true, description: 'What you did / current status.' },
      { name: 'ref', required: false, description: 'The task id you were delegated (e.g. T3).' },
      { name: 'to', required: false, description: 'Override recipient (defaults to the orchestrator).' },
    ],
  },
  {
    name: 'team_status',
    description:
      'Orchestrator tool: show the team board — every delegated task and its status, plus recent inter-agent activity.',
    leadOnly: true,
    params: [],
  },
];

function requireStr(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolArgumentError(`Missing required argument '${key}'.`);
  }
  return value;
}

function optionalStr(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Thrown when a tool call is missing/invalid arguments; surfaced as an error result. */
export class ToolArgumentError extends Error {}

/**
 * Implements the `team_*` tools over a {@link Broker}. Pure and transport-agnostic:
 * given the calling agent's identity and the raw arguments, it routes a message and
 * returns a text result. The MCP proxy is a thin wrapper that supplies `from` (the
 * pane's pinned identity) and converts {@link ToolResult} into MCP content.
 */
export class TeamTools {
  private refCounter = 0;

  constructor(private readonly broker: Broker) {}

  /** Route a tool call by name. `from` is the calling pane's agent identity. */
  dispatch(toolName: string, from: string, args: Readonly<Record<string, unknown>>): ToolResult {
    try {
      switch (toolName) {
        case 'team_roster':
          return this.roster();
        case 'team_send':
          return this.send(from, args);
        case 'team_broadcast':
          return this.broadcast(from, args);
        case 'team_delegate':
          return this.delegate(from, args);
        case 'team_report':
          return this.report(from, args);
        case 'team_status':
          return this.status();
        default:
          return { text: `Unknown tool '${toolName}'.`, isError: true };
      }
    } catch (error) {
      if (error instanceof UnknownRecipientError || error instanceof ToolArgumentError) {
        return { text: error.message, isError: true };
      }
      throw error;
    }
  }

  private roster(): ToolResult {
    const lines = this.broker.status().roster.map(
      (m) => `- ${m.name} (${m.role})${m.isLead ? ' [lead]' : ''} — ${m.status}, ${m.queued} queued`,
    );
    return { text: lines.length ? `Team:\n${lines.join('\n')}` : 'No teammates registered.' };
  }

  private send(from: string, args: Readonly<Record<string, unknown>>): ToolResult {
    const to = requireStr(args, 'to');
    const message = this.broker.submit({ kind: 'send', from, to, body: requireStr(args, 'body') });
    return { text: `Sent to ${to} (queued as ${message.id}); they'll see it when idle.` };
  }

  private broadcast(from: string, args: Readonly<Record<string, unknown>>): ToolResult {
    this.broker.submit({ kind: 'broadcast', from, to: null, body: requireStr(args, 'body') });
    return { text: 'Broadcast queued to all teammates.' };
  }

  private delegate(from: string, args: Readonly<Record<string, unknown>>): ToolResult {
    const to = requireStr(args, 'to');
    const task = requireStr(args, 'task');
    this.refCounter += 1;
    const ref = optionalStr(args, 'ref') ?? `D${this.refCounter}`;
    this.broker.submit({ kind: 'delegate', from, to, body: task, correlationId: ref });
    return { text: `Delegated to ${to} as ${ref}. Track it with team_status; await their team_report.` };
  }

  private report(from: string, args: Readonly<Record<string, unknown>>): ToolResult {
    const summary = requireStr(args, 'summary');
    const lead = this.broker.lead();
    const to = optionalStr(args, 'to') ?? lead?.name;
    if (!to) {
      return { text: 'No orchestrator/lead is registered to report to.', isError: true };
    }
    const ref = optionalStr(args, 'ref');
    this.broker.submit({ kind: 'report', from, to, body: summary, ...(ref ? { correlationId: ref } : {}) });
    return { text: `Reported to ${to}${ref ? ` for ${ref}` : ''}.` };
  }

  private status(): ToolResult {
    const board = this.broker.status();
    const delegations = board.delegations.length
      ? board.delegations
          .map((d) => `- ${d.correlationId}: ${d.to} — ${d.status}${d.report ? ` (${d.report.slice(0, 80)})` : ''}`)
          .join('\n')
      : '(no delegations yet)';
    const activity = board.recentActivity
      .slice(-8)
      .map((a) => `- ${a.from} → ${a.to ?? 'all'} [${a.kind}]: ${a.summary}`)
      .join('\n');
    return { text: `Delegations:\n${delegations}\n\nRecent activity:\n${activity || '(none)'}` };
  }
}
