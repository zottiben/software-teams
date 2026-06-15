import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

import type { NodeEnvelope } from '@websitelabs/software-teams';
import { parseCorrelationTag } from '@websitelabs/software-teams';
import {
  PR_FEEDBACK_TASK_ID,
  prCommentsToEnvelope,
} from '../../src/ingestion/pr-feedback';
import type { ReviewComment } from '../../src/ingestion/pr-feedback';
import { toDataObject } from '../../src/n8n-cast';

/**
 * SoftwareTeamsPrFeedback node (plan 1-01 T7, AC2).
 *
 * Fed by an n8n GitHub Trigger / webhook, this node:
 * 1. Reads the PR number + body from the trigger item.
 * 2. Recovers the originating `correlationId` by parsing the machine-parseable
 *    PR-tag out of the body (T3 `parseCorrelationTag`).
 * 3. Fetches + categorises PR review comments headlessly via the `feedback --json`
 *    CLI (reuse, Q2).
 * 4. Maps them with `prCommentsToEnvelope` (T4) into a continue-run `NodeEnvelope`
 *    carrying the original `correlationId` and re-emits it so it re-enters the
 *    Orchestrator continue/merge path.
 *
 * No new contract fields beyond T3's `feedback?`.
 * No Agent-to-Orchestrator return edge (forward-only DAG, ADR invariant).
 */
