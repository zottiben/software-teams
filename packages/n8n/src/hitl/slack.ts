import * as https from 'node:https';
import * as crypto from 'node:crypto';

/**
 * Verify a Slack interactivity webhook request using the HMAC-SHA256 signature
 * Slack attaches to every inbound HTTP request.
 *
 * Security (R-05 / auth hardening — T13): the n8n resume URL is the outer auth
 * layer; this adds a second layer by confirming the body was signed by YOUR Slack
 * app's signing secret, so an attacker who learns the URL cannot forge a valid
 * `hitlAnswer` without knowing that secret.
 */
export function verifySlackSignature(
  slackSignature: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
  signingSecret: string | undefined,
  maxAgeSeconds = 300,
): boolean {
  if (!slackSignature || !timestamp || !signingSecret) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > maxAgeSeconds) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedSig =
    'v0=' +
    crypto.createHmac('sha256', signingSecret).update(baseString, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(slackSignature, 'utf8'),
      Buffer.from(expectedSig, 'utf8'),
    );
  } catch {
    return false;
  }
}

/** Result of a successful chat.postMessage call. */
export interface PostQuestionResult {
  /** Slack message timestamp — use as `thread_ts` for threaded replies. */
  ts: string;
  /** Resolved channel ID (may differ from the channel param if given a name). */
  channel: string;
}

/**
 * Post an agent HITL question to Slack using Block Kit.
 *
 * Embeds correlationId (not the full resumeUrl) in the button value — Slack
 * limits button values to 75 characters; the interactivity handler looks up
 * the resumeUrl from the HITL state store keyed by correlationId.
 */
export async function postQuestion(
  token: string,
  channel: string,
  question: string,
  correlationId: string,
  _resumeUrl: string,
): Promise<PostQuestionResult> {
  const buttonValue = correlationId.slice(0, 75);

  const payload = {
    channel,
    text: `🤖 *Software Teams agent needs your input*`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 Agent question',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: question,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Correlation ID:*\n\`${correlationId}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Action:*\nClick the button or reply in thread, then POST to the resume URL`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '💬 Provide answer', emoji: true },
            action_id: 'hitl_reply',
            value: buttonValue,
            style: 'primary',
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              'Your Slack interactivity handler receives this button click, ' +
              'looks up the `resumeUrl` from the HITL state store by `correlationId`, ' +
              'and POSTs `{ hitlAnswer: "<your answer>", correlationId: "<id>" }` to it.',
          },
        ],
      },
    ],
  };

  const result = await slackApiCall('chat.postMessage', token, payload);
  return {
    ts: result['ts'] as string,
    channel: result['channel'] as string,
  };
}

/**
 * Post a threaded reply in an existing Slack conversation.
 * Uses the Slack HTTP API directly to avoid the n8n built-in Slack tool's
 * thread_ts bug (GitHub #21252).
 */
export async function postThreadReply(
  token: string,
  channel: string,
  threadTs: string,
  message: string,
): Promise<void> {
  await slackApiCall('chat.postMessage', token, {
    channel,
    thread_ts: threadTs,
    text: message,
    mrkdwn: true,
  });
}

/** Ingestion boundary: payload type is `unknown` because the Slack API accepts arbitrary JSON shapes per method. */
async function slackApiCall(
  method: string,
  token: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  const contentLength = Buffer.byteLength(body, 'utf8');

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'slack.com',
        path: `/api/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': contentLength,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const parseResult = (() => {
            try {
              return { ok: true as const, parsed: JSON.parse(raw) as Record<string, unknown> };
            } catch (e) {
              return { ok: false as const, err: e };
            }
          })();
          if (!parseResult.ok) {
            reject(
              new Error(
                `Slack API ${method}: failed to parse response — ${String(parseResult.err)}\nBody: ${raw.slice(0, 200)}`,
              ),
            );
            return;
          }
          const parsed = parseResult.parsed;
          if (!parsed['ok']) {
            reject(
              new Error(
                `Slack API ${method} error: ${String(parsed['error'] ?? 'unknown')}`,
              ),
            );
          } else {
            resolve(parsed);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}
