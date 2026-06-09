/**
 * SoftwareTeamsOutput — terminal output node for Software Teams workflows (T7, AC6).
 *
 * Reads a NodeEnvelope from the upstream node's output, creates a GitHub PR
 * (default) or issue against the configured target repository, then appends
 * the created URL to the envelope's `artifacts` array before passing it
 * downstream.
 *
 * Token source:  `softwareTeamsApi` credential → `githubToken` field.
 *                NEVER a node parameter (R-02).
 *
 * No-changes / error cases:
 *  - PR mode but no branch artifact in envelope → falls back to an issue
 *    (body includes a note explaining the fallback).
 *  - GitHub API rejects the PR (e.g. no diff, existing open PR, scope error) →
 *    sets `status: 'error'` on the envelope and passes it downstream so the
 *    canvas can route to an error handler.
 *
 * Reuse (T7 contract):
 *  - `createPullRequest` / `createIssue` / `extractBranchName` — net-new
 *    helpers in n8n/src/output/github.ts (no create-PR/issue existed in
 *    src/utils/github.ts; GHA runner forbids `gh pr create` in its path).
 *  - NodeEnvelope type — n8n/src/contract/envelope.ts (T3).
 *  - `slugify` — inlined in n8n/src/output/github.ts (pure, Bun-free copy of
 *    the function in src/utils/git.ts).
 */

import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

import type { NodeEnvelope } from '@websitelabs/software-teams';
import {
  createPullRequest,
  createIssue,
  extractBranchName,
} from '../../src/output/github';