export class SoftwareTeamsPrFeedback implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams PR Feedback',
    name: 'softwareTeamsPrFeedback',
    icon: 'file:softwareTeamsPrFeedback.svg',
    group: ['transform'],
    version: 1,
    description:
      'Ingests PR review comments from a GitHub webhook, recovers the originating ' +
      'correlationId via the PR-tag, fetches + categorises comments via the ' +
      'feedback CLI, and emits a continue-run envelope to re-enter the ' +
      'Orchestrator loop (AC2).',
    subtitle: '=PR #{{ $parameter["prNumber"] }}',
    defaults: {
      name: 'Software Teams PR Feedback',
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
        displayName: 'PR Number',
        name: 'prNumber',
        type: 'string',
        default: '={{ $json.pull_request.number }}',
        required: true,
        description:
          'The pull request number to fetch review comments for. ' +
          'Defaults to the PR number from a GitHub webhook payload.',
      },
      {
        displayName: 'PR Body',
        name: 'prBody',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '={{ $json.pull_request.body }}',
        required: true,
        description:
          'The pull request body text containing the machine-parseable ' +
          'correlationId tag. Defaults to the PR body from a GitHub webhook payload.',
      },
      {
        displayName: 'Repository',
        name: 'repo',
        type: 'string',
        default: '={{ $json.repository.full_name }}',
        required: true,
        placeholder: 'owner/repo',
        description:
          'GitHub repository in owner/repo format. Injected as GH_REPO into ' +
          'the feedback CLI child process so it runs headlessly without ambient ' +
          'cwd repo detection. Defaults to the repository from a GitHub webhook payload.',
      },
      {
        displayName: 'Continue Agent ID',
        name: 'agentId',
        type: 'string',
        default: 'software-teams-programmer',
        description:
          'The Software Teams specialist that should handle the PR feedback ' +
          '(e.g. software-teams-programmer, software-teams-frontend). ' +
          'Set on the continue-run envelope so the Orchestrator routes to the right agent.',
      },
    ],
    usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Credentials (R-02: NEVER a node param, never on output/log)
    const credentials = await this.getCredentials('softwareTeamsApi');
    const githubToken =
      typeof credentials.githubToken === 'string'
        ? credentials.githubToken.trim()
        : '';

    if (!githubToken) {
      throw new NodeOperationError(
        this.getNode(),
        'No GitHub token found in the Software Teams API credential. ' +
          'Open the credential and set "GitHub Token" to a personal access ' +
          'token with repo read scopes.',
      );
    }

    // n8n per-item + continueOnFail pattern; entries() avoids a let counter.
    for (const [i] of items.entries()) {
      try {
        const prNumber = String(
          this.getNodeParameter('prNumber', i) as string | number,
        ).trim();
        const prBody = (this.getNodeParameter('prBody', i) as string) || '';
        const repo = (this.getNodeParameter('repo', i) as string).trim();
        const agentId =
          ((this.getNodeParameter('agentId', i) as string) || '').trim() ||
          'software-teams-programmer';

        // ── Validate repo format (owner/repo) ──────────────────────────
        if (!repo || !repo.includes('/')) {
          throw new NodeOperationError(
            this.getNode(),
            `"Repository" must be in owner/repo format; received: "${repo}"`,
            { itemIndex: i },
          );
        }

        // ── Validate PR number ─────────────────────────────────────────
        if (!prNumber || prNumber === 'undefined' || prNumber === 'null') {
          throw new NodeOperationError(
            this.getNode(),
            'PR Number is required but was empty or undefined. ' +
              'Wire this node after a GitHub Trigger that provides pull_request.number.',
            { itemIndex: i },
          );
        }

        // ── Recover correlationId from PR body tag ─────────────────────
        const correlationId = parseCorrelationTag(prBody);

        if (!correlationId) {
          // Emit an error envelope so the loop fails loud, not silent (R-06)
          const errorEnvelope: NodeEnvelope = {
            correlationId: `unknown-pr-${prNumber}`,
            agentId,
            status: 'error',
            input: {
              prompt: '',
              context: { taskId: PR_FEEDBACK_TASK_ID },
            },
            result: {
              text:
                `PR #${prNumber} is missing the Software Teams correlation tag ` +
                `(<!-- software-teams:correlationId=... -->). ` +
                'This PR was not opened by the Software Teams Output node, ' +
                'or the tag was removed from the PR body.',
            },
            artifacts: [],
          };

          returnData.push({
            json: toDataObject(errorEnvelope),
            pairedItem: { item: i },
          });
          continue;
        }

        // ── Fetch comments headlessly via `feedback <pr> --json` CLI ───
        const comments = await runFeedbackCli(prNumber, repo, githubToken);

        // ── Build continue-run envelope via T4 mapper ──────────────────
        const envelope = prCommentsToEnvelope(
          { correlationId, agentId },
          comments,
        );

        returnData.push({
          json: toDataObject(envelope),
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
// CLI invocation helper
// ---------------------------------------------------------------------------

/**
 * Invoke `software-teams feedback <prNumber> --json` headlessly via child
 * process with GH_REPO + GH_TOKEN injected via env only (R-02: never as
 * CLI args, output, or log).
 *
 * Uses Node's child_process.spawn (same pattern as single-turn.ts) so it
 * works inside n8n workers (Node, not Bun).
 */
async function runFeedbackCli(
  prNumber: string,
  repo: string,
  githubToken: string,
): Promise<ReviewComment[]> {
  const { spawn } = await import('child_process');
  const { resolve } = await import('node:path');

  // Resolve the software-teams CLI entry point relative to the installed
  // @websitelabs/software-teams package. The n8n package depends on it via
  // workspace:*, so require.resolve finds the bin entry.
  let cliBin: string;
  try {
    // The CLI binary is `software-teams` — resolve it from PATH or
    // from the workspace-linked node_modules/.bin.
    const { execSync } = await import('child_process');
    const which = execSync('which software-teams', { encoding: 'utf8' }).trim();
    cliBin = which || 'software-teams';
  } catch {
    // Fallback: try the workspace .bin path
    cliBin = resolve(
      __dirname,
      '..',
      '..',
      '..',
      'node_modules',
      '.bin',
      'software-teams',
    );
  }

  return new Promise<ReviewComment[]>((resolvePromise, reject) => {
    const proc = spawn(cliBin, ['feedback', prNumber, '--json'], {
      env: {
        ...process.env,
        GH_REPO: repo,
        GH_TOKEN: githubToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `feedback CLI exited with code ${code}. ` +
              (stderr ? `stderr: ${stderr.slice(0, 500)}` : 'No stderr output.'),
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim() || '[]');
        if (!Array.isArray(parsed)) {
          reject(
            new Error(
              'feedback CLI returned non-array JSON: ' +
                stdout.slice(0, 200),
            ),
          );
          return;
        }
        resolvePromise(parsed as ReviewComment[]);
      } catch (parseErr) {
        reject(
          new Error(
            'Failed to parse feedback CLI JSON output: ' +
              (parseErr instanceof Error ? parseErr.message : String(parseErr)) +
              '. stdout: ' +
              stdout.slice(0, 200),
          ),
        );
      }
    });

    proc.on('error', (err) => {
      reject(
        new Error(
          `Failed to spawn feedback CLI: ${err.message}. ` +
            'Ensure @websitelabs/software-teams is installed and the ' +
            '"software-teams" binary is on PATH.',
        ),
      );
    });
  });
}
