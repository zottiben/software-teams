import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface McpConfigInput {
  /** Absolute path to the bundled stdio proxy (`dist/mcp-proxy.mjs`). */
  readonly proxyPath: string;
  /** URL of the engine control server. */
  readonly controlUrl: string;
  /** This pane's secret token (maps to its agent identity server-side). */
  readonly token: string;
  /** MCP server name as seen by the harness (default `software-teams-team`). */
  readonly serverName?: string;
  /** Node binary to run the proxy with (default `node`). */
  readonly nodeBin?: string;
}

/** The `--mcp-config` document: a stdio server that runs the team proxy. */
export interface McpConfigDocument {
  readonly mcpServers: Readonly<
    Record<
      string,
      {
        readonly command: string;
        readonly args: readonly string[];
        readonly env: Readonly<Record<string, string>>;
      }
    >
  >;
}

/** Build the `--mcp-config` document wiring one pane to the team proxy. */
export function buildMcpConfig(input: McpConfigInput): McpConfigDocument {
  const name = input.serverName ?? 'software-teams-team';
  return {
    mcpServers: {
      [name]: {
        command: input.nodeBin ?? 'node',
        args: [input.proxyPath],
        env: {
          ST_CONTROL_URL: input.controlUrl,
          ST_TOKEN: input.token,
        },
      },
    },
  };
}

/** Write a pane's mcp-config to `<dir>/<agent>.mcp.json` and return its path. */
export function writeMcpConfig(dir: string, agent: string, input: McpConfigInput): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${agent}.mcp.json`);
  writeFileSync(path, `${JSON.stringify(buildMcpConfig(input), null, 2)}\n`);
  return path;
}
