import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Broker } from '../broker/broker';
import { TeamTools } from './team-tools';

export interface ControlServerOptions {
  readonly broker: Broker;
  /** Maps a per-pane secret token to that pane's agent identity (prevents spoofing). */
  readonly tokens: ReadonlyMap<string, string>;
  /** Invoked when a pane reports itself idle (via its Stop hook). */
  readonly onIdle?: (agent: string) => void;
  readonly host?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

/**
 * The engine-side broker endpoint. Each pane's MCP proxy calls this over loopback,
 * authenticating with a per-pane token that the server maps to the pane's agent
 * identity — so `from` is derived from the token, never trusted from the request.
 *
 * Routes:
 *  - `POST /tool`  `{ tool, args }`  → dispatches a `team_*` tool as that agent.
 *  - `POST /idle`                    → signals that this pane finished a turn (Stop hook).
 */
export class ControlServer {
  private readonly tools: TeamTools;
  private readonly host: string;
  private server: Server | undefined;
  private boundPort = 0;

  constructor(private readonly options: ControlServerOptions) {
    this.tools = new TeamTools(options.broker);
    this.host = options.host ?? '127.0.0.1';
  }

  start(port = 0): Promise<number> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => send(res, 500, { error: 'internal' }));
    });
    this.server = server;
    return new Promise((resolve) => {
      server.listen(port, this.host, () => {
        const address = server.address();
        this.boundPort = address && typeof address === 'object' ? address.port : port;
        resolve(this.boundPort);
      });
    });
  }

  url(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  stop(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private agentFor(req: IncomingMessage): string | undefined {
    const header = req.headers['x-st-token'];
    const token = Array.isArray(header) ? header[0] : header;
    return token ? this.options.tokens.get(token) : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const agent = this.agentFor(req);
    if (!agent) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'POST' && req.url === '/idle') {
      this.options.onIdle?.(agent);
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/tool') {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw) as { tool?: unknown; args?: unknown };
      const tool = typeof parsed.tool === 'string' ? parsed.tool : '';
      const args =
        parsed.args && typeof parsed.args === 'object'
          ? (parsed.args as Record<string, unknown>)
          : {};
      const result = this.tools.dispatch(tool, agent, args);
      send(res, 200, result);
      return;
    }
    send(res, 404, { error: 'not found' });
  }
}
