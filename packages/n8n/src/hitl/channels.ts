/**
 * Channel-agnostic HITL delivery adapters (T8 — AC3, AC4).
 *
 * Each adapter implements `postQuestion` (deliver the agent's question to the
 * human) and `postAck` (acknowledge receipt of the human's reply). All
 * secrets/tokens are passed in as function arguments — adapters NEVER read
 * from `process.env` directly (R-02 / AC8).
 */

import * as https from 'node:https';
import * as tls from 'node:tls';
import * as net from 'node:net';

// ── Public interface ───────────────────────────────────────────────────────

/** Delivery coordinates returned by a channel adapter after posting a question. */
export interface DeliveryRef {
  [key: string]: unknown;
}

/** Arguments passed to every channel adapter's `postQuestion`. */
export interface PostQuestionArgs {
  /** The agent's question text. */
  question: string;
  /** The stable correlation id for this run/conversation. */
  correlationId: string;
  /** The n8n signed resume URL that the human (or their handler) should POST to. */
  resumeUrl: string;
  /** Channel-specific credential token (e.g. Slack bot token, Discord bot token, SMTP URL). */
  token: string;
  /** Channel-specific destination (e.g. Slack channel ID, Discord channel ID, email address). */
  destination: string;
}

/** Arguments passed to every channel adapter's `postAck`. */
export interface PostAckArgs {
  /** The human's reply text. */
  answer: string;
  /** The stable correlation id for this run/conversation. */
  correlationId: string;
  /** Channel-specific credential token. */
  token: string;
  /** Delivery coordinates from the original `postQuestion` call. */
  delivery: DeliveryRef;
}

/** Channel adapter contract. */
export interface HitlChannelAdapter {
  postQuestion(args: PostQuestionArgs): Promise<{ deliveryRef: DeliveryRef }>;
  postAck(args: PostAckArgs): Promise<void>;
}

/** Supported HITL channel names. */
export type ChannelName = 'slack' | 'email' | 'notify' | 'discord';

// ── Slack adapter ──────────────────────────────────────────────────────────

/**
 * Slack adapter — reuses the Block Kit post + thread reply pattern from
 * `src/hitl/slack.ts`. Delegates to the existing helpers via require so the
 * Slack-specific HTTP logic is not duplicated.
 */
const slackAdapter: HitlChannelAdapter = {
  async postQuestion(args) {
    const SLACK_MODULE: string = './slack';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const slackHelpers = require(SLACK_MODULE) as {
      postQuestion: (
        token: string,
        channel: string,
        question: string,
        correlationId: string,
        resumeUrl: string,
      ) => Promise<{ ts: string; channel: string }>;
    };

    const result = await slackHelpers.postQuestion(
      args.token,
      args.destination,
      args.question,
      args.correlationId,
      args.resumeUrl,
    );

    return {
      deliveryRef: {
        slackChannel: result.channel,
        slackThreadTs: result.ts,
      },
    };
  },

  async postAck(args) {
    const SLACK_MODULE: string = './slack';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const slackHelpers = require(SLACK_MODULE) as {
      postThreadReply: (
        token: string,
        channel: string,
        threadTs: string,
        message: string,
      ) => Promise<void>;
    };

    const channel = args.delivery['slackChannel'] as string;
    const threadTs = args.delivery['slackThreadTs'] as string;
    if (!channel || !threadTs) return;

    await slackHelpers.postThreadReply(
      args.token,
      channel,
      threadTs,
      `Reply received: "${args.answer}" -- resuming agent...`,
    );
  },
};

// ── Discord adapter ────────────────────────────────────────────────────────

/**
 * Discord adapter — posts the question to a Discord channel via the bot
 * token using the Discord REST API v10. Records channel + message id in the
 * delivery ref so we can thread follow-ups.
 */
const discordAdapter: HitlChannelAdapter = {
  async postQuestion(args) {
    const content =
      `**Agent question** (correlation: \`${args.correlationId}\`)\n\n` +
      `${args.question}\n\n` +
      `> Reply via the resume endpoint or use the correlation id to respond.`;

    const result = await discordApiCall(
      'POST',
      `/channels/${args.destination}/messages`,
      args.token,
      { content },
    );

    return {
      deliveryRef: {
        discordChannelId: args.destination,
        discordMessageId: result['id'] as string,
      },
    };
  },

  async postAck(args) {
    const channelId = args.delivery['discordChannelId'] as string;
    const messageId = args.delivery['discordMessageId'] as string;
    if (!channelId || !messageId) return;

    const content = `Reply received: "${args.answer}" -- resuming agent... (correlation: \`${args.correlationId}\`)`;

    await discordApiCall(
      'POST',
      `/channels/${channelId}/messages`,
      args.token,
      {
        content,
        message_reference: { message_id: messageId },
      },
    );
  },
};

/** Low-level Discord REST API call. */
async function discordApiCall(
  method: string,
  path: string,
  botToken: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  const contentLength = Buffer.byteLength(body, 'utf8');

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'discord.com',
        path: `/api/v10${path}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': contentLength,
          Authorization: `Bot ${botToken}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `Discord API ${method} ${path} returned ${res.statusCode}: ${raw.slice(0, 300)}`,
                ),
              );
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Discord API: failed to parse response: ${raw.slice(0, 200)}`));
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

// ── Email adapter ──────────────────────────────────────────────────────────

/**
 * Email adapter — sends via SMTP using a single connection string `smtpUrl`
 * (e.g. `smtp://user:pass@host:port`). Uses raw SMTP commands via Node
 * `net`/`tls` to avoid external dependencies.
 *
 * The `destination` field is the recipient email address. The `token` field is
 * the full `smtpUrl` connection string.
 */
