import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import type { NodeEnvelope } from '@websitelabs/software-teams';
import { toDataObject, fromDataObject } from '../../src/n8n-cast';

// n8n tsconfig (module: commonjs) cannot statically resolve single-turn.ts.
type RunAgentTurnFn = (input: NodeEnvelope) => Promise<NodeEnvelope>;
const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

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

/**
 * Slack HITL (human-in-the-loop) state machine node (AC7, T10).
 *
 * ASK MODE (input has `status: 'needs-input'`): posts the agent's question to
 * Slack via Block Kit, persists conversation state, then pauses n8n execution via
 * `putExecutionToWait` (R-05 — survives worker restarts).
 *
 * RESUME MODE (input has `hitlAnswer` + `correlationId`): loads saved state,
 * merges the human answer into context, calls runAgentTurn directly (T3 adapter),
 * emits the continued envelope, and cleans up persisted state.
 *
 * PASS-THROUGH: status 'ok' or 'error' passes unchanged.
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

    // Credentials (R-02: NEVER written to output)
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

    const itemCount = items.length > 0 ? items.length : 1;

    // n8n per-item + continueOnFail pattern; entries() avoids a let counter.
    for (const [i] of Array.from({ length: itemCount }).entries()) {
      try {
        const data = (items[i]?.json ?? {}) as Record<string, unknown>;

        // RESUME MODE — resume webhook payload contains `hitlAnswer` + `correlationId`
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
            json: toDataObject(agentResult),
            pairedItem: { item: i },
          });
          continue;
        }

        // ASK MODE — upstream NodeEnvelope has status 'needs-input'
        const envelope = fromDataObject<NodeEnvelope>(items[i]!.json);

        if (envelope.status !== 'needs-input') {
          returnData.push({ json: toDataObject(data as Record<string, unknown>), pairedItem: { item: i } });
          continue;
        }

        const question = envelope.result.text;
        const correlationId = envelope.correlationId;

        // Security (R-05): WEBHOOK_URL must be set to the public FQDN of this n8n
        // instance so the resume URL is reachable from Slack's servers (not localhost).
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
          json: toDataObject({
            ...envelope,
            hitl: {
              question,
              slackChannel: resolvedChannel,
              slackThreadTs: slackTs,
              resumeUrl,
            },
          }),
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
          );
        }
      }
    }

    return [returnData];
  }
}
