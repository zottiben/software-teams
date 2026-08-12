import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { extractClickUpRef, type ClickUpRef } from "@websitelabs/software-teams";
import { toDataObject } from "../../src/n8n-cast";
import {
  createSupportEnvelope,
  fetchClickUpSupportTicket,
  parseManualSupportTicket,
  type ClickUpCredentials,
} from "../../src/ingestion/support-ticket";

// Deliberately not usable as an AI tool: ticket acquisition is a workflow
// boundary and must not let an agent query arbitrary task IDs with this credential.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class SoftwareTeamsTicket implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Software Teams Ticket Intake",
    name: "softwareTeamsTicket",
    icon: "file:softwareTeamsTicket.svg",
    group: ["transform"],
    version: 1,
    description:
      "Normalize a pasted ticket or ClickUp task into the same PII-scrubbed, budgeted Software Teams envelope.",
    subtitle: '={{ $parameter["source"] }}',
    defaults: { name: "Software Teams Ticket Intake" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "softwareTeamsClickUpApi",
        required: false,
        displayOptions: { show: { source: ["clickup"] } },
      },
    ],
    properties: [
      {
        displayName: "Source",
        name: "source",
        type: "options",
        options: [
          { name: "ClickUp Task", value: "clickup" },
          { name: "Pasted or Expression-Supplied Ticket", value: "manual" },
        ],
        default: "manual",
        required: true,
      },
      {
        displayName: "Ticket JSON or Text",
        name: "ticketJson",
        type: "string",
        typeOptions: { rows: 10 },
        default: '{\n  "id": "SUP-1",\n  "title": "Describe the request",\n  "description": "Paste the ticket body here",\n  "comments": []\n}',
        required: true,
        displayOptions: { show: { source: ["manual"] } },
        description:
          "A JSON object, plain text, or n8n expression such as {{ JSON.stringify($json) }}. " +
          "User-authored text is PII-scrubbed before it reaches Claude.",
      },
      {
        displayName: "ClickUp Task URL or ID",
        name: "clickupRef",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { source: ["clickup"] } },
        description:
          "Full URL is preferred, for example https://app.clickup.com/t/36826178/NDP-34603. " +
          "Expressions are supported.",
      },
      {
        displayName: "ClickUp Workspace ID",
        name: "workspaceId",
        type: "string",
        default: "",
        displayOptions: { show: { source: ["clickup"] } },
        description:
          "Required only when ClickUp Task URL or ID is a custom ID such as NDP-34603 rather than a full URL",
      },
      {
        displayName: "Support Prompt",
        name: "prompt",
        type: "string",
        typeOptions: { rows: 4 },
        default: "Triage this support ticket. Classify it as a question, bug, change request, or escalation; identify the next safe action; and ask one specific question if information is missing.",
        required: true,
      },
      {
        displayName: "First Agent ID",
        name: "agentId",
        type: "string",
        default: "software-teams-support-triage",
        required: true,
        description: "Specialist the next Claude Code node should run first",
      },
      {
        displayName: "Ticket Budget USD",
        name: "ticketBudgetUsd",
        type: "number",
        default: 1,
        typeOptions: { minValue: 0.01, numberPrecision: 2 },
        required: true,
        description:
          "Cumulative estimated API-equivalent cost across every Claude turn for this ticket. " +
          "Subscription runs are not billed this amount, but it is a useful runaway-work guardrail.",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const output: INodeExecutionData[] = [];
    const itemCount = Math.max(1, input.length);

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      try {
        const source = this.getNodeParameter("source", itemIndex) as "manual" | "clickup";
        const prompt = this.getNodeParameter("prompt", itemIndex) as string;
        const agentId = this.getNodeParameter("agentId", itemIndex) as string;
        const budgetUsd = this.getNodeParameter("ticketBudgetUsd", itemIndex) as number;

        const ticket = source === "manual"
          ? parseManualSupportTicket(stringifyParameter(this.getNodeParameter("ticketJson", itemIndex)))
          : await fetchClickUpTicket(this, itemIndex);
        const envelope = createSupportEnvelope(ticket, { prompt, agentId, budgetUsd });

        output.push({
          json: toDataObject(envelope),
          ...(input[itemIndex] ? { pairedItem: { item: itemIndex } } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.continueOnFail()) {
          output.push({ json: { error: message }, pairedItem: { item: itemIndex } });
          continue;
        }
        throw new NodeOperationError(this.getNode(), `Ticket ingestion failed: ${message}`, {
          itemIndex,
        });
      }
    }
    return [output];
  }
}

async function fetchClickUpTicket(node: IExecuteFunctions, itemIndex: number) {
  const value = (node.getNodeParameter("clickupRef", itemIndex) as string).trim();
  const workspaceId = (node.getNodeParameter("workspaceId", itemIndex, "") as string).trim();
  const parsed = extractClickUpRef(value);
  const ref: ClickUpRef = parsed ?? {
    taskId: value,
    ...(workspaceId ? { teamId: workspaceId } : {}),
  };
  if (!ref.taskId) {
    throw new NodeOperationError(node.getNode(), "ClickUp Task URL or ID is required", {
      itemIndex,
    });
  }

  const raw = await node.getCredentials("softwareTeamsClickUpApi");
  const credentials: ClickUpCredentials = {
    apiToken: typeof raw.apiToken === "string" ? raw.apiToken : "",
    apiBase: typeof raw.apiBase === "string" ? raw.apiBase : undefined,
  };
  return fetchClickUpSupportTicket(ref, credentials);
}

function stringifyParameter(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
