import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

import { parseCorrelationTag } from '@websitelabs/software-teams';
import { deleteRunState } from '../../src/orchestration/run-state/global-store';
import { deleteState } from '../../src/hitl/conversation-state';
import {
  teardownWorktree,
  teardownClone,
  teardownAgentMemories,
  teardownPlanArtefacts,
  type TeardownResult,
} from '../../src/repo/teardown';
import { toDataObject } from '../../src/n8n-cast';

/**
 * Per-step teardown report entry.
 * Collected into an array and emitted on the output — never contains secrets (R-02).
 */
interface StepReport {
  readonly step: string;
  readonly removed: boolean;
  readonly detail?: string;
}

/**
 * SoftwareTeamsCleanup node (AC5, R-04).
 *
 * Fired by a GitHub MERGE webhook (`pull_request` event, `closed` action,
 * `merged === true`). Recovers the run's `correlationId` from the PR body tag
 * (via `parseCorrelationTag`) and idempotently tears down all per-run state:
 *
 * 1. `runs[correlationId]` in global static data (deleteRunState)
 * 2. Conversation state (deleteState)
 * 3. Git worktrees (teardownWorktree)
 * 4. Repo clones (teardownClone)
 * 5. Agent memories (teardownAgentMemories)
 * 6. Plan/task artefacts (teardownPlanArtefacts)
 *
 * Each step is independently guarded — one failure never aborts the rest.
 * Running twice for the same correlationId is a clean no-op (AC5/R-04).
 * Forward-only teardown; no Agent->Orchestrator return edge (ADR invariant).
 */
