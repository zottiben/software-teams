/**
 * End-to-end transport smoke: MCP client → real proxy process → control server →
 * broker → recipient pane. This exercises the entire outbound comms path that a
 * `claude` pane uses, with an MCP client standing in for claude. Run under Node
 * (`verify:mcp`) since it spawns the Node proxy bundle.
 */
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Broker } from '../broker/broker';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import { ControlServer } from '../mcp/control-server';
import type { AgentSpec } from '../types';
import { FakePane } from '../__tests__/helpers/fake-pane';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function textOf(result: unknown): string {
  const content =
    result && typeof result === 'object' && 'content' in result && Array.isArray(result.content)
      ? result.content
      : [];
  return content
    .map((part: unknown) =>
      part && typeof part === 'object' && 'text' in part ? String(part.text) : '',
    )
    .join('');
}

async function main(): Promise<void> {
  const orch: AgentSpec = { name: 'software-teams-orchestrator', role: 'orchestrator', persona: 'n/a', isLead: true };
  const backend: AgentSpec = { name: 'software-teams-backend', role: 'backend', persona: 'n/a', isLead: false };

  const broker = new Broker(new ClaudeCodeAdapter());
  const orchPane = new FakePane(orch.name);
  const backendPane = new FakePane(backend.name);
  broker.registerPane(orch, orchPane);
  broker.registerPane(backend, backendPane);

  const orchToken = 'tok-orchestrator';
  const control = new ControlServer({
    broker,
    tokens: new Map([
      [orchToken, orch.name],
      ['tok-backend', backend.name],
    ]),
  });
  await control.start();
  const controlUrl = control.url();

  // The MCP client plays the orchestrator pane: it talks to the real proxy process,
  // which forwards to the control server using the orchestrator's token.
  const proxyPath = join(process.cwd(), 'dist', 'mcp-proxy.mjs');
  const client = new Client({ name: 'mcp-smoke', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: [proxyPath],
    env: { PATH: process.env.PATH ?? '', ST_CONTROL_URL: controlUrl, ST_TOKEN: orchToken },
  });
  await client.connect(transport);

  // 1) The team tools are advertised.
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);
  assert(toolNames.includes('team_delegate'), `team_delegate advertised (got ${toolNames.join(',')})`);
  assert(toolNames.includes('team_roster'), 'team_roster advertised');

  // 2) Roster round-trips through proxy → control → broker.
  const roster = await client.callTool({ name: 'team_roster', arguments: {} });
  assert(textOf(roster).includes(backend.name), 'roster lists the backend pane');

  // 3) Delegation reaches the recipient pane and is tracked on the board.
  await client.callTool({
    name: 'team_delegate',
    arguments: { to: backend.name, task: 'Add /healthz endpoint', ref: 'T1' },
  });
  assert(
    backendPane.submitted.some((s) => s.includes('Add /healthz endpoint') && s.includes('[ref:T1]')),
    'delegated task was delivered into the backend pane',
  );
  const status = await client.callTool({ name: 'team_status', arguments: {} });
  assert(textOf(status).includes('T1'), 'delegation appears on the team board');

  await client.close();
  await control.stop();
  broker.dispose();
  console.log('MCP smoke OK: client→proxy→control→broker→pane verified (roster, delegate, status).');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('MCP smoke threw:', error);
  process.exit(1);
});
