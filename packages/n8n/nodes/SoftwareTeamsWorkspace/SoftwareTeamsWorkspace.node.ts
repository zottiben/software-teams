import {
  ApplicationError,
  IDataObject,
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
import { toDataObject, fromDataObject } from '../../src/n8n-cast';
import { cloneRepo } from '../../src/repo/git';
import { validateOwnerRepo, validateBranchName, validateCloneUrl } from '../../src/repo/validate';

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function isOwnerRepo(value: string): boolean {
  return OWNER_REPO_RE.test(value);
}

function resolveRepoCoords(targetRepo: string): { cloneUrl: string; ownerRepo: string } {
  if (isOwnerRepo(targetRepo)) {
    const validOwnerRepo = validateOwnerRepo(targetRepo);
    return {
      cloneUrl: `https://github.com/${validOwnerRepo}.git`,
      ownerRepo: validOwnerRepo,
    };
  }
  const validCloneUrl = validateCloneUrl(targetRepo);
  const sshMatch = validCloneUrl.match(/^git@[^:]+:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(\.git)?$/);
  const httpsMatch = validCloneUrl.match(/https:\/\/[^/]+\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(\.git)?$/);
  const ownerRepo = (sshMatch?.[1] ?? httpsMatch?.[1]) ?? '';
  if (!ownerRepo) {
    throw new ApplicationError(
      `Cannot derive owner/repo from clone URL "${validCloneUrl}". ` +
        'Provide the target as "owner/repo" instead.',
    );
  }
  return { cloneUrl: validCloneUrl, ownerRepo };
}

/**
 * SoftwareTeamsWorkspace node (ADR-002 Decision G, AC1).
 *
 * Establishes the run's git checkout and seeds the non-secret repo coordinates
 * (RepoDescriptor) onto the outbound NodeEnvelope as the additive optional `repo`
 * field. Downstream Agent nodes read `envelope.repo` to construct a local
 * RepoContext and createWorktree for their turn (R-15, R-18).
 *
 * Token injection: the GITHUB_TOKEN from SoftwareTeamsApi credentials is injected
 * into the clone URL for private repos; it is never echoed to the envelope (R-02).
 *
 * Fail-fast: git binary absence and invalid repo/branch inputs fail immediately
 * with a clear actionable message before any git work is attempted (R-01).
 */
export class SoftwareTeamsWorkspace implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Workspace',
    name: 'softwareTeamsWorkspace',
    icon: 'file:softwareTeamsWorkspace.svg',
    group: ['transform'],
    version: 1,
    description:
      'Clone a target repository and seed repo coordinates onto the envelope. ' +
      'Place this node before Agent nodes to enable repo-scoped execution.',
    subtitle: '={{ $parameter["targetRepo"] }}',
    defaults: { name: 'Software Teams Workspace' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      { name: 'softwareTeamsApi', required: true },
    ],
    properties: [
      {
        displayName: 'Target Repository',
        name: 'targetRepo',
        type: 'string',
        default: '',
        required: true,
        description:
          'The repository to check out. Accepts "owner/repo" (GitHub shorthand) or a full ' +
          'https:// / git@ clone URL. Must not contain shell characters (R-08).',
        placeholder: 'owner/repo or https://github.com/owner/repo.git',
      },
      {
        displayName: 'Base Branch',
        name: 'baseBranch',
        type: 'string',
        default: 'main',
        required: true,
        description:
          'The branch to clone and fork agent worktrees from. Must be a valid git ref name.',
      },
      {
        displayName: 'Correlation ID',
        name: 'correlationId',
        type: 'string',
        default: '',
        description:
          'Stable run id carried unchanged onto every emitted envelope. Leave blank to ' +
          "generate one, or reuse an upstream envelope's correlationId to continue a run.",
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

    const itemCount = items.length > 0 ? items.length : 1;

    for (const [i] of Array.from({ length: itemCount }).entries()) {
      const targetRepo = this.getNodeParameter('targetRepo', i) as string;
      const baseBranch = this.getNodeParameter('baseBranch', i, 'main') as string;
      const correlationIdParam = (
        this.getNodeParameter('correlationId', i, '') as string
      ).trim();

      const upstream = (items[i]?.json ?? {}) as Record<string, unknown>;
      const upstreamCorrelationId =
        typeof upstream['correlationId'] === 'string' && upstream['correlationId'].length > 0
          ? upstream['correlationId']
          : undefined;

      const correlationId = correlationIdParam || upstreamCorrelationId || randomUUID();

      try {
        validateBranchName(baseBranch);

        const { cloneUrl, ownerRepo } = resolveRepoCoords(targetRepo.trim());

        const repoDir = join(tmpdir(), 'st-workspace', correlationId);

        const authenticatedCloneUrl = buildAuthenticatedUrl(cloneUrl, githubToken);

        await cloneRepo({ cloneUrl: authenticatedCloneUrl, branch: baseBranch, destDir: repoDir });

        const repoDescriptor: RepoDescriptor = { cloneUrl, ownerRepo, baseBranch };

        const outEnvelope: NodeEnvelope = buildOutEnvelope(
          upstream,
          correlationId,
          repoDescriptor,
        );

        returnData.push({
          json: toDataObject(outEnvelope),
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
          `Software Teams Workspace failed: ${err instanceof Error ? err.message : String(err)}`,
          { itemIndex: i },
        );
      }
    }

    return [returnData];
  }
}

function buildAuthenticatedUrl(cloneUrl: string, githubToken: string | undefined): string {
  if (!githubToken) return cloneUrl;
  if (!cloneUrl.startsWith('https://')) return cloneUrl;
  return cloneUrl.replace('https://', `https://x-access-token:${githubToken}@`);
}

function buildOutEnvelope(
  upstream: Record<string, unknown>,
  correlationId: string,
  repo: RepoDescriptor,
): NodeEnvelope {
  const isUpstreamEnvelope =
    typeof upstream['correlationId'] === 'string' &&
    upstream['correlationId'].length > 0 &&
    typeof upstream['agentId'] === 'string' &&
    typeof upstream['status'] === 'string';

  if (isUpstreamEnvelope) {
    const up = fromDataObject<NodeEnvelope>(upstream as IDataObject);
    return {
      correlationId,
      agentId: up.agentId,
      status: up.status,
      input: up.input,
      result: up.result,
      artifacts: Array.isArray(up.artifacts) ? [...up.artifacts] : [],
      repo,
    };
  }

  return {
    correlationId,
    agentId: 'software-teams-workspace',
    status: 'ok',
    input: { prompt: '', context: null },
    result: { text: '' },
    artifacts: [],
    repo,
  };
}
