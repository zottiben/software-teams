import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from "n8n-workflow";

import type { NodeEnvelope } from "@websitelabs/software-teams";
import {
  buildClickUpContext,
  buildDatadogContext,
} from "../../src/ingestion/context";
import {
  extractClickUpRef,
  extractDatadogIssue,
} from "@websitelabs/software-teams";
import { toDataObject } from "../../src/n8n-cast";

function newCorrelationId(source: "clickup" | "datadog" | "prompt"): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 10);
  return `run-${date}-${source}-${rand}`;
}

export class SoftwareTeamsTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Trigger Ingestion Trigger',
    name: "softwareTeamsTrigger",
    icon: "file:SoftwareTeamsTrigger.node.svg",
    group: ["transform"],
    version: 1,
    description:
      "Fetches context from a ClickUp ticket or Datadog issue, or accepts a plain " +
      "free-text prompt, and creates an initial Software Teams workflow envelope. " +
      "Place this node after a ClickUp, Datadog, or Schedule trigger to enrich the " +
      "workflow with PII-scrubbed ticket/issue context, or use the Prompt source " +
      "to start a workflow from a free-text instruction.",
    subtitle: '={{ $parameter["source"] }}',
    defaults: {
      name: "Software Teams Trigger Ingestion",
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "softwareTeamsApi",
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Source",
        name: "source",
        type: "options",
        options: [
          { name: "ClickUp", value: "clickup" },
          { name: "Datadog", value: "datadog" },
          { name: "Prompt", value: "prompt" },
        ],
        default: "clickup",
        required: true,
        noDataExpression: false,
        description:
          "The integration source to fetch context from. ClickUp and Datadog fetch " +
          "external context; Prompt uses the workflow prompt directly with no external call.",
      },
      {
        displayName: "ClickUp Task Ref",
        name: "clickupRef",
        type: "string",
        default: "",
        displayOptions: {
          show: { source: ["clickup"] },
        },
        description:
          "ClickUp task URL (e.g. https://app.clickup.com/t/team123/NDP-456) or bare " +
          "task ID. Supports n8n expressions to pull the ref from upstream trigger data.",
      },
      {
        displayName: "Datadog Issue URL",
        name: "datadogRef",
        type: "string",
        default: "",
        displayOptions: {
          show: { source: ["datadog"] },
        },
        description:
          "Datadog Error Tracking issue URL containing an issueId param " +
          "(e.g. https://app.datadoghq.com/error-tracking?…issueId…). " +
          "Supports n8n expressions.",
      },
      {
        displayName: "Workflow Prompt",
        name: "prompt",
        type: "string",
        typeOptions: { rows: 3 },
        default: "Investigate and address the issue described in the context.",
        required: true,
        description:
          "The initial task prompt placed on the envelope for the first downstream " +
          "Software Teams Agent node to act on.",
      },
      {
        displayName: "First Agent ID",
        name: "agentId",
        type: "string",
        default: "software-teams-researcher",
        description:
          "The Software Teams specialist that should first handle this workflow " +
          "(e.g. software-teams-researcher, software-teams-frontend). " +
          "Matches a name in agents/*.md. The downstream Agent node will set its " +
          "own agentId when it consumes this envelope.",
      },
    ],
		usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];

    // n8n per-item + continueOnFail pattern; entries() avoids a let counter.
    for (const [i] of items.entries()) {
      try {
        const source = this.getNodeParameter("source", i) as "clickup" | "datadog" | "prompt";
        const prompt = this.getNodeParameter("prompt", i) as string;
        const agentId = (this.getNodeParameter("agentId", i) as string) || "software-teams-trigger";

        // Read tokens from credential ONLY (R-02)
        const rawCreds = await this.getCredentials("softwareTeamsApi");
        const clickupCreds = {
          clickupApiKey: (rawCreds.clickupApiKey as string) ?? "",
        };
        const datadogCreds = {
          datadogApiKey: (rawCreds.datadogApiKey as string) ?? "",
          datadogAppKey: (rawCreds.datadogAppKey as string) ?? "",
        };

        const context = await fetchContext(source, i, this, clickupCreds, datadogCreds);

        const envelope: NodeEnvelope = {
          correlationId: newCorrelationId(source),
          agentId,
          status: "ok",
          input: { prompt, context },
          result: { text: "" },
          artifacts: [],
        };

        output.push({ json: toDataObject(envelope), pairedItem: { item: i } });
      } catch (err) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: err instanceof Error ? err.message : String(err) },
            pairedItem: { item: i },
          });
        } else {
          throw new NodeOperationError(
            this.getNode(),
            err instanceof Error ? err.message : String(err),
            { itemIndex: i },
          );
        }
      }
    }

    return [output];
  }
}

/**
 * Fetch PII-scrubbed context for the given source and item index.
 * Returns null when the ref is unparseable or the external API is unreachable
 * (graceful degradation per spec AC5).
 */
async function fetchContext(
  source: "clickup" | "datadog" | "prompt",
  i: number,
  node: IExecuteFunctions,
  clickupCreds: { clickupApiKey: string },
  datadogCreds: { datadogApiKey: string; datadogAppKey: string },
): Promise<unknown> {
  if (source === "prompt") {
    // No external fetch — the prompt param IS the task instruction.
    return { source: "prompt" };
  }

  if (source === "clickup") {
    const refStr = (node.getNodeParameter("clickupRef", i) as string).trim();
    const ref = extractClickUpRef(refStr) ?? { taskId: refStr };

    if (!ref.taskId) {
      node.logger.info(
        `SoftwareTeamsTrigger: Could not parse ClickUp ref "${refStr}" — proceeding with empty context.`,
      );
      return null;
    }

    const ctx = await buildClickUpContext(ref, clickupCreds);
    if (!ctx) {
      node.logger.info(
        `SoftwareTeamsTrigger: ClickUp context unavailable for ref "${refStr}" — ` +
          "proceeding with empty context. Check that clickupApiKey is set in " +
          "the softwareTeamsApi credential and the task ref is valid.",
      );
    }
    return ctx ?? null;
  }

  const refStr = (node.getNodeParameter("datadogRef", i) as string).trim();
  const parsed = extractDatadogIssue(refStr);

  if (!parsed) {
    node.logger.info(
      `SoftwareTeamsTrigger: Could not parse Datadog issue URL "${refStr}" — proceeding with empty context.`,
    );
    return null;
  }

  const ctx = await buildDatadogContext(parsed.issueId, parsed.apiBase, datadogCreds);
  if (!ctx) {
    node.logger.info(
      `SoftwareTeamsTrigger: Datadog context unavailable for issue "${parsed.issueId}" — ` +
        "proceeding with empty context. Check that datadogApiKey and datadogAppKey " +
        "are set in the softwareTeamsApi credential.",
    );
  }
  return ctx ?? null;
}
