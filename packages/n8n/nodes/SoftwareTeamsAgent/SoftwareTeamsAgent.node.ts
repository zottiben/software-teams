import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NodeEnvelope, RepoDescriptor } from '@websitelabs/software-teams';
import {
  readRunState,
  recordAgentResult,
  writeRunState,
} from '../../src/orchestration/run-state';
import { toDataObject, fromDataObject } from '../../src/n8n-cast';
import { cloneRepo, createWorktree, capturePortableChange, removeWorktree } from '../../src/repo/git';
import { validateOwnerRepo, validateBranchName, validateCloneUrl } from '../../src/repo/validate';
import type { RepoContext } from '../../src/repo/repo-context';

type RunAgentTurnFn = (
  input: NodeEnvelope,
  repoContext?: RepoContext,
  githubToken?: string,
) => Promise<NodeEnvelope>;

const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

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

const MODEL_OPTIONS: Array<{ name: string; value: string }> = [
  { name: 'Claude Sonnet 4.5 (Default)', value: 'claude-sonnet-4-5' },
  { name: 'Claude Opus 4', value: 'claude-opus-4-5' },
  { name: 'Claude Haiku 3.5', value: 'claude-haiku-3-5' },
];

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
 * `needs-input`: A downstream Switch node can route on
 * `{{ $json.status === 'needs-input' }}` to feed the Slack HITL flow (T10).
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

    const credentials = await this.getCredentials('softwareTeamsApi');
    process.env['ANTHROPIC_API_KEY'] = credentials.anthropicApiKey as string;
    const githubToken = (credentials.githubToken as string | undefined) || undefined;

    const staticData = this.getWorkflowStaticData('global') as Record<string, unknown>;

    const itemCount = items.length > 0 ? items.length : 1;

    for (const [i] of Array.from({ length: itemCount }).entries()) {
      const specialist = this.getNodeParameter('specialist', i) as string;
      const prompt = this.getNodeParameter('prompt', i) as string;
      const contextRaw = this.getNodeParameter('context', i, '') as string;
      const model = this.getNodeParameter('model', i, 'claude-sonnet-4-5') as string;

      if (model) {
        process.env['ANTHROPIC_DEFAULT_MODEL'] = model;
      }

      const upstream = (items[i]?.json ?? {}) as Record<string, unknown>;

      if (shouldSkipForSpecialist(upstream, specialist)) {
        continue;
      }

      const isUpstreamEnvelope =
        typeof upstream['correlationId'] === 'string' &&
        upstream['correlationId'].length > 0 &&
        typeof upstream['agentId'] === 'string' &&
        typeof upstream['status'] === 'string';

      const envelope: NodeEnvelope = isUpstreamEnvelope
        ? buildHandoffEnvelope(fromDataObject<NodeEnvelope>(items[i]!.json), specialist, prompt)
        : buildFreshEnvelope(specialist, prompt, contextRaw);

      const repoDescriptor = resolveRepoDescriptor(upstream);

      let result: NodeEnvelope;
      try {
        if (repoDescriptor) {
          result = await executeWithWorktree({
            envelope,
            repoDescriptor,
            specialist,
            githubToken,
          });
        } else {
          result = await runAgentTurn(envelope, undefined, githubToken);
        }
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

      persistResultForward(staticData, result);

      returnData.push({
        json: toDataObject(result),
        pairedItem: { item: i },
      });
    }

    return [returnData];
  }
}

/** ADR-004 Decision J — Agent forward-persist: fold the terminal envelope into the GLOBAL run-state (skip if unseeded), in ADDITION to the wire emit. */
function persistResultForward(
  staticData: Record<string, unknown>,
  result: NodeEnvelope,
): void {
  const state = readRunState(staticData, result.correlationId);
  if (state === null) {
    return;
  }
  writeRunState(staticData, result.correlationId, recordAgentResult(state, result));
}

