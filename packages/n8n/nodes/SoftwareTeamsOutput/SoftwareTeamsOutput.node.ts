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
      // ── Output mode ────────────────────────────────────────────────────────
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

      // ── Target repository ──────────────────────────────────────────────────
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

      // ── Base branch (PR only) ──────────────────────────────────────────────
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

      // ── Title (optional) ──────────────────────────────────────────────────
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

      // ── Issue labels (issue mode only) ────────────────────────────────────
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

    // ── Credentials — GitHub token (R-02: never a node param) ─────────────
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

    // ── Per-item execution ─────────────────────────────────────────────────
    for (let i = 0; i < items.length; i++) {
      try {
      const envelope = items[i].json as unknown as NodeEnvelope;

      // Validate envelope shape (guard against mis-wired nodes)
      if (!envelope || typeof envelope.correlationId !== 'string') {
        throw new NodeOperationError(
          this.getNode(),
          'Incoming item is not a valid NodeEnvelope (missing correlationId). ' +
            'Wire this node after a Software Teams Agent or Orchestrator node.',
          { itemIndex: i },
        );
      }

      // ── Node parameters ──────────────────────────────────────────────────
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

      let outputUrl: string;
      let outputType: 'pr' | 'issue';

      if (mode === 'pr') {
        // ── PR mode ─────────────────────────────────────────────────────────
        // Look for a branch artifact from an upstream agent node.
        const branchArtifact = envelope.artifacts.find((a) => a.type === 'branch');
        const headBranch = extractBranchName(branchArtifact?.url);

        if (!headBranch) {
          // No branch — fall back to an issue with a note (rather than hard error)
          const fallbackBody =
            `> **⚠ Fallback:** PR mode was selected but no \`branch\` artifact was ` +
            `found in the envelope. An issue has been opened instead.\n\n` +
            body;

          const ref = await createIssue({
            owner,
            repo,
            title,
            body: fallbackBody,
            token: githubToken,
          });
          outputUrl = ref.url;
          outputType = 'issue';
        } else {
          try {
            const ref = await createPullRequest({
              owner,
              repo,
              title,
              body,
              head: headBranch,
              base: baseBranch,
              token: githubToken,
            });
            outputUrl = ref.url;
            outputType = 'pr';
          } catch (err) {
            // PR creation failed (no diff, existing PR, scope error, etc.)
            // Emit an error-status envelope rather than throwing, so the
            // canvas error branch / orchestrator (R-05) can handle it.
            const errMsg =
              err instanceof Error ? err.message : String(err);
            const errorEnvelope: NodeEnvelope = {
              ...envelope,
              status: 'error',
              result: { text: `GitHub PR creation failed: ${errMsg}` },
            };
            returnData.push({
              json: errorEnvelope as unknown as IDataObject,
              pairedItem: { item: i },
            });
            continue;
          }
        }
      } else {
        // ── Issue mode ───────────────────────────────────────────────────────
        const labels = issueLabelsParam
          ? issueLabelsParam.split(',').map((l) => l.trim()).filter(Boolean)
          : [];

        const ref = await createIssue({
          owner,
          repo,
          title,
          body,
          labels,
          token: githubToken,
        });
        outputUrl = ref.url;
        outputType = 'issue';
      }

      // ── Append artifact — CONTRACT.md §2: artifacts accrete ──────────────
      const updatedEnvelope: NodeEnvelope = {
        ...envelope,
        artifacts: [
          ...envelope.artifacts,
          { type: outputType, url: outputUrl },
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

/**
 * Build a Markdown body for the PR or issue from the NodeEnvelope.
 * Includes the agent result text, correlation ID, agent identity, and any
 * upstream artifacts for traceability.
 */
function buildPrIssueBody(envelope: NodeEnvelope): string {
  const lines: string[] = [];

  lines.push('## Software Teams result');
  lines.push('');
  lines.push(`**Agent:** \`${envelope.agentId}\``);
  lines.push(`**Correlation ID:** \`${envelope.correlationId}\``);
  lines.push(`**Status:** ${envelope.status}`);
  lines.push('');

  if (envelope.result.text) {
    lines.push('### Result');
    lines.push('');
    lines.push(envelope.result.text);
    lines.push('');
  }

  const priorArtifacts = envelope.artifacts.filter((a) => a.type !== 'pr' && a.type !== 'issue');
  if (priorArtifacts.length > 0) {
    lines.push('### Artifacts');
    lines.push('');
    for (const a of priorArtifacts) {
      const link = a.url ? `[${a.url}](${a.url})` : '(no URL)';
      lines.push(`- **${a.type}**: ${link}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    '*Generated by [@websitelabs/n8n-nodes-software-teams]' +
      '(https://github.com/websitelabs/software-teams/tree/main/n8n)*',
  );

  return lines.join('\n');
}
