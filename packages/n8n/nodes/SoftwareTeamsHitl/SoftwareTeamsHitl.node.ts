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

// n8n tsconfig (module: commonjs) cannot statically resolve ESM modules.
type RunAgentTurnFn = (input: NodeEnvelope) => Promise<NodeEnvelope>;
const SINGLE_TURN_MODULE: string = '../../src/execution/single-turn';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentTurn } = require(SINGLE_TURN_MODULE) as {
  runAgentTurn: RunAgentTurnFn;
};

// Conversation-state store (T2) — reuses correlationId-keyed JSON file.
const CONV_STATE_MODULE: string = '../../src/hitl/conversation-state';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const convState = require(CONV_STATE_MODULE) as {
  saveState: (state: import('../../src/hitl/conversation-state').ConversationState) => void;
  loadState: (
    correlationId: string,
  ) => import('../../src/hitl/conversation-state').ConversationState | null;
  deleteState: (correlationId: string) => void;
  nextRound: (state: import('../../src/hitl/conversation-state').ConversationState) => number;
};

// Channel adapters (T8)
const CHANNELS_MODULE: string = '../../src/hitl/channels';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const channelsModule = require(CHANNELS_MODULE) as {
  getChannel: typeof import('../../src/hitl/channels').getChannel;
};

type ChannelName = 'slack' | 'email' | 'notify' | 'discord' | 'auto';

/**
 * Generic, channel-agnostic HITL node (T8 — AC3, AC4).
 *
 * Supports Slack, Email, n8n-notification, AND Discord. Multi-round: on
 * resume, if the agent still needs input, re-parks with an incremented
 * round instead of deleting state. State is only deleted once the agent
 * returns ok/error.
 *
 * ASK MODE (status: 'needs-input'): posts the question via the selected
 * channel adapter, saves state with channel + round + delivery ref, then
 * putExecutionToWait.
 *
 * RESUME MODE (hitlAnswer + correlationId): loads state, acks via the
 * channel adapter, merges answer into context, runs runAgentTurn. If the
 * agent returns needs-input again, re-saves state with incremented round
 * and re-waits (genuine multi-round). Only deletes state on ok/error.
 *
 * PASS-THROUGH: status 'ok' or 'error' passes unchanged.
 */
