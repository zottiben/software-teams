import { ICredentialType, INodeProperties, ICredentialTestRequest } from 'n8n-workflow';

/**
 * SoftwareTeamsApi credential type.
 * Holds every secret the Software Teams n8n nodes need. Secrets are stored
 * encrypted in n8n's DB and injected at execution time — they MUST NOT appear
 * as node parameters, node output, or log entries (R-02).
 * Self-hosted constraint (AC9): the n8n worker must have `claude` on PATH and
 * ANTHROPIC_API_KEY set here. Fails fast with a clear error if the binary is absent.
 */
export class SoftwareTeamsApi implements ICredentialType {
  name = 'softwareTeamsApi';
  displayName = 'Software Teams API';
  icon = 'file:softwareTeamsApi.svg' as const;
  test: ICredentialTestRequest = {
    request: {
      baseURL: 'https://api.anthropic.com',
      url: '/v1/models',
      headers: {
        'x-api-key': '={{ $credentials.anthropicApiKey }}',
        'anthropic-version': '2023-06-01',
      },
    },
  };
  documentationUrl =
    'https://github.com/websitelabs/software-teams/tree/main/n8n#self-hosted-constraint';

  properties: INodeProperties[] = [
    {
      displayName: 'Anthropic API Key',
      name: 'anthropicApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Your Anthropic API key (https://console.anthropic.com/). ' +
        'Injected into the claude CLI process via ANTHROPIC_API_KEY — ' +
        'never passed as a CLI argument or written to node output.',
    },

    {
      displayName: 'ClickUp API Token',
      name: 'clickupApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'ClickUp personal API token. Used by trigger and context-fetch nodes ' +
        'that pull ticket detail for PII-scrubbed context (reuses src/utils/clickup.ts).',
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
