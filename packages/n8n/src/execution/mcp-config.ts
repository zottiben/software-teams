/**
 * MCP server configuration for a single n8n turn.
 *
 * The spawned CLI always runs with `--strict-mcp-config`, so a turn sees
 * exactly the servers handed to it here and nothing the worker happens to have
 * configured. That is what makes an n8n workflow reproducible across workers.
 *
 * The configuration carries credentials, so it never reaches the envelope and
 * is never passed as a command-line argument. Only server NAMES are recorded.
 */

/** Server names are interpolated into `mcp__<name>__*` permission rules. */
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** A permission rule naming an MCP tool, either a whole server or one tool. */
const MCP_TOOL_RULE = /^mcp__[A-Za-z0-9_-]+(?:__[A-Za-z0-9_*-]+)?$/;

const MAX_CONFIG_CHARS = 20_000;

export interface McpConfig {
  /** Canonical JSON handed to `--mcp-config`. Credential-bearing. */
  readonly json: string;
  /** Declared server names, safe to log and to record on the envelope. */
  readonly servers: readonly string[];
}

/** Whether a tool entry is an MCP permission rule rather than a built-in tool. */
export function isMcpToolRule(tool: string): boolean {
  return tool.startsWith("mcp__");
}

/** Validate an MCP permission rule written by an operator in Custom tool mode. */
export function assertMcpToolRule(tool: string): void {
  if (!MCP_TOOL_RULE.test(tool)) {
    throw new Error(
      `Invalid MCP tool rule "${tool}". Use "mcp__<server>" for a whole server, ` +
        'or "mcp__<server>__<tool>" for one tool.',
    );
  }
}

/** Allow every tool of each named server. */
export function mcpAllowRules(servers: readonly string[]): string[] {
  return servers.map((server) => `mcp__${server}__*`);
}

/**
 * Parse the credential payload into a canonical config plus its server names.
 *
 * Rejects anything the CLI would accept but an operator almost certainly did
 * not mean, so a misconfigured credential fails at the node rather than
 * silently producing a turn with no tools.
 */
export function parseMcpConfig(raw: string): McpConfig {
  const text = raw.trim();
  if (!text) {
    throw new Error(
      "MCP credential is empty. Supply a JSON object with an \"mcpServers\" key.",
    );
  }
  if (text.length > MAX_CONFIG_CHARS) {
    throw new Error(`MCP configuration must be ${MAX_CONFIG_CHARS} characters or fewer`);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("MCP configuration must be valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP configuration must be a JSON object");
  }

  const servers = (value as Record<string, unknown>)["mcpServers"];
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error('MCP configuration must contain an "mcpServers" object');
  }

  const names = Object.keys(servers as Record<string, unknown>);
  if (names.length === 0) {
    throw new Error('MCP configuration declares no servers under "mcpServers"');
  }
  for (const name of names) {
    if (!SERVER_NAME.test(name)) {
      throw new Error(
        `Invalid MCP server name "${name}". Use letters, digits, hyphens, and underscores only.`,
      );
    }
  }

  return { json: JSON.stringify(value), servers: names };
}
