import { ICredentialType, INodeProperties, ICredentialTestRequest } from 'n8n-workflow';

/**
 * SoftwareTeamsApi credential type.
 *
 * Holds every secret the Software Teams n8n nodes need. Secrets are stored
 * encrypted in n8n's internal database and injected at execution time via
 * `this.getCredentials('softwareTeamsApi')` — they MUST NOT appear as node
 * parameters, node output, or log entries (R-02).
 *
 * Self-hosted constraint (AC9): the n8n worker must have the `claude` binary
 * on PATH and ANTHROPIC_API_KEY set here. n8n Cloud cannot satisfy this
 * requirement; the node fails fast with a clear error if the binary is absent.
 */
export class SoftwareTeamsApi implements ICredentialType {
  name = 'softwareTeamsApi';
  displayName = 'Software Teams API';
  icon = 'file:softwareTeamsApi.svg' as const;
  /**
   * Verify the Anthropic API key by listing available models.
   * A 200 response confirms the key is valid.
   */
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
    // ── Required ──────────────────────────────────────────────────────────────

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

    // ── Optional integrations ─────────────────────────────────────────────────
    // Each token is optional; nodes that require a specific integration
    // should document which field they read. All are masked (password: true)
    // to prevent accidental exposure in n8n's execution log.

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
  ];
}
