import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import { randomUUID } from 'node:crypto';
import type { NodeEnvelope } from '@websitelabs/software-teams';

// ---------------------------------------------------------------------------
// runAgentTurn loader — break the static import chain to Bun-specific code
// ---------------------------------------------------------------------------
// single-turn.ts uses `import.meta.dir` and `Bun.*` APIs that don't compile
// under the n8n tsconfig (module: commonjs, no Bun types).  Using a `string`-
// typed variable as the `require()` argument prevents TypeScript from resolving
// the module statically, so the Bun import chain is never type-checked here.
// The type is manually declared to match T3's implementation exactly.

type RunAgentTurnFn = (input: NodeEnvelope) => Promise<NodeEnvelope>;

const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

// ---------------------------------------------------------------------------
// Specialist options — statically sourced from agents/*.md filenames
// (Do NOT shell out at load time; n8n loads node descriptors synchronously)
// ---------------------------------------------------------------------------

const SPECIALIST_OPTIONS: Array<{ name: string; value: string }> = [
  { name: 'Architect', value: 'software-teams-architect' },
  { name: 'Backend Engineer', value: 'software-teams-backend' },
  { name: 'Codebase Mapper', value: 'software-teams-codebase-mapper' },
  { name: 'Committer', value: 'software-teams-committer' },
  { name: 'Debugger', value: 'software-teams-debugger' },
  { name: 'Dev Planner', value: 'software-teams-dev-planner' },
  { name: 'DevOps', value: 'software-teams-devops' },
  { name: 'Feedback Learner', value: 'software-teams-feedback-learner' },
  { name: 'Frontend Engineer', value: 'software-teams-frontend' },
  { name: 'Game AI Engineer', value: 'software-teams-game-ai-engineer' },
  { name: 'Game Art Pipeline', value: 'software-teams-game-art-pipeline' },
  { name: 'Game Designer', value: 'software-teams-game-designer' },
  { name: 'Game DevOps', value: 'software-teams-game-devops' },
  { name: 'Game Engineer', value: 'software-teams-game-engineer' },
  { name: 'Game Producer', value: 'software-teams-game-producer' },
  { name: 'Game QA', value: 'software-teams-game-qa' },
  { name: 'Game Tech Artist', value: 'software-teams-game-tech-artist' },
  { name: 'Head of Engineering', value: 'software-teams-head-engineering' },
  { name: 'Performance Analyst', value: 'software-teams-perf-analyst' },
  { name: 'Phase Researcher', value: 'software-teams-phase-researcher' },
  { name: 'Plan Checker', value: 'software-teams-plan-checker' },
  { name: 'Planner', value: 'software-teams-planner' },
  { name: 'PR Feedback', value: 'software-teams-pr-feedback' },
  { name: 'PR Generator', value: 'software-teams-pr-generator' },
  { name: 'Producer', value: 'software-teams-producer' },
  { name: 'Product Lead', value: 'software-teams-product-lead' },
  { name: 'Programmer', value: 'software-teams-programmer' },
  { name: 'QA Tester', value: 'software-teams-qa-tester' },
  { name: 'Quality Engineer', value: 'software-teams-quality' },
  { name: 'Researcher', value: 'software-teams-researcher' },
  { name: 'Security Engineer', value: 'software-teams-security' },
  { name: 'UX Designer', value: 'software-teams-ux-designer' },
  { name: 'Verifier', value: 'software-teams-verifier' },
];

// ---------------------------------------------------------------------------
// Model options
// ---------------------------------------------------------------------------

const MODEL_OPTIONS: Array<{ name: string; value: string }> = [
  { name: 'Claude Sonnet 4.5 (Default)', value: 'claude-sonnet-4-5' },
  { name: 'Claude Opus 4', value: 'claude-opus-4-5' },
  { name: 'Claude Haiku 3.5', value: 'claude-haiku-3-5' },
];

// ---------------------------------------------------------------------------
// Agent Node
// ---------------------------------------------------------------------------

/**
 * SoftwareTeamsAgent node.
 *
 * Runs exactly ONE specialist turn via the Claude CLI (`runAgentTurn` from T3)
 * and emits a typed `NodeEnvelope` on its output port.
 *
 * Handoff: When the input item carries an upstream `NodeEnvelope` (identified
 * by `correlationId` + `agentId` + `status` fields), this node folds the
 * upstream result/artifacts into `input.context` per CONTRACT.md §3, preserves
 * `correlationId`, and sets `agentId` to this node's chosen specialist.
 *
 * First node: When there is no upstream envelope, a fresh `correlationId` is
 * generated and `input.context` is taken from the optional Context parameter.
 *
 * `needs-input`: The `status` field in the output envelope carries the raw
 * value from `runAgentTurn`. A downstream Switch node can route on
 * `{{ $json.status === 'needs-input' }}` to feed the Slack HITL flow (T10).
 * The Slack loop is NOT implemented here.
 */
