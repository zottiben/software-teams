/**
 * SoftwareTeamsSlackHitl — Slack ask→wait→resume HITL state machine (T10).
 *
 * Implements AC7: when an upstream node emits `status: 'needs-input'`, this
 * node posts the agent's question to Slack (Block Kit, threaded, carries the
 * correlationId), pauses the n8n workflow via the Wait mechanism
 * (n8n serialises execution to its DB — survives worker restarts, R-05), and
 * on resume calls `runAgentTurn` (T3 adapter) directly with the human's answer
 * merged into context, emitting the continued NodeEnvelope.
 *
 * ── Two execution modes ──────────────────────────────────────────────────────
 *
 * ASK MODE  (input.json has `status: 'needs-input'`):
 *   1. Gets the signed resume URL from n8n (`this.getSignedResumeUrl()`).
 *   2. Posts the question to Slack (Block Kit with correlationId in button).
 *   3. Persists conversation state to disk keyed by correlationId (R-05).
 *   4. Calls `this.putExecutionToWait(timeout)` — n8n freezes execution to DB.
 *   5. Emits a waiting envelope augmented with an `hitl` state block.
 *
 * RESUME MODE  (input.json has `hitlAnswer` + `correlationId` fields):
 *   The Slack interactivity handler POSTs this payload to the resume URL.
 *   When n8n resumes the execution the HITL node is re-entered with this
 *   webhook data as its input.
 *   1. Loads stored conversation state by correlationId.
 *   2. Posts a threaded Slack reply acknowledging receipt.
 *   3. Merges the human answer into `input.context` (hitl sub-object).
 *   4. Calls `runAgentTurn` (T3) directly — NO T5 Agent node, no re-spawn.
 *   5. Emits the continued NodeEnvelope (agent picks up where it left off).
 *   6. Deletes the persisted state (clean-up).
 *
 * PASS-THROUGH  (status is 'ok' or 'error'):
 *   Passes the input envelope unchanged.
 *
 * ── Credential note (R-02) ───────────────────────────────────────────────────
 * Reads `slackBotToken` from the `softwareTeamsApi` credential type only.
 * Tokens are never written to node output, logs, or the envelope.
 *
 * ── Self-hosted constraint (AC9) ─────────────────────────────────────────────
 * Set `WEBHOOK_URL=https://n8n.yourdomain.com` so that `getSignedResumeUrl()`
 * returns a fully-qualified URL reachable from Slack's servers, not localhost.
 * See `.software-teams/research/slack-wait-resume.md` §Q5 for details.
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

// ---------------------------------------------------------------------------
// runAgentTurn — lazy require. single-turn.ts uses Bun-specific APIs that
// cannot be statically imported under the n8n tsconfig (see SoftwareTeamsAgent).
// ---------------------------------------------------------------------------
type RunAgentTurnFn = (input: NodeEnvelope) => Promise<NodeEnvelope>;
const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

// ---------------------------------------------------------------------------
// conversation-state helpers — lazy require; keeps node Bun-free, consistent
// with the single-turn pattern.
// ---------------------------------------------------------------------------
interface ConversationState {
  correlationId: string;
  originalEnvelope: NodeEnvelope;
  slackChannel: string;
  slackThreadTs: string;
  resumeUrl: string;
  question: string;
  createdAt: number;
}
const CONV_STATE_MODULE: string = '../../src/hitl/conversation-state';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const convState = require(CONV_STATE_MODULE) as {
  saveState: (state: ConversationState) => void;
  loadState: (correlationId: string) => ConversationState | null;
  deleteState: (correlationId: string) => void;
};

// ---------------------------------------------------------------------------
// Slack helpers — lazy require; consistent with the single-turn/conv-state pattern.
// ---------------------------------------------------------------------------
interface PostQuestionResult {
  ts: string;
  channel: string;
}
const SLACK_MODULE: string = '../../src/hitl/slack';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const slackHelpers = require(SLACK_MODULE) as {
  postQuestion: (
    token: string,
    channel: string,
    question: string,
    correlationId: string,
    resumeUrl: string,
  ) => Promise<PostQuestionResult>;
  postThreadReply: (
    token: string,
    channel: string,
    threadTs: string,
    message: string,
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// SoftwareTeamsSlackHitl node
// ---------------------------------------------------------------------------

/**
 * Slack HITL (human-in-the-loop) state machine node.
 * See module-level JSDoc above for the full design.
 */
