import type { ICredentialType, INodeProperties } from "n8n-workflow";

/**
 * MCP servers made available to a Claude Code turn.
 *
 * Held as a credential rather than a node parameter because these configs
 * carry API tokens: a credential is encrypted at rest and is not written into
 * the workflow JSON that gets exported, versioned, or shared.
 */
export class SoftwareTeamsMcpApi implements ICredentialType {
  name = "softwareTeamsMcpApi";
  displayName = "Software Teams MCP API";
  icon = "file:softwareTeamsApi.svg" as const;
  documentationUrl = "https://docs.claude.com/en/docs/claude-code/mcp";

  properties: INodeProperties[] = [
    {
      displayName: "MCP Servers JSON",
      name: "mcpServers",
      type: "string",
      typeOptions: { password: true, rows: 10 },
      default: '{\n  "mcpServers": {}\n}',
      required: true,
      description:
        'A JSON object with an "mcpServers" key, in the same shape as a .mcp.json file. ' +
        "Remote servers take url and headers; local ones take command and args. " +
        "A turn runs with --strict-mcp-config, so it sees these servers and nothing else " +
        "the worker happens to have configured.",
    },
  ];
}
