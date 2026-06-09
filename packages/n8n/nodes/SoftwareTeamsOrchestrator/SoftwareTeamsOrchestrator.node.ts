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
import {
  isNodeEnvelope,
  planEpic,
  serialiseRunState,
  summarise,
  type PlanResult,
} from '../../src/orchestration/run-state';

// ---------------------------------------------------------------------------
// runAgentTurn loader — break the static import chain to Bun-specific code
// ---------------------------------------------------------------------------
// single-turn.ts uses `import.meta.dir` and `Bun.*` APIs that don't compile
// under the n8n tsconfig (module: commonjs, no Bun types).  A `string`-typed
// require argument prevents TypeScript from resolving the module statically, so
// the Bun import chain is never type-checked here.  The orchestration core
// (run-state.ts) is Bun-free and IS imported statically above; the adapter is
// injected into `planEpic`, keeping that logic runtime-agnostic and testable.

type RunAgentTurnFn = (input: NodeEnvelope) => Promise<NodeEnvelope>;

const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

// ---------------------------------------------------------------------------
// Model options (mirror the Agent node — per-node model selection, R-03)
// ---------------------------------------------------------------------------

const MODEL_OPTIONS: Array<{ name: string; value: string }> = [
  { name: 'Claude Sonnet 4.5 (Default)', value: 'claude-sonnet-4-5' },
  { name: 'Claude Opus 4', value: 'claude-opus-4-5' },
  { name: 'Claude Haiku 3.5', value: 'claude-haiku-3-5' },
];

// ---------------------------------------------------------------------------
// Orchestrator Node
// ---------------------------------------------------------------------------

/**
 * SoftwareTeamsOrchestrator node (AC4, R-04, R-05).
 *
 * Accepts an epic / sprint goal, runs ONE single-turn planning pass through the
 * T3 adapter as `software-teams-planner` (the planner spec is inlined by the
 * adapter — its breakdown logic is reused, not re-authored), and **emits one
 * output item per wave-task** as a NodeEnvelope, ordered by wave then
 * dependency. This is the canvas-delegation mechanism defined in
 * ARCHITECTURE.md §"Decision C — Canvas handoff replaces the native Task tool":
 * downstream Agent nodes consume these items (static wiring or a Switch keyed on
 * `agentId`) in wave order; the Orchestrator owns sequencing explicitly — there
 * is no hidden Task-tool graph.
 *
 * Run state (waves, per-task status, correlationId) is persisted to the
 * workflow's static data keyed by `correlationId`, so a partial failure leaves
 * a resumable, traceable run rather than a silent half-completion (R-05).
 *
 * needs-input bubbling: a sub-agent `needs-input` envelope arriving on the input
 * (or a planner that itself needs human input) is passed through UNCHANGED so a
 * downstream Switch on `{{ $json.status === 'needs-input' }}` routes it to the
 * Slack HITL flow (T10). An `error` envelope is surfaced (short-circuited)
 * rather than re-planned. The Slack loop itself is NOT implemented here.
 */
