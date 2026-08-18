import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import { softwareTeamsCredentialTest } from '../../src/execution/verify-credential';
import { authFromCredentials } from '../../src/execution/auth-from-credentials';
import { randomUUID } from 'node:crypto';
import type { NodeEnvelope } from '@websitelabs/software-teams';
import {
  buildReadinessEnvelope,
  deserialiseRunState,
  enumerateAgentResults,
  getRunStore,
  isNodeEnvelope,
  parseReadinessVerdict,
  planEpic,
  readRunState,
  recordAgentResult,
  serialiseRunState,
  summarise,
  writeRunState,
  type PlanResult,
} from '../../src/orchestration/run-state';
import { toDataObject } from '../../src/n8n-cast';

/**
 * Prefill for the epic field: an upstream Ticket Intake envelope's title and
 * description, falling back to the envelope prompt so the node stays usable
 * when fed by hand or by a non-ticket trigger.
 *
 * One literal rather than a concatenation because the n8n node linter only
 * recognises a `default` it can read statically.
 */
const EPIC_FROM_TICKET =
  '={{ $json.input?.context?.ticket ? [$json.input.context.ticket.title, $json.input.context.ticket.description].filter(Boolean).join("\n\n") : ($json.input?.prompt || "") }}';

// n8n tsconfig (module: commonjs) cannot statically resolve single-turn.ts — its
// require path prevents TypeScript from type-checking the Bun import chain here.
// The orchestration core (run-state.ts) is Bun-free and IS imported statically
// above; the adapter is injected into `planEpic`, keeping it testable.
type RunAgentTurnFn = (
  input: NodeEnvelope,
  repoContext?: undefined,
  githubToken?: string,
  options?: {
    readonly model?: string;
    readonly effort?: string;
    readonly auth?: { mode: 'subscription' | 'apiKey'; oauthToken?: string; apiKey?: string };
  },
) => Promise<NodeEnvelope>;

const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