export class SoftwareTeamsCleanup implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Cleanup',
    name: 'softwareTeamsCleanup',
    icon: 'file:SoftwareTeamsCleanup.svg',
    group: ['output'],
    version: 1,
    description:
      'GitHub merge webhook teardown (AC5). ' +
      'Idempotently tears down run-state, conversation-state, worktrees, clones, ' +
      'agent memories, and plan artefacts for a merged PR\'s correlationId.',
    subtitle: 'Cleanup: {{ $parameter["correlationId"] || "from PR body" }}',
    defaults: {
      name: 'Software Teams Cleanup',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'softwareTeamsApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Correlation ID',
        name: 'correlationId',
        type: 'string',
        default: '',
        placeholder: 'Leave blank to parse from PR body tag',
        description:
          'Explicit correlationId override. When blank the node parses the ' +
          'machine-readable tag from the merged PR body ({{ $json.pull_request.body }}).',
      },
      {
        displayName: 'Runs Base Directory',
        name: 'runsBaseDir',
        type: 'string',
        default: '={{ $env.SOFTWARE_TEAMS_RUNS_DIR || "/data/software-teams-runs" }}',
        description:
          'Safety-guard base for all rm-based teardown. ' +
          'teardownClone and teardownPlanArtefacts refuse paths outside this directory (R-04).',
      },
      {
        displayName: 'Worktree Path',
        name: 'worktreePath',
        type: 'string',
        default: '',
        placeholder: 'Optional — defaults to <runsBaseDir>/<correlationId>/worktrees',
        description:
          'Path to the git worktree directory. ' +
          'When blank, derived as <runsBaseDir>/<correlationId>/worktrees.',
      },
      {
        displayName: 'Clone Path',
        name: 'clonePath',
        type: 'string',
        default: '',
        placeholder: 'Optional — defaults to <runsBaseDir>/<correlationId>/clone',
        description:
          'Path to the repo clone directory. ' +
          'When blank, derived as <runsBaseDir>/<correlationId>/clone.',
      },
      {
        displayName: 'Agent Memories Base',
        name: 'memoriesBase',
        type: 'string',
        default: '',
        placeholder: 'Optional — defaults to <runsBaseDir>/<correlationId>/memories',
        description:
          'Base directory for per-run agent memory files. ' +
          'When blank, derived as <runsBaseDir>/<correlationId>/memories.',
      },
      {
        displayName: 'Plans Directory',
        name: 'plansDir',
        type: 'string',
        default: '.software-teams/plans',
        description:
          'Directory containing plan/task artefact files. ' +
          'Only run-scoped artefacts matching the correlationId are removed — never the whole directory.',
      },
    ],
    usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Access GLOBAL static data — same store the Orchestrator writes to.
    const staticData = this.getWorkflowStaticData('global') as IDataObject;

    for (const [i, item] of items.entries()) {
      try {
        // ── Guard: genuine merge check ─────────────────────────────────
        const pullRequest = item.json['pull_request'] as
          | Record<string, unknown>
          | undefined;

        if (pullRequest && pullRequest['merged'] !== true) {
          // Non-merge close event — pass through without teardown.
          returnData.push({
            json: toDataObject({
              skipped: true,
              reason: 'PR was closed without merging — no teardown required.',
            }),
            pairedItem: { item: i },
          });
          continue;
        }

        // ── Recover correlationId ──────────────────────────────────────
        const explicitId = (
          (this.getNodeParameter('correlationId', i, '') as string) || ''
        ).trim();

        let correlationId = explicitId;

        if (!correlationId && pullRequest) {
          const prBody =
            typeof pullRequest['body'] === 'string' ? pullRequest['body'] : '';
          correlationId = parseCorrelationTag(prBody) ?? '';
        }

        if (!correlationId) {
          throw new NodeOperationError(
            this.getNode(),
            'Could not determine correlationId. Provide it as a node parameter ' +
              'or ensure the PR body contains a software-teams correlation tag.',
            { itemIndex: i },
          );
        }

        // ── Resolve paths ──────────────────────────────────────────────
        const runsBaseDir = (
          (this.getNodeParameter('runsBaseDir', i, '') as string) || ''
        ).trim();
        const worktreePathParam = (
          (this.getNodeParameter('worktreePath', i, '') as string) || ''
        ).trim();
        const clonePathParam = (
          (this.getNodeParameter('clonePath', i, '') as string) || ''
        ).trim();
        const memoriesBaseParam = (
          (this.getNodeParameter('memoriesBase', i, '') as string) || ''
        ).trim();
        const plansDir = (
          (this.getNodeParameter('plansDir', i, '.software-teams/plans') as string) ||
          '.software-teams/plans'
        ).trim();

        const clonePath =
          clonePathParam || (runsBaseDir ? `${runsBaseDir}/${correlationId}/clone` : '');
        const worktreePath =
          worktreePathParam ||
          (runsBaseDir ? `${runsBaseDir}/${correlationId}/worktrees` : '');
        const memoriesBase =
          memoriesBaseParam ||
          (runsBaseDir ? `${runsBaseDir}/${correlationId}/memories` : '');

        // ── Teardown steps (each independently guarded) ────────────────
        const report: StepReport[] = [];

        // Step 1: Delete run-state from global static data
        report.push(
          safeStep('deleteRunState', () => {
            const removed = deleteRunState(
              staticData as unknown as Record<string, unknown>,
              correlationId,
            );
            return { removed };
          }),
        );

        // Step 2: Delete conversation state
        report.push(
          safeStep('deleteConversationState', () => {
            deleteState(correlationId);
            // deleteState is void — if it reached here without throwing, it succeeded.
            // It is itself idempotent (no-op when absent).
            return { removed: true, detail: 'conversation state delete executed' };
          }),
        );

        // Step 3: Teardown worktree
        if (worktreePath && clonePath) {
          report.push(
            await safeStepAsync('teardownWorktree', () =>
              teardownWorktree(clonePath, worktreePath),
            ),
          );
        } else {
          report.push({
            step: 'teardownWorktree',
            removed: false,
            detail: 'skipped — no worktree/clone path configured',
          });
        }

        // Step 4: Teardown clone
        if (clonePath && runsBaseDir) {
          report.push(
            safeStep('teardownClone', () =>
              teardownClone(clonePath, runsBaseDir),
            ),
          );
        } else {
          report.push({
            step: 'teardownClone',
            removed: false,
            detail: 'skipped — no clone path or runs base dir configured',
          });
        }

        // Step 5: Teardown agent memories
        if (memoriesBase) {
          report.push(
            safeStep('teardownAgentMemories', () =>
              teardownAgentMemories(correlationId, memoriesBase),
            ),
          );
        } else {
          report.push({
            step: 'teardownAgentMemories',
            removed: false,
            detail: 'skipped — no memories base configured',
          });
        }

        // Step 6: Teardown plan artefacts
        report.push(
          safeStep('teardownPlanArtefacts', () =>
            teardownPlanArtefacts(correlationId, plansDir),
          ),
        );

        // ── Emit summary ───────────────────────────────────────────────
        returnData.push({
          json: toDataObject({
            correlationId,
            cleanedUp: true,
            steps: report,
          }),
          pairedItem: { item: i },
        });
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
          err instanceof Error ? err.message : String(err),
          { itemIndex: i },
        );
      }
    }

    return [returnData];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Execute a synchronous teardown step in a try/catch, returning a StepReport.
 * Never throws — surfaces errors as `detail` with `removed: false`.
 */
function safeStep(
  step: string,
  fn: () => TeardownResult | { removed: boolean; detail?: string },
): StepReport {
  try {
    const result = fn();
    return { step, removed: result.removed, detail: result.detail };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { step, removed: false, detail: `error: ${msg}` };
  }
}

/**
 * Execute an async teardown step in a try/catch, returning a StepReport.
 * Never throws — surfaces errors as `detail` with `removed: false`.
 */
async function safeStepAsync(
  step: string,
  fn: () => Promise<TeardownResult>,
): Promise<StepReport> {
  try {
    const result = await fn();
    return { step, removed: result.removed, detail: result.detail };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { step, removed: false, detail: `error: ${msg}` };
  }
}
