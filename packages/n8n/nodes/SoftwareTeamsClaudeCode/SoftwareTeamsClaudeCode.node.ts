import { randomUUID } from "node:crypto";
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import type { NodeEnvelope } from "@websitelabs/software-teams";
import {
  softwareTeamsCredentialTest,
  softwareTeamsMcpCredentialTest,
} from "../../src/execution/verify-credential";
import { authFromCredentials } from "../../src/execution/auth-from-credentials";
import {
  applyTurnAccounting,
  buildBudgetExhaustedEnvelope,
  buildGenericHandoff,
  parseOutputSchema,
  resolveToolPolicy,
  turnBudget,
  type GenericToolPolicy,
} from "../../src/execution/generic-turn";
import { mcpAllowRules, parseMcpConfig } from "../../src/execution/mcp-config";
import { SPECIALIST_OPTIONS } from "../../src/execution/specialists";
import { TURN_RESULT_SCHEMA } from "../../src/execution/envelope-schema";
import { isNodeEnvelope } from "../../src/orchestration/run-state/persistence";
import { toDataObject, fromDataObject } from "../../src/n8n-cast";
import type { AgentTurnOptions } from "../../src/execution/single-turn";

// Runtime lookup preserves the node tests' ability to intercept the execution engine.
const SINGLE_TURN_MODULE: string = "../../src/execution/single-turn";
type RunAgentTurn = (
  input: NodeEnvelope,
  repoContext?: undefined,
  githubToken?: undefined,
  options?: AgentTurnOptions,
) => Promise<NodeEnvelope>;
const runAgentTurn: RunAgentTurn = (input, repoContext, githubToken, options) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require(SINGLE_TURN_MODULE) as { runAgentTurn: RunAgentTurn }).runAgentTurn(
    input,
    repoContext,
    githubToken,
    options,
  );

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { N8N_MODEL_OPTIONS, N8N_DEFAULT_MODEL, N8N_EFFORT_OPTIONS } = require(
  "@websitelabs/software-teams",
) as {
  N8N_MODEL_OPTIONS: Array<{ name: string; value: string }>;
  N8N_DEFAULT_MODEL: string;
  N8N_EFFORT_OPTIONS: Array<{ name: string; value: string }>;
};

const DEFAULT_CUSTOM_SCHEMA = JSON.stringify(
  {
    type: "object",
    additionalProperties: false,
    required: ["status", "summary", "question"],
    properties: {
      status: { type: "string", enum: ["ok", "needs-input", "error"] },
      summary: { type: "string" },
      question: {
        type: "string",
        description: "Specific human question for needs-input; empty string otherwise",
      },
    },
  },
  null,
  2,
);