// Sourced from the shared CLI surface so the two nodes that offer a model
// picker cannot drift apart. See shared/claude-code-surface.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { N8N_MODEL_OPTIONS, N8N_DEFAULT_MODEL, N8N_EFFORT_OPTIONS } = require(
  '@websitelabs/software-teams',
) as {
  N8N_MODEL_OPTIONS: Array<{ name: string; value: string }>;
  N8N_DEFAULT_MODEL: string;
  N8N_EFFORT_OPTIONS: Array<{ name: string; value: string }>;
};

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
    credentials: [{ name: 'softwareTeamsApi', required: true, testedBy: 'softwareTeamsApiTest' }],
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
            name: 'Review',
            value: 'review',
            description: 'Validate a generated plan for one-shot readiness before fan-out (AC1 readiness gate)',
            action: 'Validate a generated plan for one shot readiness before fan out',
          },
          {
            name: 'Summary',
            value: 'summary',
            description: 'Read aggregated run-state for a completed or in-flight run and emit an Orchestrator-centric human summary of what each agent did',
            action: 'Read aggregated run state and emit a human summary of what each agent did',
          },
        ],
        default: 'plan',
        description: 'Whether to plan a new epic, review a plan, or summarise an existing run',
      },
      {
        displayName: 'Epic / Sprint Goal',
        name: 'epic',
        type: 'string',
        typeOptions: { rows: 5 },
        // Prefilled from an upstream Ticket Intake envelope: its title and
        // description are the goal, and falling back to input.prompt keeps the
        // node usable when it is fed by hand or by a non-ticket trigger.
        default: EPIC_FROM_TICKET,
        required: true,
        description:
          'The epic, sprint goal, or project to break down into a waved task ' +
          'plan. Prefilled from an upstream Ticket Intake node (its ticket title ' +
          'and description), falling back to the envelope prompt. Safe to edit, ' +
          'and supports n8n expressions.',
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
        options: N8N_MODEL_OPTIONS,
        default: N8N_DEFAULT_MODEL,
        description:
          'Claude model used for the planning turn. Injected via the ' +
          '--model flag on the Claude CLI.',
      },
      {
        displayName: 'Effort',
        name: 'effort',
        type: 'options',
        noDataExpression: true,
        options: N8N_EFFORT_OPTIONS,
        default: '',
        description:
          'How thorough the planning turn is, independent of how capable the model ' +
          'makes it. Passed to the Claude CLI as --effort. Leave on Model Default ' +
          'unless planning specifically needs more thoroughness or more speed.',
      },
    ],
		usableAsTool: true,
  };

  /** Credential test, declared via `testedBy` above. Shared so the nodes cannot drift. */

  methods = { credentialTest: softwareTeamsCredentialTest };


  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Credentials (R-02: NEVER written to output)
    const credentials = await this.getCredentials('softwareTeamsApi');
    // Resolved and passed down, never written to process.env: an n8n worker is
    // long-lived and shared, so a mutation there leaks into later executions.
    const auth = authFromCredentials(credentials);
    const githubToken = (credentials.githubToken as string | undefined) || undefined;
    // `model` is read per item below, so bind lazily rather than capturing one
    // value here. Before this, the node's model parameter was written to a
    // non-existent env var and never reached the CLI at all.
    const bindRunAgentTurn =
      (model: string, effort: string): ((input: NodeEnvelope) => Promise<NodeEnvelope>) =>
      (input) =>
        runAgentTurn(input, undefined, githubToken, { model, effort, auth });

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

      // -------------------------------------------------------------------
      // review — one-shot readiness gate (AC1, T6)
      // -------------------------------------------------------------------
      if (operation === 'review') {
        const upstreamCorrelationId =
          isNodeEnvelope(upstream) ? (upstream.correlationId as string) : '';
        const correlationIdParam = (
          this.getNodeParameter('correlationId', i, '') as string
        ).trim();
        const resolvedId = upstreamCorrelationId || correlationIdParam;

        if (!resolvedId) {
          const errEnv: NodeEnvelope = {
            correlationId: '',
            agentId: 'software-teams-quality',
            status: 'needs-input',
            input: { prompt: '', context: null },
            result: { text: 'Review requires a correlationId — the run must be planned first.' },
            artifacts: [],
          };
          returnData.push({ json: toDataObject(errEnv), pairedItem: { item: i } });
          continue;
        }

        const epic = (this.getNodeParameter('epic', i) as string)?.trim();

        const model = this.getNodeParameter('model', i, N8N_DEFAULT_MODEL) as string;
        const effort = this.getNodeParameter('effort', i, '') as string;

        // Maximum 2 refine attempts (re-plan + re-review); after that, park via HITL.
        const MAX_REFINE_ATTEMPTS = 2;
        let accumulatedGaps: string[] = [];

        for (let attempt = 0; attempt <= MAX_REFINE_ATTEMPTS; attempt++) {
          const runState = readRunState(staticData, resolvedId);
          if (runState === null) {
            const errEnv: NodeEnvelope = {
              correlationId: resolvedId,
              agentId: 'software-teams-quality',
              status: 'needs-input',
              input: { prompt: '', context: null },
              result: { text: `No run-state found for correlationId "${resolvedId}" — the run must be planned first.` },
              artifacts: [],
            };
            returnData.push({ json: toDataObject(errEnv), pairedItem: { item: i } });
            break;
          }

          // Run the single-turn quality pass
          const readinessEnv = buildReadinessEnvelope(runState, resolvedId);
          let qualityResponse: NodeEnvelope;
          try {
            qualityResponse = await bindRunAgentTurn(model, effort)(readinessEnv);
          } catch (err) {
            if (this.continueOnFail()) {
              returnData.push({
                json: { error: err instanceof Error ? err.message : String(err) },
                pairedItem: { item: i },
              });
              break;
            }
            throw new NodeOperationError(
              this.getNode(),
              `Readiness review failed: ${err instanceof Error ? err.message : String(err)}`,
              { itemIndex: i },
            );
          }

          const verdict = parseReadinessVerdict(qualityResponse.result.text);

          if (verdict.ready) {
            // PASS — emit green "ready" signal for downstream fan-out gate
            const readyEnv: NodeEnvelope = {
              correlationId: resolvedId,
              agentId: 'software-teams-quality',
              status: 'ok',
              input: { prompt: '', context: { operation: 'review' } },
              result: { text: 'Readiness gate: PASS — plan is ready for fan-out.' },
              artifacts: [],
            };
            returnData.push({
              json: {
                ...toDataObject(readyEnv),
                review: { ready: true },
              },
              pairedItem: { item: i },
            });
            break;
          }

          // BLOCKED — accumulate gaps
          accumulatedGaps = [...accumulatedGaps, ...verdict.gaps];

          // If we have exhausted refine attempts, park via HITL
          if (attempt >= MAX_REFINE_ATTEMPTS) {
            const parkedEnv: NodeEnvelope = {
              correlationId: resolvedId,
              agentId: 'software-teams-quality',
              status: 'needs-input',
              input: { prompt: '', context: { operation: 'review' } },
              result: {
                text: `Readiness gate: BLOCKED after ${MAX_REFINE_ATTEMPTS} refine attempt(s).\n\nBlocking gaps:\n${accumulatedGaps.map((g) => `- ${g}`).join('\n')}`,
              },
              artifacts: [],
            };
            returnData.push({
              json: {
                ...toDataObject(parkedEnv),
                review: { ready: false, gaps: accumulatedGaps },
              },
              pairedItem: { item: i },
            });
            break;
          }

          // Auto-refine: re-invoke planEpic with gaps appended to the epic
          if (!epic) {
            // Cannot refine without the epic text — park immediately
            const parkedEnv: NodeEnvelope = {
              correlationId: resolvedId,
              agentId: 'software-teams-quality',
              status: 'needs-input',
              input: { prompt: '', context: { operation: 'review' } },
              result: {
                text: `Readiness gate: BLOCKED — cannot auto-refine without an epic.\n\nBlocking gaps:\n${accumulatedGaps.map((g) => `- ${g}`).join('\n')}`,
              },
              artifacts: [],
            };
            returnData.push({
              json: {
                ...toDataObject(parkedEnv),
                review: { ready: false, gaps: accumulatedGaps },
              },
              pairedItem: { item: i },
            });
            break;
          }

          const refinedEpic = `${epic}\n\n## Readiness gaps to address\n${verdict.gaps.join('\n')}`;
          let refinedPlan: PlanResult;
          try {
            refinedPlan = await planEpic(refinedEpic, resolvedId, bindRunAgentTurn(model, effort));
          } catch (err) {
            if (this.continueOnFail()) {
              returnData.push({
                json: { error: err instanceof Error ? err.message : String(err) },
                pairedItem: { item: i },
              });
              break;
            }
            throw new NodeOperationError(
              this.getNode(),
              `Readiness refine (attempt ${attempt + 1}) failed: ${err instanceof Error ? err.message : String(err)}`,
              { itemIndex: i },
            );
          }

          if (refinedPlan.plannerNeedsInput) {
            returnData.push({
              json: toDataObject(refinedPlan.plannerNeedsInput),
              pairedItem: { item: i },
            });
            break;
          }

          // Persist the refined plan (overwrites the prior plan)
          writeRunState(staticData, resolvedId, refinedPlan.state);
          // Loop back to re-review the refreshed plan
        }
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

      const model = this.getNodeParameter('model', i, N8N_DEFAULT_MODEL) as string;
      const effort = this.getNodeParameter('effort', i, '') as string;

      let plan: PlanResult;
      try {
        plan = await planEpic(epic, correlationId, bindRunAgentTurn(model, effort));
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