export class SoftwareTeamsAgent implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Agent',
    name: 'softwareTeamsAgent',
    icon: 'file:softwareTeamsAgent.svg',
    group: ['transform'],
    version: 1,
    description:
      'Run a Software Teams specialist agent for one turn. ' +
      'Emits a NodeEnvelope; wire multiple Agent nodes A→B for multi-agent handoff.',
    subtitle: '={{ $parameter["specialist"] }}',
    defaults: { name: 'Software Teams Agent' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      { name: 'softwareTeamsApi', required: true },
    ],
    properties: [
      // ── Specialist ─────────────────────────────────────────────────────────
      {
        displayName: 'Specialist',
        name: 'specialist',
        type: 'options',
        noDataExpression: true,
        options: SPECIALIST_OPTIONS,
        default: 'software-teams-programmer',
        required: true,
        description:
          'The Software Teams specialist to invoke for this turn. ' +
          'Matches a name in agents/*.md.',
      },

      // ── Prompt ─────────────────────────────────────────────────────────────
      {
        displayName: 'Prompt',
        name: 'prompt',
        type: 'string',
        typeOptions: { rows: 5 },
        default: '',
        required: true,
        description:
          'The task instruction for this specialist turn (the `input.prompt` ' +
          'field of the NodeEnvelope). Supports n8n expressions.',
      },

      // ── Context (first-node only) ──────────────────────────────────────────
      {
        displayName: 'Context (JSON)',
        name: 'context',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        description:
          'Optional JSON context for the first node in a workflow. ' +
          'Ignored when an upstream NodeEnvelope is present (handoff nodes ' +
          'inherit context from the upstream result automatically).',
      },

      // ── Model ──────────────────────────────────────────────────────────────
      {
        displayName: 'Model',
        name: 'model',
        type: 'options',
        noDataExpression: true,
        options: MODEL_OPTIONS,
        default: 'claude-sonnet-4-5',
        description:
          'Claude model to use for this turn. Injected via the ' +
          'ANTHROPIC_DEFAULT_MODEL environment variable for the Claude CLI.',
      },
    ],
		usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // ── Credentials ──────────────────────────────────────────────────────────
    const credentials = await this.getCredentials('softwareTeamsApi');
    const anthropicApiKey = credentials.anthropicApiKey as string;

    // Inject API key for the claude CLI child process.
    // Credentials are NEVER written to returnData (R-02).
    process.env['ANTHROPIC_API_KEY'] = anthropicApiKey;

    // ── Process each item ─────────────────────────────────────────────────────
    // Use at least one iteration even when upstream sends zero items.
    const itemCount = items.length > 0 ? items.length : 1;

    for (let i = 0; i < itemCount; i++) {
      // Node parameters
      const specialist = this.getNodeParameter('specialist', i) as string;
      const prompt = this.getNodeParameter('prompt', i) as string;
      const contextRaw = this.getNodeParameter('context', i, '') as string;
      const model = this.getNodeParameter('model', i, 'claude-sonnet-4-5') as string;

      // Inject model env hint for the Claude CLI
      if (model) {
        process.env['ANTHROPIC_DEFAULT_MODEL'] = model;
      }

      // ── Detect upstream NodeEnvelope ────────────────────────────────────────
      // A valid envelope has correlationId (string), agentId (string), status.
      const upstream = (items[i]?.json ?? {}) as Record<string, unknown>;
      const isUpstreamEnvelope =
        typeof upstream['correlationId'] === 'string' &&
        upstream['correlationId'].length > 0 &&
        typeof upstream['agentId'] === 'string' &&
        typeof upstream['status'] === 'string';

      let envelope: NodeEnvelope;

      if (isUpstreamEnvelope) {
        // ── A→B handoff (CONTRACT.md §3) ────────────────────────────────────
        // Fold upstream result + artifacts into input.context.
        // correlationId is carried UNCHANGED; agentId is rewritten to this node's specialist.
        const up = upstream as unknown as NodeEnvelope;
        envelope = {
          correlationId: up.correlationId,
          agentId: specialist,
          status: 'ok',
          input: {
            prompt,
            context: {
              from: up.agentId,
              upstreamStatus: up.status,
              result: up.result,
              artifacts: up.artifacts,
            },
          },
          result: { text: '' },
          artifacts: Array.isArray(up.artifacts) ? [...up.artifacts] : [],
        };
      } else {
        // ── First node: construct fresh envelope ─────────────────────────────
        let parsedContext: unknown = null;
        if (contextRaw && contextRaw.trim()) {
          try {
            parsedContext = JSON.parse(contextRaw);
          } catch {
            // Treat as plain string context if not valid JSON
            parsedContext = contextRaw;
          }
        }

        envelope = {
          correlationId: randomUUID(),
          agentId: specialist,
          status: 'ok',
          input: {
            prompt,
            context: parsedContext,
          },
          result: { text: '' },
          artifacts: [],
        };
      }

      // ── Run agent turn ───────────────────────────────────────────────────────
      let result: NodeEnvelope;
      try {
        result = await runAgentTurn(envelope);
      } catch (err) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: err instanceof Error ? err.message : String(err) },
            pairedItem: { item: i },
          });
          continue;
        }
        throw new NodeOperationError(
          this.getNode(),
          `Software Teams Agent execution failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { itemIndex: i },
        );
      }

      // ── Emit output envelope ─────────────────────────────────────────────────
      // The full NodeEnvelope is the output item's `json` payload.
      // A downstream Switch node can route on `{{ $json.status }}` to handle
      // the 'needs-input' branch for Slack HITL (T10).
      returnData.push({
        json: result as unknown as IDataObject,
        pairedItem: { item: i },
      });
    }

    return [returnData];
  }
}