export class SoftwareTeamsOrchestrator implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Orchestrator',
    name: 'softwareTeamsOrchestrator',
    icon: 'file:softwareTeamsOrchestrator.svg',
    group: ['transform'],
    version: 1,
    description:
      'Break an epic / sprint goal into a waved task breakdown and delegate it ' +
      'to downstream Software Teams Agent nodes. Emits one NodeEnvelope per ' +
      'wave-task in dependency order.',
    subtitle: '={{ $parameter["epic"]?.slice(0, 40) }}',
    defaults: { name: 'Software Teams Orchestrator' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'softwareTeamsApi', required: true }],
    properties: [
      // ── Epic / goal ──────────────────────────────────────────────────────
      {
        displayName: 'Epic / Sprint Goal',
        name: 'epic',
        type: 'string',
        typeOptions: { rows: 5 },
        default: '',
        required: true,
        description:
          'The epic, sprint goal, or project to break down into a waved task ' +
          'plan. Supports n8n expressions — e.g. pull it from an upstream ' +
          "trigger with {{ $json.input.prompt }}.",
      },

      // ── Correlation id ───────────────────────────────────────────────────
      {
        displayName: 'Correlation ID',
        name: 'correlationId',
        type: 'string',
        default: '',
        description:
          'Stable run id carried unchanged onto every emitted envelope and used ' +
          'as the run-state / Slack-resume key (R-05). Leave blank to generate ' +
          'one. Reuse an upstream envelope\'s correlationId to continue its run.',
      },

      // ── Model ────────────────────────────────────────────────────────────
      {
        displayName: 'Planner Model',
        name: 'model',
        type: 'options',
        noDataExpression: true,
        options: MODEL_OPTIONS,
        default: 'claude-sonnet-4-5',
        description:
          'Claude model used for the planning turn. Injected via the ' +
          'ANTHROPIC_DEFAULT_MODEL environment variable for the Claude CLI.',
      },
    ],
		usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // ── Credentials ────────────────────────────────────────────────────────
    // Injected for the claude CLI child process only; NEVER written to output (R-02).
    const credentials = await this.getCredentials('softwareTeamsApi');
    process.env['ANTHROPIC_API_KEY'] = credentials.anthropicApiKey as string;

    // Persisted run state lives on the workflow's static data (survives across
    // executions → resumable runs, R-05).
    const staticData = this.getWorkflowStaticData('node') as IDataObject;
    let runs = staticData['runs'] as Record<string, unknown> | undefined;
    if (!runs) {
      runs = {};
      staticData['runs'] = runs;
    }

    // At least one iteration even when upstream sends zero items.
    const itemCount = items.length > 0 ? items.length : 1;

    for (let i = 0; i < itemCount; i++) {
      const upstream = (items[i]?.json ?? {}) as Record<string, unknown>;

      // ── Bubble a sub-agent needs-input up for the Slack HITL flow (T10) ────
      // Pass the envelope through UNCHANGED so a downstream Switch can route it.
      if (isNodeEnvelope(upstream) && upstream.status === 'needs-input') {
        returnData.push({
          json: upstream as unknown as IDataObject,
          pairedItem: { item: i },
        });
        continue;
      }

      // ── Short-circuit a sub-agent error (R-05): surface, do not re-plan ────
      if (isNodeEnvelope(upstream) && upstream.status === 'error') {
        returnData.push({
          json: upstream as unknown as IDataObject,
          pairedItem: { item: i },
        });
        continue;
      }

      // ── Resolve parameters ─────────────────────────────────────────────────
      const epic = (this.getNodeParameter('epic', i) as string)?.trim();
      if (!epic) {
        throw new NodeOperationError(
          this.getNode(),
          'Software Teams Orchestrator requires an epic / sprint goal.',
          { itemIndex: i },
        );
      }
      const correlationIdParam = (
        this.getNodeParameter('correlationId', i, '') as string
      ).trim();
      const correlationId = correlationIdParam || randomUUID();

      const model = this.getNodeParameter('model', i, 'claude-sonnet-4-5') as string;
      if (model) {
        process.env['ANTHROPIC_DEFAULT_MODEL'] = model;
      }

      // ── Plan: single-turn planner pass → ordered per-task envelopes ─────────
      let plan: PlanResult;
      try {
        plan = await planEpic(epic, correlationId, runAgentTurn);
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
          `Software Teams Orchestrator planning failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { itemIndex: i },
        );
      }

      // ── Planner itself needs human input → bubble up for T10 ────────────────
      if (plan.plannerNeedsInput) {
        returnData.push({
          json: plan.plannerNeedsInput as unknown as IDataObject,
          pairedItem: { item: i },
        });
        continue;
      }

      // ── Persist run state keyed by correlationId (R-05) ─────────────────────
      runs[correlationId] = serialiseRunState(plan.state);
      const summary = summarise(plan.state);

      // ── Emit one output item per wave-task envelope, in wave/dep order ──────
      // ARCHITECTURE.md §"Decision C" is the authority for this item-emission
      // contract. Run-state context (taskCount/summary) rides on each item so a
      // downstream Merge/Switch can gate per wave and re-drive on partial failure.
      for (const env of plan.envelopes) {
        returnData.push({
          json: {
            ...(env as unknown as IDataObject),
            run: {
              correlationId,
              taskCount: summary.total,
            },
          },
          pairedItem: { item: i },
        });
      }
    }

    return [returnData];
  }
}