function shouldSkipForSpecialist(
  upstream: Record<string, unknown>,
  specialist: string,
): boolean {
  const upstreamAgentId = upstream['agentId'];
  return typeof upstreamAgentId === 'string' &&
    upstreamAgentId.length > 0 &&
    upstreamAgentId !== specialist;
}

/**
 * Build an A→B handoff envelope (CONTRACT.md §3).
 * Folds upstream result + artifacts into input.context; correlationId is
 * carried unchanged, agentId is rewritten to this node's specialist.
 */
function buildHandoffEnvelope(
  up: NodeEnvelope,
  specialist: string,
  prompt: string,
): NodeEnvelope {
  const upCtx = up.input.context as Record<string, unknown> | null | undefined;
  const taskId = typeof upCtx?.taskId === 'string' ? upCtx.taskId : undefined;
  return {
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
        ...(taskId !== undefined ? { taskId } : {}),
      },
    },
    result: { text: '' },
    artifacts: Array.isArray(up.artifacts) ? [...up.artifacts] : [],
  };
}

/**
 * Build a fresh first-node envelope with a new correlationId.
 * `contextRaw` is parsed as JSON if possible, otherwise treated as a plain string.
 */
function buildFreshEnvelope(
  specialist: string,
  prompt: string,
  contextRaw: string,
): NodeEnvelope {
  const parsedContext: unknown =
    contextRaw && contextRaw.trim()
      ? (() => {
          try {
            return JSON.parse(contextRaw);
          } catch {
            return contextRaw;
          }
        })()
      : null;

  return {
    correlationId: randomUUID(),
    agentId: specialist,
    status: 'ok',
    input: { prompt, context: parsedContext },
    result: { text: '' },
    artifacts: [],
  };
}

function resolveRepoDescriptor(upstream: Record<string, unknown>): RepoDescriptor | undefined {
  const repo = upstream['repo'];
  if (
    repo !== null &&
    typeof repo === 'object' &&
    typeof (repo as Record<string, unknown>)['cloneUrl'] === 'string' &&
    typeof (repo as Record<string, unknown>)['ownerRepo'] === 'string' &&
    typeof (repo as Record<string, unknown>)['baseBranch'] === 'string'
  ) {
    return repo as RepoDescriptor;
  }
  return undefined;
}

async function executeWithWorktree(opts: {
  readonly envelope: NodeEnvelope;
  readonly repoDescriptor: RepoDescriptor;
  readonly specialist: string;
  readonly githubToken: string | undefined;
}): Promise<NodeEnvelope> {
  const { envelope, repoDescriptor, specialist, githubToken } = opts;
  const { cloneUrl, ownerRepo, baseBranch } = repoDescriptor;

  validateOwnerRepo(ownerRepo);
  validateBranchName(baseBranch);
  validateCloneUrl(cloneUrl);

  const correlationId = envelope.correlationId;
  const repoDir = join(tmpdir(), 'st-workspace', correlationId);

  const authenticatedCloneUrl = githubToken && cloneUrl.startsWith('https://')
    ? cloneUrl.replace('https://', `https://x-access-token:${githubToken}@`)
    : cloneUrl;

  await cloneRepo({ cloneUrl: authenticatedCloneUrl, branch: baseBranch, destDir: repoDir }).catch(() => undefined);

  const worktreePath = await createWorktree({
    repoDir,
    agentId: specialist,
    correlationId,
    baseBranch,
  });

  const repoContext: RepoContext = {
    cloneUrl,
    ownerRepo,
    baseBranch,
    correlationId,
    worktreePath,
  };

  try {
    const agentResult = await runAgentTurn(envelope, repoContext, githubToken);
    const changeRef = await capturePortableChange({ worktreePath, baseBranch });
    return changeRef ? { ...agentResult, changeRef } : agentResult;
  } finally {
    await removeWorktree({ repoDir, worktreePath }).catch(() => undefined);
  }
}