export class SoftwareTeamsOutput implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Output',
    name: 'softwareTeamsOutput',
    icon: 'file:SoftwareTeamsOutput.svg',
    group: ['output'],
    version: 1,
    description:
      'Terminal node for Software Teams workflows (AC6). ' +
      'Reads the NodeEnvelope from upstream and creates a GitHub PR (default) ' +
      'or issue with the agents\' result against the target repository.',
    subtitle: '={{ $parameter["mode"] === "pr" ? "Pull Request" : "Issue" }}',
    defaults: {
      name: 'Software Teams Output',
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
        displayName: 'Output Mode',
        name: 'mode',
        type: 'options',
        options: [
          {
            name: 'Issue',
            value: 'issue',
            description: 'Open a GitHub issue with the agents\' result as the body',
          },
          {
            name: 'Pull Request (Default)',
            value: 'pr',
            description:
              'Open a GitHub PR against the target branch. ' +
              'Requires a branch artifact in the upstream envelope. ' +
              'Falls back to an issue if no branch artifact is present.',
          },
        ],
        default: 'pr',
        noDataExpression: true,
        description: 'Whether to create a GitHub PR or an issue as the workflow output',
      },
      {
        displayName: 'Target Repository',
        name: 'targetRepo',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'owner/repo',
        description:
          'GitHub repository in owner/repo format (e.g. acme/myapp). ' +
          'The GitHub token must have repo + PR write scopes for this repository.',
      },
      {
        displayName: 'Base Branch',
        name: 'baseBranch',
        type: 'string',
        default: 'main',
        displayOptions: {
          show: {
            mode: ['pr'],
          },
        },
        description: 'The target branch the pull request will merge into',
      },
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        default: '',
        placeholder: 'Leave blank to use the correlation ID',
        description:
          'Title for the PR or issue. ' +
          'Defaults to "[Software Teams] {correlationId}" when blank.',
      },
      {
        displayName: 'Issue Labels',
        name: 'issueLabels',
        type: 'string',
        default: '',
        placeholder: 'bug, enhancement',
        displayOptions: {
          show: {
            mode: ['issue'],
          },
        },
        description:
          'Comma-separated labels to apply to the issue (optional). ' +
          'Labels must already exist in the repository.',
      },
    ],
		usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // ── Credentials (R-02: NEVER a node param) ────────────────────────────
    const credentials = await this.getCredentials('softwareTeamsApi');
    const githubToken = typeof credentials.githubToken === 'string'
      ? credentials.githubToken.trim()
      : '';

    if (!githubToken) {
      throw new NodeOperationError(
        this.getNode(),
        'No GitHub token found in the Software Teams API credential. ' +
          'Open the credential and set "GitHub Token" to a personal access ' +
          'token with repo + PR write scopes.',
      );
    }

    for (let i = 0; i < items.length; i++) {
      try {
      const envelope = items[i].json as unknown as NodeEnvelope;

      if (!envelope || typeof envelope.correlationId !== 'string') {
        throw new NodeOperationError(
          this.getNode(),
          'Incoming item is not a valid NodeEnvelope (missing correlationId). ' +
            'Wire this node after a Software Teams Agent or Orchestrator node.',
          { itemIndex: i },
        );
      }

      const mode = this.getNodeParameter('mode', i) as string;
      const rawRepo = (this.getNodeParameter('targetRepo', i) as string).trim();
      const baseBranch =
        ((this.getNodeParameter('baseBranch', i, 'main') as string) || 'main').trim();
      const titleParam = ((this.getNodeParameter('title', i, '') as string) || '').trim();
      const issueLabelsParam =
        ((this.getNodeParameter('issueLabels', i, '') as string) || '').trim();

      if (!rawRepo || !rawRepo.includes('/')) {
        throw new NodeOperationError(
          this.getNode(),
          `"Target Repository" must be in owner/repo format; received: "${rawRepo}"`,
          { itemIndex: i },
        );
      }

      const slashIdx = rawRepo.indexOf('/');
      const owner = rawRepo.slice(0, slashIdx);
      const repo = rawRepo.slice(slashIdx + 1);
      const title = titleParam || `[Software Teams] ${envelope.correlationId}`;
      const body = buildPrIssueBody(envelope);

      const outputRef = await resolveOutputRef({
        mode,
        envelope,
        owner,
        repo,
        title,
        body,
        baseBranch,
        issueLabelsParam,
        githubToken,
      });

      if (outputRef.errorEnvelope) {
        returnData.push({
          json: outputRef.errorEnvelope as unknown as IDataObject,
          pairedItem: { item: i },
        });
        continue;
      }

      // Append artifact — CONTRACT.md §2: artifacts accrete.
      const updatedEnvelope: NodeEnvelope = {
        ...envelope,
        artifacts: [
          ...envelope.artifacts,
          { type: outputRef.outputType, url: outputRef.outputUrl },
        ],
      };

      returnData.push({
        json: updatedEnvelope as unknown as IDataObject,
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface OutputRefResult {
  outputUrl: string;
  outputType: 'pr' | 'issue';
  errorEnvelope?: NodeEnvelope;
}

interface ResolveOutputRefParams {
  mode: string;
  envelope: NodeEnvelope;
  owner: string;
  repo: string;
  title: string;
  body: string;
  baseBranch: string;
  issueLabelsParam: string;
  githubToken: string;
}

/**
 * Resolve the GitHub output reference (PR or issue) for the given envelope.
 * Returns an error envelope when PR creation fails so the caller can surface it
 * via the canvas error branch (R-05) rather than throwing.
 */
async function resolveOutputRef(p: ResolveOutputRefParams): Promise<OutputRefResult> {
  if (p.mode === 'pr') {
    const branchArtifact = p.envelope.artifacts.find((a) => a.type === 'branch');
    const headBranch = extractBranchName(branchArtifact?.url);

    if (!headBranch) {
      const fallbackBody =
        `> **⚠ Fallback:** PR mode was selected but no \`branch\` artifact was ` +
        `found in the envelope. An issue has been opened instead.\n\n` +
        p.body;

      const ref = await createIssue({
        owner: p.owner,
        repo: p.repo,
        title: p.title,
        body: fallbackBody,
        token: p.githubToken,
      });
      return { outputUrl: ref.url, outputType: 'issue' };
    }

    try {
      const ref = await createPullRequest({
        owner: p.owner,
        repo: p.repo,
        title: p.title,
        body: p.body,
        head: headBranch,
        base: p.baseBranch,
        token: p.githubToken,
      });
      return { outputUrl: ref.url, outputType: 'pr' };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        outputUrl: '',
        outputType: 'pr',
        errorEnvelope: {
          ...p.envelope,
          status: 'error',
          result: { text: `GitHub PR creation failed: ${errMsg}` },
        },
      };
    }
  }

  const labels = p.issueLabelsParam
    ? p.issueLabelsParam.split(',').map((l) => l.trim()).filter(Boolean)
    : [];

  const ref = await createIssue({
    owner: p.owner,
    repo: p.repo,
    title: p.title,
    body: p.body,
    labels,
    token: p.githubToken,
  });
  return { outputUrl: ref.url, outputType: 'issue' };
}

/**
 * Build a Markdown body for the PR or issue from the NodeEnvelope.
 * Includes agent result text, correlation ID, agent identity, and upstream artifacts.
 */
function buildPrIssueBody(envelope: NodeEnvelope): string {
  const priorArtifacts = envelope.artifacts.filter((a) => a.type !== 'pr' && a.type !== 'issue');
  const artifactLines = priorArtifacts.length > 0
    ? [
        '### Artifacts',
        '',
        ...priorArtifacts.map((a) => {
          const link = a.url ? `[${a.url}](${a.url})` : '(no URL)';
          return `- **${a.type}**: ${link}`;
        }),
        '',
      ]
    : [];

  const resultLines = envelope.result.text
    ? ['### Result', '', envelope.result.text, '']
    : [];

  return [
    '## Software Teams result',
    '',
    `**Agent:** \`${envelope.agentId}\``,
    `**Correlation ID:** \`${envelope.correlationId}\``,
    `**Status:** ${envelope.status}`,
    '',
    ...resultLines,
    ...artifactLines,
    '---',
    '*Generated by [@websitelabs/n8n-nodes-software-teams]' +
      '(https://github.com/websitelabs/software-teams/tree/main/n8n)*',
  ].join('\n');
}