export class SoftwareTeamsClaudeCode implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Software Teams Claude Code",
    name: "softwareTeamsClaudeCode",
    icon: "file:softwareTeamsClaudeCode.svg",
    group: ["transform"],
    version: 1,
    description:
      "Run any bundled specialist for one typed Claude Code turn. Defaults to read-only tools, " +
      "permissionMode dontAsk, bounded turns, and the remaining cumulative ticket budget.",
    subtitle: '={{ $parameter["agentId"] }}',
    defaults: { name: "Software Teams Claude Code" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      { name: "softwareTeamsApi", required: true, testedBy: "softwareTeamsApiTest" },
      {
        name: "softwareTeamsMcpApi",
        required: true,
        testedBy: "softwareTeamsMcpApiTest",
        displayOptions: { show: { useMcpServers: [true] } },
      },
    ],
    usableAsTool: true,
    properties: [
      {
        displayName: "Agent",
        name: "agentId",
        type: "options",
        noDataExpression: true,
        options: [...SPECIALIST_OPTIONS],
        default: "software-teams-support-triage",
        required: true,
        description: "Bundled specialist whose spec becomes this turn's system prompt",
      },
      {
        displayName: "Prompt",
        name: "prompt",
        type: "string",
        typeOptions: { rows: 5 },
        default: "={{ $json.input.prompt }}",
        required: true,
        description: "Task for this turn. The upstream ticket and previous result remain in context.",
      },
      {
        displayName: "Tool Access",
        name: "toolPolicy",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Agent Spec",
            value: "agentSpec",
            description: "Use the specialist's own tool list; may include write access",
          },
          {
            name: "Custom",
            value: "custom",
            description: "Provide an explicit comma- or newline-separated tool allowlist",
          },
          {
            name: "Read Only (Recommended)",
            value: "readOnly",
            description: "Read, Glob, and Grep only; no shell, network, writes, or nested agents",
          },
          {
            name: "Repository Changes",
            value: "repositoryWrite",
            description: "Explicitly allow file edits and bounded git, Bun, and npm commands",
          },
        ],
        default: "readOnly",
        required: true,
      },
      {
        displayName: "Custom Tools",
        name: "customTools",
        type: "string",
        typeOptions: { rows: 4 },
        default: "Read\nGlob\nGrep",
        displayOptions: { show: { toolPolicy: ["custom"] } },
        description:
          "Canonical Claude Code tool names. StructuredOutput is added automatically; Agent is always forbidden.",
      },
      {
        displayName: "Use MCP Servers",
        name: "useMcpServers",
        type: "boolean",
        noDataExpression: true,
        default: false,
        description:
          "Whether to give this turn the MCP servers from a Software Teams MCP Servers credential. " +
          "Every tool of each configured server is allowed, unless Tool Access is Custom, " +
          "in which case list the mcp__<server>__<tool> rules you want yourself.",
      },
      {
        displayName: "Output Schema",
        name: "schemaMode",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "Custom JSON Schema", value: "custom" },
          { name: "Standard Turn Envelope", value: "turn" },
        ],
        default: "turn",
        required: true,
      },
      {
        displayName: "Output Schema JSON",
        name: "outputSchema",
        type: "json",
        default: DEFAULT_CUSTOM_SCHEMA,
        displayOptions: { show: { schemaMode: ["custom"] } },
        description:
          "Root must be a JSON object schema. The validated object is emitted as result.data; " +
          "summary, question, status, filesChanged, and confidence also project onto standard fields.",
      },
      {
        displayName: "Model",
        name: "model",
        type: "options",
        noDataExpression: true,
        options: N8N_MODEL_OPTIONS,
        default: N8N_DEFAULT_MODEL,
      },
      {
        displayName: "Effort",
        name: "effort",
        type: "options",
        noDataExpression: true,
        options: N8N_EFFORT_OPTIONS,
        default: "",
      },
      {
        displayName: "Fallback Models",
        name: "fallbackModel",
        type: "string",
        default: "",
        description:
          "Optional comma-separated model aliases tried when the primary model is unavailable",
      },
      {
        displayName: "Max Turn Budget USD",
        name: "maxTurnBudgetUsd",
        type: "number",
        default: 0,
        typeOptions: { minValue: 0, numberPrecision: 2 },
        description:
          "Optional cap for this turn. 0 uses the remaining ticket budget; when both exist, the smaller cap wins.",
      },
      {
        displayName: "Max Turns",
        name: "maxTurns",
        type: "number",
        default: 8,
        typeOptions: { minValue: 1, maxValue: 100 },
        required: true,
        description: "Hard step cap for unattended work",
      },
      {
        displayName: "Resume Upstream Session",
        name: "resumeSession",
        type: "boolean",
        default: true,
        description:
          "Whether to resume the upstream Claude Code session when it has a sessionId. Use for human-in-the-loop continuation.",
      },
    ],
  };

  methods = {
    credentialTest: { ...softwareTeamsCredentialTest, ...softwareTeamsMcpCredentialTest },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const credentials = await this.getCredentials("softwareTeamsApi");
    const auth = authFromCredentials(credentials);
    const itemCount = Math.max(1, items.length);

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      try {
        const raw = items[itemIndex]?.json;
        const upstream = raw && isNodeEnvelope(raw)
          ? fromDataObject<NodeEnvelope>(raw)
          : freshEnvelope(raw ? fromDataObject<Record<string, unknown>>(raw) : null);

        // Errors, pending human questions, and account-limit retries are branch
        // signals, not prompts for another model. A Switch/HITL/retry path must
        // explicitly turn them back into status ok before another turn.
        if (upstream.status !== "ok") {
          output.push({
            json: toDataObject(upstream),
            ...(items[itemIndex] ? { pairedItem: { item: itemIndex } } : {}),
          });
          continue;
        }

        const agentId = this.getNodeParameter("agentId", itemIndex) as string;
        const prompt = this.getNodeParameter("prompt", itemIndex) as string;
        const policy = this.getNodeParameter("toolPolicy", itemIndex) as GenericToolPolicy;
        const customTools = this.getNodeParameter("customTools", itemIndex, "") as string;
        const tools = resolveToolPolicy(policy, customTools);
        const useMcpServers = this.getNodeParameter("useMcpServers", itemIndex, false) as boolean;
        const mcpConfig = useMcpServers
          ? parseMcpConfig(
              stringifyParameter(
                (await this.getCredentials("softwareTeamsMcpApi"))["mcpServers"],
              ),
            )
          : undefined;
        // Custom mode is an explicit allowlist, so it stays authoritative: an
        // operator narrowing to two ClickUp tools must not silently get all of them.
        const mcp = mcpConfig
          ? {
              json: mcpConfig.json,
              allowedTools: policy === "custom" ? [] : mcpAllowRules(mcpConfig.servers),
            }
          : undefined;
        const schemaMode = this.getNodeParameter("schemaMode", itemIndex) as "turn" | "custom";
        const schema = schemaMode === "custom"
          ? parseOutputSchema(stringifyParameter(this.getNodeParameter("outputSchema", itemIndex)))
          : undefined;
        const model = this.getNodeParameter("model", itemIndex, N8N_DEFAULT_MODEL) as string;
        const effort = this.getNodeParameter("effort", itemIndex, "") as string;
        const fallbackModel = this.getNodeParameter("fallbackModel", itemIndex, "") as string;
        const maxTurnBudgetUsd = this.getNodeParameter("maxTurnBudgetUsd", itemIndex, 0) as number;
        const maxTurns = this.getNodeParameter("maxTurns", itemIndex, 8) as number;
        const resumeSession = this.getNodeParameter("resumeSession", itemIndex, true) as boolean;

        const envelope = buildGenericHandoff(upstream, agentId, prompt);
        const maxBudgetUsd = turnBudget(envelope, maxTurnBudgetUsd);
        const result = maxBudgetUsd === 0 && envelope.budget
          ? buildBudgetExhaustedEnvelope(envelope, agentId, prompt)
          : await runAgentTurn(envelope, undefined, undefined, {
              auth,
              model,
              effort,
              ...(fallbackModel.trim() ? { fallbackModel } : {}),
              ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
              maxTurns,
              ...(resumeSession && upstream.sessionId
                ? { resumeSessionId: upstream.sessionId }
                : {}),
              ...(tools ? { tools } : {}),
              ...(schema ? { jsonSchema: schema } : {}),
              ...(mcp ? { mcp } : {}),
              permissionMode: "dontAsk",
              requireAgentDefinition: true,
            });
        const accounted = maxBudgetUsd === 0 && envelope.budget
          ? result
          : applyTurnAccounting(result, envelope, {
              policy,
              tools,
              permissionMode: "dontAsk",
              ...(mcpConfig ? { mcpServers: mcpConfig.servers } : {}),
            });

        output.push({
          json: toDataObject(accounted),
          ...(items[itemIndex] ? { pairedItem: { item: itemIndex } } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.continueOnFail()) {
          output.push({ json: { error: message }, pairedItem: { item: itemIndex } });
          continue;
        }
        throw new NodeOperationError(
          this.getNode(),
          `Software Teams Claude Code execution failed: ${message}`,
          { itemIndex },
        );
      }
    }
    return [output];
  }
}

function freshEnvelope(context: unknown): NodeEnvelope {
  return {
    correlationId: randomUUID(),
    agentId: "software-teams-claude-code",
    status: "ok",
    input: { prompt: "", context },
    result: { text: "" },
    artifacts: [],
  };
}

function stringifyParameter(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? TURN_RESULT_SCHEMA);
}
