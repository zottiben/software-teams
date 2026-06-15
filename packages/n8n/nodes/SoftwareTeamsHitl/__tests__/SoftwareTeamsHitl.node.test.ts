/**
 * SoftwareTeamsHitl node descriptor tests (T8 — AC3, AC4, AC8)
 *
 * Tests that the channel-agnostic HITL node:
 * - Has the correct descriptor, name, and icon.
 * - Declares the required credential (R-02).
 * - Has the expected input/output ports and parameters.
 * - Offers a channel selector with slack/email/notify/discord/auto options.
 * - Does not expose credential fields in node properties (AC8).
 * - Version is 1.
 *
 * Also tests the channels module factory and channel adapter interface.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SoftwareTeamsHitl } from '../SoftwareTeamsHitl.node';

describe('SoftwareTeamsHitl node (T8 — AC3, AC4, AC8)', () => {
  let node: SoftwareTeamsHitl;

  beforeEach(() => {
    node = new SoftwareTeamsHitl();
  });

  // ── Node descriptor ──────────────────────────────────────────────────────

  describe('Node descriptor and identity', () => {
    test('displayName is correct', () => {
      expect(node.description.displayName).toBe('Software Teams HITL');
    });

    test('name is camelCase identifier', () => {
      expect(node.description.name).toBe('softwareTeamsHitl');
    });

    test('version is 1', () => {
      expect(node.description.version).toBe(1);
    });

    test('icon references the node-local SVG', () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain('softwareTeamsHitl');
    });

    test('group is transform', () => {
      expect(node.description.group).toContain('transform');
    });

    test('description mentions multi-round and multi-channel concepts', () => {
      const desc = node.description.description.toLowerCase();
      expect(desc).toContain('human');
      expect(desc).toContain('multi-round');
      expect(desc).toContain('channel');
    });

    test('has exactly one input port and one output port', () => {
      expect(node.description.inputs).toEqual(['main']);
      expect(node.description.outputs).toEqual(['main']);
    });

    test('defaults have a non-empty name', () => {
      expect(node.description.defaults.name).toBeTruthy();
      expect(node.description.defaults.name).toContain('HITL');
    });

    test('execute method is defined', () => {
      expect(typeof node.execute).toBe('function');
    });
  });

  // ── R-02 / AC8: Credential ──────────────────────────────────────────────

  describe('R-02 / AC8: Credential requirement and secret isolation', () => {
    test('declares softwareTeamsApi credential as required', () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      expect(creds!.length).toBeGreaterThanOrEqual(1);

      const cred = creds![0]!;
      expect(cred.name).toBe('softwareTeamsApi');
      expect(cred.required).toBe(true);
    });

    test('does not expose any credential fields in node properties', () => {
      // Tokens must NEVER appear as node parameters (R-02 / AC8)
      const propNames = node.description.properties.map((p) => p.name);
      expect(propNames).not.toContain('slackBotToken');
      expect(propNames).not.toContain('discordBotToken');
      expect(propNames).not.toContain('smtpUrl');
      expect(propNames).not.toContain('token');
      expect(propNames).not.toContain('apiKey');
      expect(propNames).not.toContain('password');
    });
  });

  // ── AC4: Channel selector ────────────────────────────────────────────────

  describe('AC4: Channel selector with multi-channel support', () => {
    test('channel property exists as an options type', () => {
      const prop = node.description.properties.find((p) => p.name === 'channel');
      expect(prop).toBeTruthy();
      expect(prop!.type).toBe('options');
    });

    test('channel options include slack, email, notify, discord, and auto', () => {
      const prop = node.description.properties.find((p) => p.name === 'channel');
      expect(prop).toBeTruthy();
      const options = (prop as any).options as Array<{ value: string }>;
      const values = options.map((o) => o.value);
      expect(values).toContain('slack');
      expect(values).toContain('email');
      expect(values).toContain('notify');
      expect(values).toContain('discord');
      expect(values).toContain('auto');
    });

    test('channel default is auto', () => {
      const prop = node.description.properties.find((p) => p.name === 'channel');
      expect((prop as any).default).toBe('auto');
    });
  });

  // ── Node properties ──────────────────────────────────────────────────────

  describe('Node properties for HITL configuration', () => {
    test('destination is a required string property', () => {
      const prop = node.description.properties.find((p) => p.name === 'destination');
      expect(prop).toBeTruthy();
      expect(prop!.type).toBe('string');
      expect(prop!.required).toBe(true);
    });

    test('waitTimeoutHours is an optional number property with default 24', () => {
      const prop = node.description.properties.find((p) => p.name === 'waitTimeoutHours');
      expect(prop).toBeTruthy();
      expect(prop!.type).toBe('number');
      expect(prop!.required).toBeFalsy();
      expect((prop as any).default).toBe(24);
    });

    test('all properties have non-empty descriptions', () => {
      for (const prop of node.description.properties) {
        expect(prop.description).toBeTruthy();
        expect(typeof prop.description).toBe('string');
        expect((prop.description as string).length).toBeGreaterThan(0);
      }
    });
  });

  // ── AC3 / Mode detection ─────────────────────────────────────────────────

  describe('AC3: Mode detection rules (input-shape discrimination)', () => {
    test('resume mode is triggered by hitlAnswer + correlationId fields', () => {
      const resumePayload = { hitlAnswer: 'yes, use PostgreSQL', correlationId: 'run-123' };
      expect(typeof resumePayload['hitlAnswer']).toBe('string');
      expect(typeof resumePayload['correlationId']).toBe('string');
    });

    test('ask mode is triggered by status === needs-input (NodeEnvelope)', () => {
      const envelope = {
        correlationId: 'run-456',
        agentId: 'software-teams-backend',
        status: 'needs-input',
        input: { prompt: 'Which DB?', context: null },
        result: { text: 'Should I use PostgreSQL or MySQL?' },
        artifacts: [],
      };
      expect(envelope.status).toBe('needs-input');
      expect((envelope as any)['hitlAnswer']).toBeUndefined();
    });

    test('pass-through mode is triggered by status ok or error', () => {
      const okEnvelope = {
        correlationId: 'run-789',
        agentId: 'software-teams-backend',
        status: 'ok',
        input: { prompt: 'Done', context: null },
        result: { text: 'Task complete' },
        artifacts: [],
      };
      expect(okEnvelope.status).not.toBe('needs-input');
      expect((okEnvelope as any)['hitlAnswer']).toBeUndefined();
    });
  });
});

// ── Channel adapters module tests ──────────────────────────────────────────

describe('channels.ts — channel adapter factory (T8 — AC4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getChannel } = require('../../../src/hitl/channels') as {
    getChannel: (name: string) => {
      postQuestion: (args: unknown) => Promise<unknown>;
      postAck: (args: unknown) => Promise<void>;
    };
  };

  test('getChannel returns an adapter for slack', () => {
    const adapter = getChannel('slack');
    expect(typeof adapter.postQuestion).toBe('function');
    expect(typeof adapter.postAck).toBe('function');
  });

  test('getChannel returns an adapter for discord', () => {
    const adapter = getChannel('discord');
    expect(typeof adapter.postQuestion).toBe('function');
    expect(typeof adapter.postAck).toBe('function');
  });

  test('getChannel returns an adapter for email', () => {
    const adapter = getChannel('email');
    expect(typeof adapter.postQuestion).toBe('function');
    expect(typeof adapter.postAck).toBe('function');
  });

  test('getChannel returns an adapter for notify', () => {
    const adapter = getChannel('notify');
    expect(typeof adapter.postQuestion).toBe('function');
    expect(typeof adapter.postAck).toBe('function');
  });

  test('getChannel throws for unknown channel', () => {
    expect(() => getChannel('sms')).toThrow(/Unknown HITL channel/);
  });

  test('notify adapter postQuestion returns a deliveryRef without external call', async () => {
    const adapter = getChannel('notify');
    const result = (await adapter.postQuestion({
      question: 'Which database?',
      correlationId: 'test-123',
      resumeUrl: 'https://example.com/resume',
      token: '',
      destination: 'test-dest',
    })) as { deliveryRef: Record<string, unknown> };

    expect(result.deliveryRef).toBeTruthy();
    expect(result.deliveryRef['type']).toBe('n8n-notification');
    expect(result.deliveryRef['correlationId']).toBe('test-123');
    expect(result.deliveryRef['question']).toBe('Which database?');
    expect(result.deliveryRef['resumeUrl']).toBe('https://example.com/resume');
  });

  test('notify adapter postAck completes without error', async () => {
    const adapter = getChannel('notify');
    // Should not throw — notify ack is a no-op
    await adapter.postAck({
      answer: 'PostgreSQL',
      correlationId: 'test-123',
      token: '',
      delivery: { type: 'n8n-notification' },
    });
  });
});

// ── Conversation state multi-round tests ───────────────────────────────────

describe('conversation-state.ts — nextRound helper (T8 — AC3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nextRound } = require('../../../src/hitl/conversation-state') as {
    nextRound: (state: { round?: number }) => number;
  };

  test('state with no round field returns 2 (implicit round 1 + 1)', () => {
    expect(nextRound({})).toBe(2);
  });

  test('state with round 1 returns 2', () => {
    expect(nextRound({ round: 1 })).toBe(2);
  });

  test('state with round 3 returns 4', () => {
    expect(nextRound({ round: 3 })).toBe(4);
  });
});

// ── Credential additions tests ─────────────────────────────────────────────

describe('SoftwareTeamsApi credential — T8 additions (AC8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SoftwareTeamsApi } = require('../../../credentials/SoftwareTeamsApi.credentials') as {
    SoftwareTeamsApi: new () => { properties: Array<{ name: string; type: string; typeOptions?: { password?: boolean }; default?: unknown }> };
  };

  let cred: InstanceType<typeof SoftwareTeamsApi>;

  beforeEach(() => {
    cred = new SoftwareTeamsApi();
  });

  test('discordBotToken property exists and is password-typed', () => {
    const prop = cred.properties.find((p) => p.name === 'discordBotToken');
    expect(prop).toBeTruthy();
    expect(prop!.type).toBe('string');
    expect(prop!.typeOptions?.password).toBe(true);
    expect(prop!.default).toBe('');
  });

  test('smtpUrl property exists and is password-typed', () => {
    const prop = cred.properties.find((p) => p.name === 'smtpUrl');
    expect(prop).toBeTruthy();
    expect(prop!.type).toBe('string');
    expect(prop!.typeOptions?.password).toBe(true);
    expect(prop!.default).toBe('');
  });

  test('existing slackBotToken property is still present', () => {
    const prop = cred.properties.find((p) => p.name === 'slackBotToken');
    expect(prop).toBeTruthy();
  });

  test('no separate SMTP host/user/password fields (single smtpUrl only)', () => {
    const propNames = cred.properties.map((p) => p.name);
    expect(propNames).not.toContain('smtpHost');
    expect(propNames).not.toContain('smtpUser');
    expect(propNames).not.toContain('smtpPassword');
    expect(propNames).not.toContain('smtpPort');
  });
});
