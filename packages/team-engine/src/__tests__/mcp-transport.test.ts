import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Broker } from '../broker/broker';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import { ControlServer } from '../mcp/control-server';
import { buildMcpConfig, writeMcpConfig } from '../mcp/mcp-config';
import type { AgentSpec } from '../types';
import { FakePane } from './helpers/fake-pane';

const FE: AgentSpec = { name: 'software-teams-frontend', role: 'frontend', persona: 'p', isLead: false };
const BE: AgentSpec = { name: 'software-teams-backend', role: 'backend', persona: 'p', isLead: false };

describe('ControlServer', () => {
  let broker: Broker;
  let fe: FakePane;
  let be: FakePane;
  let server: ControlServer;
  let url: string;
  const idleSignals: string[] = [];

  beforeAll(async () => {
    broker = new Broker(new ClaudeCodeAdapter());
    fe = new FakePane(FE.name);
    be = new FakePane(BE.name);
    broker.registerPane(FE, fe);
    broker.registerPane(BE, be);
    server = new ControlServer({
      broker,
      tokens: new Map([['tok-fe', FE.name]]),
      onIdle: (agent) => idleSignals.push(agent),
    });
    await server.start();
    url = server.url();
  });

  afterAll(async () => {
    await server.stop();
  });

  test('rejects a request with an unknown token', async () => {
    const res = await fetch(`${url}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-st-token': 'bogus' },
      body: JSON.stringify({ tool: 'team_roster', args: {} }),
    });
    expect(res.status).toBe(401);
  });

  test('dispatches a tool as the token-mapped agent', async () => {
    const res = await fetch(`${url}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-st-token': 'tok-fe' },
      body: JSON.stringify({ tool: 'team_send', args: { to: BE.name, body: 'ping from fe' } }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { text: string; isError?: boolean };
    expect(data.isError).toBeUndefined();
    expect(be.submitted.some((s) => s.includes('ping from fe'))).toBe(true);
  });

  test('routes an idle signal to the onIdle callback', async () => {
    await fetch(`${url}/idle`, { method: 'POST', headers: { 'x-st-token': 'tok-fe' } });
    expect(idleSignals).toContain(FE.name);
  });
});

describe('mcp-config generator', () => {
  test('builds a stdio server entry pointing at the proxy', () => {
    const doc = buildMcpConfig({
      proxyPath: '/abs/dist/mcp-proxy.mjs',
      controlUrl: 'http://127.0.0.1:5000',
      token: 'tok-xyz',
    });
    const entry = doc.mcpServers['software-teams-team'];
    expect(entry?.command).toBe('node');
    expect(entry?.args).toContain('/abs/dist/mcp-proxy.mjs');
    expect(entry?.env.ST_CONTROL_URL).toBe('http://127.0.0.1:5000');
    expect(entry?.env.ST_TOKEN).toBe('tok-xyz');
  });

  test('writes the config to <dir>/<agent>.mcp.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-cfg-'));
    try {
      const path = writeMcpConfig(dir, BE.name, {
        proxyPath: '/p.mjs',
        controlUrl: 'http://127.0.0.1:1',
        token: 't',
      });
      expect(path.endsWith('software-teams-backend.mcp.json')).toBe(true);
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> };
      expect(parsed.mcpServers['software-teams-team']).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
