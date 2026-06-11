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
  deserialiseRunState,
  enumerateAgentResults,
  getRunStore,
  isNodeEnvelope,
  planEpic,
  readRunState,
  recordAgentResult,
  serialiseRunState,
  summarise,
  type PlanResult,
} from '../../src/orchestration/run-state';
import { toDataObject } from '../../src/n8n-cast';

// n8n tsconfig (module: commonjs) cannot statically resolve single-turn.ts — its
// require path prevents TypeScript from type-checking the Bun import chain here.
// The orchestration core (run-state.ts) is Bun-free and IS imported statically
// above; the adapter is injected into `planEpic`, keeping it testable.
type RunAgentTurnFn = (
  input: NodeEnvelope,
  repoContext?: undefined,
  githubToken?: string,
) => Promise<NodeEnvelope>;

const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

const MODEL_OPTIONS: Array<{ name: string; value: string }> = [
  { name: 'Claude Sonnet 4.5 (Default)', value: 'claude-sonnet-4-5' },
  { name: 'Claude Opus 4', value: 'claude-opus-4-5' },
  { name: 'Claude Haiku 3.5', value: 'claude-haiku-3-5' },
];

/**
 * SoftwareTeamsOrchestrator node (AC4, R-04, R-05).
 *
 * Accepts an epic / sprint goal, runs ONE single-turn planning pass through the
 * T3 adapter as `software-teams-planner`, and emits one output item per
 * wave-task as a NodeEnvelope, ordered by wave then dependency.
 * ARCHITECTURE.md §"Decision C — Canvas handoff" is the authority for item
 * emission. Run state is persisted to workflow static data (R-05).
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
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Plan',
            value: 'plan',
            description: 'Break an epic into a waved task breakdown and fan out one envelope per task (default behaviour)',
            action: 'Break an epic into a waved task breakdown and fan out one envelope per task',
          },
          {
            name: 'Summary',
            value: 'summary',
            description: 'Read aggregated run-state for a completed or in-flight run and emit an Orchestrator-centric human summary of what each agent did',
            action: 'Read aggregated run state and emit a human summary of what each agent did',
          },
        ],
        default: 'plan',
        description: 'Whether to plan a new epic or summarise an existing run',
      },
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

    // Credentials (R-02: NEVER written to output)
    const credentials = await this.getCredentials('softwareTeamsApi');
    process.env['ANTHROPIC_API_KEY'] = credentials.anthropicApiKey as string;
    const githubToken = (credentials.githubToken as string | undefined) || undefined;
    const boundRunAgentTurn: (input: NodeEnvelope) => Promise<NodeEnvelope> = (input) =>
      runAgentTurn(input, undefined, githubToken);

    const staticData = this.getWorkflowStaticData('global') as IDataObject;
    const runs = getRunStore(staticData);

    const itemCount = items.length > 0 ? items.length : 1;

    // n8n per-item + continueOnFail pattern; entries() avoids a let counter.
    for (const [i] of Array.from({ length: itemCount }).entries()) {
      const upstream = (items[i]?.json ?? {}) as Record<string, unknown>;

      if (isNodeEnvelope(upstream) && upstream.status === 'needs-input') {
        returnData.push({ json: toDataObject(upstream), pairedItem: { item: i } });
        continue;
      }

      if (isNodeEnvelope(upstream) && upstream.status === 'error') {
        returnData.push({ json: toDataObject(upstream), pairedItem: { item: i } });
        continue;
      }

      if (isNodeEnvelope(upstream) && runs[upstream.correlationId] !== undefined) {
        const existing = deserialiseRunState(runs[upstream.correlationId]);
        if (existing !== null) {
          const ctx = upstream.input.context as Record<string, unknown> | null | undefined;
          if (typeof ctx?.taskId === 'string') {
            const updated = recordAgentResult(existing, upstream);
            runs[upstream.correlationId] = serialiseRunState(updated);
            const results = enumerateAgentResults(updated);
            returnData.push({
              json: {
                ...toDataObject(upstream),
                agentResults: results,
              },
              pairedItem: { item: i },
            });
            continue;
          }
        }
      }

      const operation = (this.getNodeParameter('operation', i, 'plan') as string) || 'plan';

      if (operation === 'summary') {
        const upstreamCorrelationId =
          isNodeEnvelope(upstream) ? (upstream.correlationId as string) : '';
        const correlationIdParam = (
          this.getNodeParameter('correlationId', i, '') as string
        ).trim();
        const resolvedId = upstreamCorrelationId || correlationIdParam;

        const runState = resolvedId !== '' ? readRunState(staticData, resolvedId) : null;

        const agentLines =
          runState !== null
            ? enumerateAgentResults(runState).map(
                (r) => `- ${r.agent} (${r.taskId}): ${r.status}`,
              )
            : [];
        const runSummary = runState !== null ? summarise(runState) : null;
        const outcomeText =
          runSummary !== null
            ? `Overall: ${runSummary.done}/${runSummary.total} done` +
              (runSummary.error > 0 ? `, ${runSummary.error} error(s)` : '') +
              (runSummary.needsInput > 0 ? `, ${runSummary.needsInput} awaiting input` : '') +
              (runSummary.complete ? ' — run complete.' : runSummary.resumable ? ' — run resumable.' : '.')
            : 'No run-state found for this correlationId.';

        const summaryText =
          agentLines.length > 0
            ? `Orchestrator run summary (${resolvedId || 'unknown'}):\n${agentLines.join('\n')}\n${outcomeText}`
            : `Orchestrator run summary (${resolvedId || 'unknown'}): ${outcomeText}`;

        returnData.push({
          json: {
            correlationId: resolvedId,
            operation: 'summary',
            summary: summaryText,
            agentResults: runState !== null ? enumerateAgentResults(runState) : [],
          },
          pairedItem: { item: i },
        });
        continue;
      }

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

      let plan: PlanResult;
      try {
        plan = await planEpic(epic, correlationId, boundRunAgentTurn);
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

      if (plan.plannerNeedsInput) {
        returnData.push({
          json: toDataObject(plan.plannerNeedsInput),
          pairedItem: { item: i },
        });
        continue;
      }

      runs[correlationId] = serialiseRunState(plan.state);
      const summary = summarise(plan.state);

      plan.envelopes.forEach((env) => {
        returnData.push({
          json: {
            ...toDataObject(env),
            run: { correlationId, taskCount: summary.total },
          },
          pairedItem: { item: i },
        });
      });
    }

    return [returnData];
  }
}
