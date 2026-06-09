/**
 * SoftwareTeamsTrigger — Trigger Ingestion Node (T6)
 *
 * Fetches context from a ClickUp ticket or Datadog Error Tracking issue and
 * emits an INITIAL NodeEnvelope populated with PII-scrubbed `input.context`,
 * a fresh `correlationId`, and `status: 'ok'` so downstream Agent / Orchestrator
 * nodes can begin the workflow.
 *
 * This node is NOT a polling/webhook trigger — it is a regular execute node
 * placed AFTER an n8n-native ClickUp, Datadog, or Schedule trigger. Its job is
 * to enrich the incoming data with fetched ticket/issue context and produce the
 * envelope that the rest of the Software Teams node chain consumes.
 *
 * Credential contract (R-02):
 *   Tokens are read exclusively from the `softwareTeamsApi` credential via
 *   `this.getCredentials`. They are NEVER accepted as node parameters and are
 *   NEVER written to the envelope, logs, or node output.
 *
 * Graceful degradation:
 *   Missing credential keys or an unfetchable ref → the node proceeds with
 *   `status: 'ok'` and `context: null`. A note is logged to the execution log
 *   so the user can diagnose without blocking the workflow.
 *
 * References:
 *   - n8n/CONTRACT.md §1 (NodeEnvelope shape)
 *   - n8n/CONTRACT.md §2 (agentId / correlationId rules)
 *   - Spec AC5 (trigger ingestion for both sources)
 *   - ORCHESTRATION §Risks R-02 (token handling)
 */

import {
  IDataObject,
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

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Generate a human-readable correlation ID for a new run.
 * Format mirrors the CONTRACT.md example: `run-YYYY-MM-DD-<source>-<rand>`.
 * Unique enough for workflow correlation; not a cryptographic UUID.
 */
function newCorrelationId(source: "clickup" | "datadog"): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 10);
  return `run-${date}-${source}-${rand}`;
}

// --------------------------------------------------------------------------
// Node implementation
// --------------------------------------------------------------------------

export class SoftwareTeamsTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Trigger Ingestion Trigger',
    name: "softwareTeamsTrigger",
    icon: "file:SoftwareTeamsTrigger.node.svg",
    group: ["transform"],
    version: 1,
    description:
      "Fetches context from a ClickUp ticket or Datadog issue and creates an initial " +
      "Software Teams workflow envelope. Place this node after a ClickUp, Datadog, or " +
      "Schedule trigger to enrich the workflow with PII-scrubbed ticket/issue context.",
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
        ],
        default: "clickup",
        required: true,
        noDataExpression: false,
        description:
          "The integration source to fetch context from. " +
          "Determines which credential fields and ref format are used.",
      },
      {
        displayName: "ClickUp Task Ref",
        name: "clickupRef",
        type: "string",
        default: "",
        required: true,
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
        required: true,
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

    for (let i = 0; i < items.length; i++) {
      try {
      const source = this.getNodeParameter("source", i) as "clickup" | "datadog";
      const prompt = this.getNodeParameter("prompt", i) as string;
      const agentId = (this.getNodeParameter("agentId", i) as string) || "software-teams-trigger";

      // ── Read tokens from credential ONLY (R-02) ───────────────────────────
      const rawCreds = await this.getCredentials("softwareTeamsApi");
      const clickupCreds = {
        clickupApiKey: (rawCreds.clickupApiKey as string) ?? "",
      };
      const datadogCreds = {
        datadogApiKey: (rawCreds.datadogApiKey as string) ?? "",
        datadogAppKey: (rawCreds.datadogAppKey as string) ?? "",
      };

      // ── Fetch context ─────────────────────────────────────────────────────
      const context = await fetchContext(source, i, this, clickupCreds, datadogCreds);

      // ── Build INITIAL envelope (CONTRACT.md §1) ───────────────────────────
      const envelope: NodeEnvelope = {
        correlationId: newCorrelationId(source),
        agentId,
        status: "ok",
        input: { prompt, context },
        result: { text: "" },
        artifacts: [],
      };

      output.push({ json: envelope as unknown as IDataObject, pairedItem: { item: i } });
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

// ---------------------------------------------------------------------------
// Context fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch PII-scrubbed context for the given source and item index.
 * Returns null when the ref is unparseable or the external API is unreachable
 * (graceful degradation per spec AC5).
 */
async function fetchContext(
  source: "clickup" | "datadog",
  i: number,
  node: IExecuteFunctions,
  clickupCreds: { clickupApiKey: string },
  datadogCreds: { datadogApiKey: string; datadogAppKey: string },
): Promise<unknown> {
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