export class SoftwareTeamsHitl implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Software Teams HITL',
    name: 'softwareTeamsHitl',
    icon: 'file:softwareTeamsHitl.svg',
    group: ['transform'],
    version: 1,
    description:
      'Channel-agnostic human-in-the-loop node (AC3/AC4). ' +
      'Supports Slack, Email, n8n-notification, and Discord with genuine ' +
      'multi-round back-and-forth. When an upstream agent returns needs-input, ' +
      'posts the question via the selected channel, pauses the workflow, and ' +
      'resumes the same agent with the human\'s reply. Re-parks for additional ' +
      'rounds until the agent returns ok or error.',
    subtitle: '={{ $parameter["channel"] }} / {{ $parameter["destination"] }}',
    defaults: { name: 'Software Teams HITL' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'softwareTeamsApi', required: true }],
    properties: [
      {
        displayName: 'Channel',
        name: 'channel',
        type: 'options',
        options: [
          { name: 'Auto (Envelope Hint)', value: 'auto' },
          { name: 'Discord', value: 'discord' },
          { name: 'Email', value: 'email' },
          { name: 'N8n Notification', value: 'notify' },
          { name: 'Slack', value: 'slack' },
        ],
        default: 'auto',
        description:
          'Which channel to use for delivering questions to the human. ' +
          '"Auto" reads the optional hitlChannel hint from the upstream envelope ' +
          '(defaults to discord if no hint is present). The node\'s explicit selection ' +
          'always wins over the envelope hint.',
      },
      {
        displayName: 'Destination',
        name: 'destination',
        type: 'string',
        default: '',
        required: true,
        description:
          'Channel-specific destination: Slack channel ID (e.g. C0123456), ' +
          'Discord channel ID (e.g. 1234567890), email address, or n8n notification ' +
          'target identifier.',
      },
      {
        displayName: 'Wait Timeout (Hours)',
        name: 'waitTimeoutHours',
        type: 'number',
        default: 24,
        description:
          'Maximum hours to wait for a human reply before execution times out. ' +
          'Set WEBHOOK_URL env var to the n8n public FQDN so the resume URL is ' +
          'reachable from the channel\'s servers.',
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
    const discordToken = credentials['discordBotToken'] as string | undefined;
    const smtpUrl = credentials['smtpUrl'] as string | undefined;

    const channelParam = this.getNodeParameter('channel', 0, 'auto') as ChannelName;
    const destination = this.getNodeParameter('destination', 0, '') as string;
    const waitTimeoutHours = this.getNodeParameter('waitTimeoutHours', 0, 24) as number;

    const itemCount = items.length > 0 ? items.length : 1;

    for (const [i] of Array.from({ length: itemCount }).entries()) {
      try {
        const data = (items[i]?.json ?? {}) as Record<string, unknown>;

        // ── RESUME MODE ──────────────────────────────────────────────────
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

          // Non-fatal channel acknowledgement
          const resolvedChannel = state.channel ?? 'slack';
          const ackToken = resolveToken(resolvedChannel, { slackToken, discordToken, smtpUrl });
          if (ackToken && state.delivery) {
            try {
              const adapter = channelsModule.getChannel(resolvedChannel);
              await adapter.postAck({
                answer: hitlAnswer,
                correlationId,
                token: ackToken,
                delivery: state.delivery,
              });
            } catch {
              // ack failure must not block agent resume
            }
          }

          // Merge the human's answer into context
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
              round: state.round ?? 1,
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

          // ── MULTI-ROUND RE-PARK (AC3 / R-07) ──────────────────────────
          // If the agent still needs input, re-save state with incremented
          // round and re-wait instead of deleting state.
          if (agentResult.status === 'needs-input') {
            const nextRound = convState.nextRound(state);
            const newQuestion = agentResult.result.text;

            // Post the new question via the same channel
            const questionToken = resolveToken(resolvedChannel, { slackToken, discordToken, smtpUrl });
            if (!questionToken && resolvedChannel !== 'notify') {
              throw new NodeOperationError(
                this.getNode(),
                `HITL multi-round: no token available for channel "${resolvedChannel}". ` +
                  'Ensure the appropriate credential field is set on SoftwareTeamsApi.',
                { itemIndex: i },
              );
            }

            const resumeUrl = this.getSignedResumeUrl();
            const adapter = channelsModule.getChannel(resolvedChannel);
            const { deliveryRef } = await adapter.postQuestion({
              question: newQuestion,
              correlationId,
              resumeUrl,
              token: questionToken ?? '',
              destination: resolveDestination(resolvedChannel, destination, state.delivery),
            }).catch((err: unknown) => {
              throw new NodeOperationError(
                this.getNode(),
                `HITL multi-round: failed to post follow-up question via ${resolvedChannel}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
                { itemIndex: i },
              );
            });

            // Re-save state with incremented round
            convState.saveState({
              correlationId,
              originalEnvelope: agentResult,
              slackChannel: (deliveryRef['slackChannel'] as string) ?? state.slackChannel ?? '',
              slackThreadTs: (deliveryRef['slackThreadTs'] as string) ?? state.slackThreadTs ?? '',
              resumeUrl,
              question: newQuestion,
              createdAt: Date.now(),
              channel: resolvedChannel,
              round: nextRound,
              delivery: deliveryRef,
            });

            const waitTill = new Date(Date.now() + waitTimeoutHours * 60 * 60 * 1000);
            await this.putExecutionToWait(waitTill);

            returnData.push({
              json: toDataObject({
                ...agentResult,
                hitl: {
                  question: newQuestion,
                  channel: resolvedChannel,
                  round: nextRound,
                  delivery: deliveryRef,
                  resumeUrl,
                },
              }),
              pairedItem: { item: i },
            });
            continue;
          }

          // Agent returned ok/error — clear state (end of conversation).
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

        // ── ASK MODE ─────────────────────────────────────────────────────
        const envelope = fromDataObject<NodeEnvelope>(items[i]!.json);

        if (envelope.status !== 'needs-input') {
          returnData.push({
            json: toDataObject(data as Record<string, unknown>),
            pairedItem: { item: i },
          });
          continue;
        }

        const question = envelope.result.text;
        const correlationId = envelope.correlationId;

        // Resolve the channel: explicit param wins, then envelope hint, then discord default.
        const resolvedChannel = resolveChannelName(channelParam, envelope);

        const token = resolveToken(resolvedChannel, { slackToken, discordToken, smtpUrl });
        if (!token && resolvedChannel !== 'notify') {
          throw new NodeOperationError(
            this.getNode(),
            `No credential token found for channel "${resolvedChannel}". ` +
              resolveTokenHint(resolvedChannel),
            { itemIndex: i },
          );
        }

        const resumeUrl = this.getSignedResumeUrl();

        const adapter = channelsModule.getChannel(resolvedChannel);
        const { deliveryRef } = await adapter.postQuestion({
          question,
          correlationId,
          resumeUrl,
          token: token ?? '',
          destination,
        }).catch((err: unknown) => {
          throw new NodeOperationError(
            this.getNode(),
            `Failed to post agent question via ${resolvedChannel}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            { itemIndex: i },
          );
        });

        convState.saveState({
          correlationId,
          originalEnvelope: envelope,
          slackChannel: (deliveryRef['slackChannel'] as string) ?? '',
          slackThreadTs: (deliveryRef['slackThreadTs'] as string) ?? '',
          resumeUrl,
          question,
          createdAt: Date.now(),
          channel: resolvedChannel,
          round: 1,
          delivery: deliveryRef,
        });

        const waitTill = new Date(Date.now() + waitTimeoutHours * 60 * 60 * 1000);
        await this.putExecutionToWait(waitTill);

        returnData.push({
          json: toDataObject({
            ...envelope,
            hitl: {
              question,
              channel: resolvedChannel,
              round: 1,
              delivery: deliveryRef,
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

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the effective channel name from param + envelope hint. */
function resolveChannelName(
  param: ChannelName,
  envelope: NodeEnvelope,
): Exclude<ChannelName, 'auto'> {
  if (param !== 'auto') return param;

  // Check the envelope's optional hitlChannel hint (T3)
  const hint = (envelope as unknown as Record<string, unknown>)['hitlChannel'] as string | undefined;
  if (hint === 'slack' || hint === 'email' || hint === 'notify' || hint === 'discord') {
    return hint;
  }

  // Default to discord for the first live test
  return 'discord';
}

/** Return the credential token for a given channel. */
function resolveToken(
  channel: Exclude<ChannelName, 'auto'>,
  tokens: { slackToken?: string; discordToken?: string; smtpUrl?: string },
): string | undefined {
  switch (channel) {
    case 'slack':
      return tokens.slackToken || undefined;
    case 'discord':
      return tokens.discordToken || undefined;
    case 'email':
      return tokens.smtpUrl || undefined;
    case 'notify':
      return undefined; // notify needs no token
  }
}

/** Return a user-friendly hint about which credential field to set. */
function resolveTokenHint(channel: Exclude<ChannelName, 'auto'>): string {
  switch (channel) {
    case 'slack':
      return 'Add a Slack Bot OAuth token (xoxb-...) to the SoftwareTeamsApi credential under "Slack Bot Token".';
    case 'discord':
      return 'Add a Discord Bot Token to the SoftwareTeamsApi credential under "Discord Bot Token".';
    case 'email':
      return 'Add an SMTP URL (smtp://user:pass@host:port) to the SoftwareTeamsApi credential under "SMTP URL".';
    case 'notify':
      return ''; // should never reach here
  }
}

/**
 * Resolve the destination for a multi-round follow-up question.
 * On re-park we may need the destination from the original delivery ref
 * (e.g. the Discord channel ID) if it differs from the node param.
 */
function resolveDestination(
  channel: Exclude<ChannelName, 'auto'>,
  nodeDestination: string,
  delivery?: Record<string, unknown>,
): string {
  if (nodeDestination) return nodeDestination;
  if (!delivery) return '';

  switch (channel) {
    case 'slack':
      return (delivery['slackChannel'] as string) ?? '';
    case 'discord':
      return (delivery['discordChannelId'] as string) ?? '';
    case 'email':
      return (delivery['emailTo'] as string) ?? '';
    case 'notify':
      return (delivery['destination'] as string) ?? '';
  }
}
