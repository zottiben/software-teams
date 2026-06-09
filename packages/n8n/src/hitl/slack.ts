/**
 * Slack API helpers for the HITL state machine (T10).
 *
 * Provides two operations:
 *   - `postQuestion`: post a Block Kit question message to a Slack channel,
 *     embedding the `correlationId` in the button so the Slack interactivity
 *     handler can route the reply back to the correct n8n execution.
 *   - `postThreadReply`: post a follow-up message in thread (acknowledges
 *     receipt of the human's answer).
 *
 * Uses the Node.js built-in `https` module — no external Slack SDK dependency,
 * no Bun-specific APIs — so this module is unit-testable in plain Node/Bun.
 *
 * Credential note (R-02): The Slack Bot Token is passed as an argument by
 * the calling node (which reads it from the `softwareTeamsApi` credential).
 * This module never reads from process.env directly.
 *
 * 75-char button value limit (T2 research doc):
 *   Slack limits button `value` fields to 75 characters. We embed the
 *   correlationId (not the full resumeUrl, which is ~120 chars) in the button.
 *   The interactivity handler looks up the resumeUrl in the conversation state
 *   store keyed by correlationId.
 *
 * thread_ts note:
 *   We use the Slack HTTP API directly for threading (not n8n's built-in Slack
 *   node) to avoid the thread_ts bug in n8n's AI Slack tool (GitHub #21252).
 */

import * as https from 'node:https';
import * as crypto from 'node:crypto';

// --------------------------------------------------------------------------
// Slack request signature verification (R-05 / auth hardening — T13)
// --------------------------------------------------------------------------

/**
 * Verify a Slack interactivity / events webhook request using the HMAC-SHA256
 * signature Slack attaches to every inbound HTTP request.
 *
 * IMPORTANT: The n8n resume URL is the outer auth layer — only Slack (or
 * whoever has the URL) can POST to it. This function adds a second layer by
 * confirming the request body was signed by YOUR Slack app's signing secret,
 * so an attacker who learns the resume URL still cannot forge a valid
 * `hitlAnswer` without knowing the signing secret.
 *
 * Usage in your Slack interactivity handler (before forwarding to n8n):
 * ```ts
 * const ok = verifySlackSignature(
 *   request.headers['x-slack-signature'],
 *   request.headers['x-slack-request-timestamp'],
 *   rawBodyString,
 *   process.env.SLACK_SIGNING_SECRET,
 * );
 * if (!ok) return response.status(403).send('Forbidden');
 * ```
 *
 * Reference: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * @param slackSignature   Value of the `X-Slack-Signature` header.
 * @param timestamp        Value of the `X-Slack-Request-Timestamp` header.
 * @param rawBody          Raw (un-parsed) request body string.
 * @param signingSecret    Your Slack app's signing secret.
 * @param maxAgeSeconds    Reject requests older than this many seconds (default 300).
 * @returns true when the signature is valid and the request is fresh.
 */
export function verifySlackSignature(
  slackSignature: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
  signingSecret: string | undefined,
  maxAgeSeconds = 300,
): boolean {
  if (!slackSignature || !timestamp || !signingSecret) return false;

  // Replay-attack guard: reject stale requests.
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > maxAgeSeconds) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedSig =
    'v0=' +
    crypto.createHmac('sha256', signingSecret).update(baseString, 'utf8').digest('hex');

  // Constant-time comparison prevents timing attacks.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(slackSignature, 'utf8'),
      Buffer.from(expectedSig, 'utf8'),
    );
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Result of a successful chat.postMessage call. */
export interface PostQuestionResult {
  /** Slack message timestamp — use as `thread_ts` for threaded replies. */
  ts: string;
  /** Resolved channel ID (may differ from the channel param if given a name). */
  channel: string;
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Post an agent HITL question to Slack using Block Kit.
 *
 * The posted message includes:
 * - The agent's question in mrkdwn.
 * - The correlationId for traceability.
 * - A primary "Reply" button with `value: correlationId` (≤75 chars).
 *
 * @param token      Slack Bot OAuth token (xoxb-…)
 * @param channel    Channel ID or name (e.g. "C0123456" or "#ai-questions")
 * @param question   The agent's question text (from `result.text`)
 * @param correlationId  Stable run id — embedded in button value for routing
 * @param _resumeUrl Resume URL (stored in state store; NOT embedded due to 75-char limit)
 */
export async function postQuestion(
  token: string,
  channel: string,
  question: string,
  correlationId: string,
  _resumeUrl: string,
): Promise<PostQuestionResult> {
  // Truncate correlationId to 75 chars to satisfy Slack's button value limit.
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
 *
 * Uses `thread_ts` directly via the Slack HTTP API to avoid the n8n built-in
 * Slack tool's thread_ts bug (GitHub #21252).
 *
 * @param token    Slack Bot OAuth token
 * @param channel  Channel ID
 * @param threadTs The `ts` from the original chat.postMessage response
 * @param message  Reply text (mrkdwn)
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

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

/**
 * Call a Slack Web API method via HTTPS POST (JSON body).
 * Throws on HTTP errors and on Slack `ok: false` responses.
 * `payload` is `unknown` because the Slack API accepts arbitrary JSON shapes per method.
 */
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