export class SoftwareTeamsSlackHitl implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams Slack HITL',
    name: 'softwareTeamsSlackHitl',
    icon: 'file:softwareTeamsSlackHitl.svg',
    group: ['transform'],
    version: 1,
    description:
      'Slack human-in-the-loop state machine (AC7). ' +
      'When an upstream agent returns needs-input, posts the question to Slack, ' +
      'pauses the workflow, and resumes the same agent with the human\'s reply. ' +
      'Conversation state survives restarts (R-05).',
    subtitle: '={{ $parameter["slackChannel"] }}',
    defaults: { name: 'Software Teams Slack HITL' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'softwareTeamsApi', required: true }],
    properties: [
      {
        displayName: 'Slack Channel',
        name: 'slackChannel',
        type: 'string',
        default: '',
        required: true,
        description:
          'Slack channel ID (e.g. C0123456) or name (e.g. #ai-questions) where ' +
          'the agent question will be posted. The workflow pauses until a human ' +
          'replies via the Slack interactivity handler.',
      },
      {
        displayName: 'Wait Timeout (Hours)',
        name: 'waitTimeoutHours',
        type: 'number',
        default: 24,
        description:
          'Maximum hours to wait for a Slack reply before execution times out. ' +
          'Set WEBHOOK_URL env var to the n8n public FQDN so the resume URL is ' +
          'reachable from Slack\'s servers (see T2 research doc §Q5).',
      },
    ],
		usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // ── Credentials (R-02: NEVER written to output) ──────────────────────────
    const credentials = await this.getCredentials('softwareTeamsApi');
    const slackToken = credentials['slackBotToken'] as string | undefined;
    const slackChannel = this.getNodeParameter('slackChannel', 0, '') as string;
    const waitTimeoutHours = this.getNodeParameter('waitTimeoutHours', 0, 24) as number;

    if (!slackToken) {
      throw new NodeOperationError(
        this.getNode(),
        'Slack Bot Token is not set. Add a Slack Bot OAuth token (xoxb-…) to ' +
          'the SoftwareTeamsApi credential under "Slack Bot Token".',
      );
    }

    // Use at least one iteration even when upstream sends zero items.
    const itemCount = items.length > 0 ? items.length : 1;

    for (let i = 0; i < itemCount; i++) {
      try {
      const data = (items[i]?.json ?? {}) as Record<string, unknown>;

      // ── RESUME MODE — resume webhook payload contains `hitlAnswer` + `correlationId`
      // (set by the Slack interactivity handler that POSTs to the n8n resume URL).
      if (
        typeof data['hitlAnswer'] === 'string' &&
        typeof data['correlationId'] === 'string'
      ) {
        const hitlAnswer = data['hitlAnswer'] as string;
        const correlationId = data['correlationId'] as string;

        const state = convState.loadState(correlationId);
        if (!state) {
          throw new NodeOperationError(
            this.getNode(),
            `HITL resume: no conversation state found for correlationId "${correlationId}". ` +
              'Ensure the HITL state file (HITL_STATE_PATH) is on persistent storage ' +
              'shared between the ask and resume execution contexts.',
            { itemIndex: i },
          );
        }

        // Non-fatal Slack acknowledgement — ack failure must not block agent resume.
        try {
          await slackHelpers.postThreadReply(
            slackToken,
            state.slackChannel,
            state.slackThreadTs,
            `✅ Reply received: _"${hitlAnswer}"_ — resuming agent...`,
          );
        } catch {
          // intentionally swallowed
        }

        const originalContext = state.originalEnvelope.input.context;
        const mergedContext: Record<string, unknown> = {
          ...(typeof originalContext === 'object' &&
          originalContext !== null &&
          !Array.isArray(originalContext)
            ? (originalContext as Record<string, unknown>)
            : { originalContext }),
          hitl: {
            question: state.question,
            answer: hitlAnswer,
          },
        };

        const resumeEnvelope: NodeEnvelope = {
          ...state.originalEnvelope,
          status: 'ok',
          input: {
            prompt: state.originalEnvelope.input.prompt,
            context: mergedContext,
          },
          result: { text: '' },
        };

        // Re-invoke runAgentTurn directly (T3 adapter, Task tool disabled — AC2).
        const agentResult = await runAgentTurn(resumeEnvelope).catch((err: unknown) => {
          throw new NodeOperationError(
            this.getNode(),
            `HITL resume: runAgentTurn failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            { itemIndex: i },
          );
        });

        // Clean up persisted state after successful resume (idempotent, non-fatal).
        try {
          convState.deleteState(correlationId);
        } catch {
          // stale state is benign
        }

        returnData.push({
          json: agentResult as unknown as IDataObject,
          pairedItem: { item: i },
        });
        continue;
      }

      // ── ASK MODE — upstream NodeEnvelope has status 'needs-input' ───────────
      const envelope = data as unknown as NodeEnvelope;

      if (envelope.status !== 'needs-input') {
        // PASS-THROUGH for 'ok' / 'error' envelopes.
        returnData.push({ json: data as IDataObject, pairedItem: { item: i } });
        continue;
      }

      const question = envelope.result.text;
      const correlationId = envelope.correlationId;

      // IMPORTANT: WEBHOOK_URL env var must be set to the public FQDN of this n8n
      // instance so the URL is reachable from Slack's servers (not localhost:5678).
      const resumeUrl = this.getSignedResumeUrl();

      const { ts: slackTs, channel: resolvedChannel } = await slackHelpers
        .postQuestion(slackToken, slackChannel, question, correlationId, resumeUrl)
        .catch((err: unknown) => {
          throw new NodeOperationError(
            this.getNode(),
            `Failed to post agent question to Slack: ${
              err instanceof Error ? err.message : String(err)
            }`,
            { itemIndex: i },
          );
        });

      // Persist conversation state to disk (survives worker restarts — R-05).
      convState.saveState({
        correlationId,
        originalEnvelope: envelope,
        slackChannel: resolvedChannel,
        slackThreadTs: slackTs,
        resumeUrl,
        question,
        createdAt: Date.now(),
      });

      const waitTill = new Date(Date.now() + waitTimeoutHours * 60 * 60 * 1000);
      await this.putExecutionToWait(waitTill);

      returnData.push({
        json: {
          ...envelope,
          hitl: {
            question,
            slackChannel: resolvedChannel,
            slackThreadTs: slackTs,
            resumeUrl,
          },
        } as unknown as IDataObject,
        pairedItem: { item: i },
      });
      } catch (err) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: err instanceof Error ? err.message : String(err) },
            pairedItem: { item: i },
          });
        } else {
          throw new NodeOperationError(
            this.getNode(),
            err instanceof Error ? err.message : String(err),
            { itemIndex: i },
          );
        }
      }
    }

    return [returnData];
  }
}