const emailAdapter: HitlChannelAdapter = {
  async postQuestion(args) {
    const messageId = `<hitl-${args.correlationId}-${Date.now()}@software-teams>`;

    await sendSmtpEmail({
      smtpUrl: args.token,
      to: args.destination,
      subject: `[Software Teams] Agent question (${args.correlationId})`,
      body:
        `Agent question:\n\n${args.question}\n\n` +
        `Correlation ID: ${args.correlationId}\n` +
        `Resume URL: ${args.resumeUrl}`,
      messageId,
    });

    return {
      deliveryRef: {
        emailTo: args.destination,
        emailMessageId: messageId,
      },
    };
  },

  async postAck(args) {
    const originalMessageId = args.delivery['emailMessageId'] as string;
    const to = args.delivery['emailTo'] as string;
    if (!to) return;

    await sendSmtpEmail({
      smtpUrl: args.token,
      to,
      subject: `Re: [Software Teams] Agent question (${args.correlationId})`,
      body: `Reply received: "${args.answer}" -- resuming agent...\n\nCorrelation ID: ${args.correlationId}`,
      messageId: `<hitl-ack-${args.correlationId}-${Date.now()}@software-teams>`,
      inReplyTo: originalMessageId,
    });
  },
};

/** Parse an SMTP URL into connection components. */
function parseSmtpUrl(smtpUrl: string): {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
} {
  const url = new URL(smtpUrl);
  const secure = url.protocol === 'smtps:' || url.port === '465';
  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : (secure ? 465 : 587),
    user: decodeURIComponent(url.username),
    pass: decodeURIComponent(url.password),
    secure,
  };
}

/** Send an email via raw SMTP. Minimal implementation for HITL notifications. */
async function sendSmtpEmail(opts: {
  smtpUrl: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string;
}): Promise<void> {
  const conn = parseSmtpUrl(opts.smtpUrl);
  const fromAddr = conn.user.includes('@') ? conn.user : `hitl@software-teams.local`;

  const headers = [
    `From: Software Teams HITL <${fromAddr}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Message-ID: ${opts.messageId}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
  ];

  const message = headers.join('\r\n') + '\r\n\r\n' + opts.body;

  return new Promise<void>((resolve, reject) => {
    const onConnect = (socket: net.Socket) => {
      // We just need a minimal SMTP exchange
      let state = 0; // 0=greeting, 1=EHLO, 2=AUTH, 3=MAIL, 4=RCPT, 5=DATA, 6=body, 7=QUIT

      const commands = [
        `EHLO software-teams\r\n`,
        `AUTH PLAIN ${Buffer.from(`\0${conn.user}\0${conn.pass}`).toString('base64')}\r\n`,
        `MAIL FROM:<${fromAddr}>\r\n`,
        `RCPT TO:<${opts.to}>\r\n`,
        `DATA\r\n`,
        `${message}\r\n.\r\n`,
        `QUIT\r\n`,
      ];

      socket.on('data', (data: Buffer) => {
        const response = data.toString('utf8');
        const code = parseInt(response.slice(0, 3), 10);

        if (code >= 400 && state < 7) {
          socket.destroy();
          reject(new Error(`SMTP error at state ${state}: ${response.trim()}`));
          return;
        }

        if (state < commands.length) {
          socket.write(commands[state]);
          state++;
        } else {
          socket.destroy();
          resolve();
        }
      });

      socket.on('error', reject);
    };

    const socket = conn.secure
      ? tls.connect({ host: conn.host, port: conn.port, rejectUnauthorized: true }, function (this: tls.TLSSocket) { onConnect(this); })
      : net.connect({ host: conn.host, port: conn.port }, function (this: net.Socket) { onConnect(this); });

    socket.on('error', reject);
  });
}

// ── Notify adapter ─────────────────────────────────────────────────────────

/**
 * n8n-notification adapter — emits a structured payload that downstream
 * n8n nodes (e.g. an n8n Notification node, a Set node, or a webhook) can
 * consume. No external API call is needed; the "delivery" is the payload
 * itself, available in the node's output for downstream wiring.
 */
const notifyAdapter: HitlChannelAdapter = {
  async postQuestion(args) {
    return {
      deliveryRef: {
        type: 'n8n-notification',
        correlationId: args.correlationId,
        question: args.question,
        resumeUrl: args.resumeUrl,
        destination: args.destination,
        timestamp: Date.now(),
      },
    };
  },

  async postAck(_args) {
    // No external action needed for n8n-notification — downstream nodes
    // handle acknowledgement via the workflow itself.
  },
};

// ── Factory ────────────────────────────────────────────────────────────────

const adapters: Record<ChannelName, HitlChannelAdapter> = {
  slack: slackAdapter,
  discord: discordAdapter,
  email: emailAdapter,
  notify: notifyAdapter,
};

/** Return the channel adapter for the given channel name. */
export function getChannel(name: ChannelName): HitlChannelAdapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(
      `Unknown HITL channel "${name}". Supported channels: ${Object.keys(adapters).join(', ')}`,
    );
  }
  return adapter;
}
