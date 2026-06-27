/**
 * Per-pane stdio MCP server ("team proxy").
 *
 * Each `claude` pane launches this via its generated `--mcp-config`. It exposes the
 * `team_*` tools to that pane and forwards every call to the engine's control server
 * over loopback, authenticating with the pane's token (which the server maps to this
 * pane's agent identity). It holds no team state itself — the shared broker does.
 *
 * Bundled for Node into `dist/mcp-proxy.mjs` (`build:proxy`); not a `bun test`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TEAM_TOOLS, type TeamToolDef } from './team-tools';

const controlUrl = process.env.ST_CONTROL_URL;
const token = process.env.ST_TOKEN;

function shapeFor(def: TeamToolDef): z.ZodRawShape {
  return Object.fromEntries(
    def.params.map((param) => {
      const field = z.string().describe(param.description);
      return [param.name, param.required ? field : field.optional()];
    }),
  );
}

interface ToolCallResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

/**
 * Concrete signature for `registerTool` that sidesteps the SDK's deep generic
 * inference (TS2589) over a dynamically-built Zod shape — the proxy forwards raw
 * args verbatim, so it never needs the per-tool inferred arg types.
 */
type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: z.ZodRawShape },
  handler: (args: Record<string, unknown>) => Promise<ToolCallResult>,
) => void;

async function callControl(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  if (!controlUrl || !token) {
    return { text: 'Team bus not configured (ST_CONTROL_URL/ST_TOKEN missing).', isError: true };
  }
  try {
    const res = await fetch(`${controlUrl}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-st-token': token },
      body: JSON.stringify({ tool, args }),
    });
    const data = (await res.json()) as { text?: string; isError?: boolean };
    return { text: data.text ?? '', isError: data.isError ?? false };
  } catch (error) {
    return { text: `Team bus unreachable: ${String(error)}`, isError: true };
  }
}

async function main(): Promise<void> {
  const server = new McpServer({ name: 'software-teams-team', version: '0.1.0' });
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const def of TEAM_TOOLS) {
    register(def.name, { description: def.description, inputSchema: shapeFor(def) }, async (args) => {
      const result = await callControl(def.name, args ?? {});
      return { content: [{ type: 'text', text: result.text }], isError: result.isError };
    });
  }
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`team proxy failed: ${String(error)}\n`);
  process.exit(1);
});
