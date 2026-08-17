import { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * SoftwareTeamsApi credential type.
 * Holds every secret the Software Teams n8n nodes need. Secrets are stored
 * encrypted in n8n's DB and injected at execution time — they MUST NOT appear
 * as node parameters, node output, or log entries (R-02).
 *
 * Self-hosted constraint (AC9): the n8n worker must have `claude` on PATH.
 * Install it with `curl -fsSL https://claude.ai/install.sh | bash`.
 *
 * Auth: two modes, chosen explicitly rather than inferred from whichever secret
 * happens to be filled in.
 *
 *  - `subscription` injects CLAUDE_CODE_OAUTH_TOKEN, so runs draw on a Claude
 *    Pro/Max/Team/Enterprise plan. Generate the token with `claude setup-token`;
 *    it lasts a year and is not stored anywhere by that command.
 *  - `apiKey` injects ANTHROPIC_API_KEY and bills the API.
 *
 * The modes are mutually exclusive by construction, because ANTHROPIC_API_KEY
 * OUTRANKS the OAuth token in Claude Code's credential precedence and, in `-p`
 * mode, is always used when present. A worker with both set would silently bill
 * the API while the operator believed the subscription was in use, so the spawn
 * layer strips the losing variable rather than merely preferring the winner.
 */
export class SoftwareTeamsApi implements ICredentialType {
  name = 'softwareTeamsApi';
  displayName = 'Software Teams API';
  icon = 'file:softwareTeamsApi.svg' as const;
  // Validity here is a property of the WORKER - is `claude` on PATH, and does
  // it authenticate as the mode we selected - not of any HTTP endpoint, so the
  // test lives on the Agent node as `softwareTeamsApiTest` (declared via
  // `testedBy` in that node's `credentials` array). It runs `claude auth status`
  // and asserts the reported auth METHOD matches the selected mode, which also
  // catches a stray ANTHROPIC_API_KEY silently taking over billing.
  //
  // The previous HTTP `test` POSTed to api.anthropic.com with `x-api-key`,
  // which cannot validate a subscription OAuth token at all.

  documentationUrl =
    'https://github.com/websitelabs/software-teams/tree/main/n8n#self-hosted-constraint';

  properties: INodeProperties[] = [
    {
      displayName: 'Authentication',
      name: 'authMode',
      type: 'options',
      default: 'subscription',
      options: [
        { name: 'Claude Subscription (OAuth Token)', value: 'subscription' },
        { name: 'Anthropic API Key', value: 'apiKey' },
      ],
      description:
        'Which credential the claude CLI authenticates with. Subscription draws on ' +
        'your Claude plan; API Key bills the Anthropic API. These are mutually ' +
        'exclusive: an API key always outranks a subscription token, so the losing ' +
        'variable is removed from the spawned process environment.',
    },

    {
      displayName: 'Claude Code OAuth Token',
      name: 'claudeCodeOauthToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      displayOptions: { show: { authMode: ['subscription'] } },
      description:
        'Long-lived subscription token. Generate it by running `claude setup-token` ' +
        'on any machine with a browser and copying the printed value; it is valid for ' +
        'a year and requires a Pro, Max, Team, or Enterprise plan. Injected into the ' +
        'claude CLI process via CLAUDE_CODE_OAUTH_TOKEN — never passed as a CLI ' +
        'argument or written to node output.',
    },

    {
      displayName: 'Anthropic API Key',
      name: 'anthropicApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      displayOptions: { show: { authMode: ['apiKey'] } },
      description:
        'Your Anthropic API key (https://console.anthropic.com/). ' +
        'Injected into the claude CLI process via ANTHROPIC_API_KEY — ' +
        'never passed as a CLI argument or written to node output.',
    },

    {
      displayName: 'Datadog API Key',
      name: 'datadogApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Datadog API key. Used by trigger nodes that ingest Datadog issues as ' +
        'workflow inputs (reuses src/utils/datadog.ts PII scrubbing).',
    },

    {
      displayName: 'Datadog Application Key',
      name: 'datadogAppKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Datadog application key (required alongside the API key for certain ' +
        'Datadog API endpoints).',
    },

    {
      displayName: 'GitHub Token',
      name: 'githubToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'GitHub personal access token or fine-grained token with repo + PR ' +
        'write scopes. Used by the GitHub Output node (T7) to open PRs/issues.',
    },

    {
      displayName: 'Slack Bot Token',
      name: 'slackBotToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Slack Bot OAuth token (xoxb-…). Used by the HITL state machine (T10) ' +
        'to post agent questions and receive human replies via Slack webhooks.',
    },

    {
      displayName: 'Discord Bot Token',
      name: 'discordBotToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Discord Bot Token. Used by the channel-agnostic HITL node (T8) to ' +
        'post agent questions and acknowledgements to a Discord channel via the ' +
        'Discord REST API. The bot must have Send Messages permission in the target channel.',
    },

    {
      displayName: 'SMTP URL',
      name: 'smtpUrl',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Single SMTP connection string (e.g. smtp://user:pass@host:port or ' +
        'smtps://user:pass@host:465). Used by the channel-agnostic HITL node (T8) ' +
        'to send agent questions and acknowledgements via email. Encodes all SMTP ' +
        'credentials in one URL — do NOT add separate host/user/password fields.',
    },
  ];
}
