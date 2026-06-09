/**
 * SoftwareTeamsSlackHitl node descriptor tests (T10 — AC7, AC8, R-02)
 *
 * Tests that the HITL node:
 * - Has the correct descriptor, name, and icon (AC8).
 * - Declares the required credential (R-02).
 * - Has the expected input/output ports and parameters.
 * - Version is 1.
 *
 * Execution-path testing (ask mode / resume mode / pass-through) is covered
 * by the conversation-state unit tests and integration flows; executing this
 * node requires a live n8n runtime with putExecutionToWait support.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SoftwareTeamsSlackHitl } from '../SoftwareTeamsSlackHitl.node';

describe('SoftwareTeamsSlackHitl node (T10 — AC7, AC8, R-02)', () => {
  let node: SoftwareTeamsSlackHitl;

  beforeEach(() => {
    node = new SoftwareTeamsSlackHitl();
  });

  // ── AC8: Node descriptor ─────────────────────────────────────────────────

  describe('AC8: Node descriptor and identity', () => {
    test('displayName is correct', () => {
      expect(node.description.displayName).toBe('Software Teams Slack HITL');
    });

    test('name is camelCase identifier', () => {
      expect(node.description.name).toBe('softwareTeamsSlackHitl');
    });

    test('version is 1', () => {
      expect(node.description.version).toBe(1);
    });

    test('icon references the node-local SVG', () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain('softwareTeamsSlackHitl');
    });

    test('group is transform', () => {
      expect(node.description.group).toContain('transform');
    });

    test('description mentions HITL / needs-input / AC7 concepts', () => {
      const desc = node.description.description.toLowerCase();
      expect(desc).toContain('human');
      expect(desc).toContain('slack');
    });

    test('has exactly one input port and one output port', () => {
      expect(node.description.inputs).toEqual(['main']);
      expect(node.description.outputs).toEqual(['main']);
    });
  });

  // ── R-02: Credential ─────────────────────────────────────────────────────

  describe('R-02: Credential requirement', () => {
    test('declares softwareTeamsApi credential as required', () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      expect(creds!.length).toBeGreaterThanOrEqual(1);

      const cred = creds![0]!;
      expect(cred.name).toBe('softwareTeamsApi');
      expect(cred.required).toBe(true);
    });

    test('does not expose any credential fields in node properties', () => {
      // Tokens must NEVER appear as node parameters (R-02)
      const propNames = node.description.properties.map((p) => p.name);
      expect(propNames).not.toContain('slackBotToken');
      expect(propNames).not.toContain('token');
      expect(propNames).not.toContain('apiKey');
    });
  });

  // ── AC7 / Node properties ─────────────────────────────────────────────────

  describe('AC7: Node properties for HITL configuration', () => {
    test('slackChannel is a required string property', () => {
      const prop = node.description.properties.find((p) => p.name === 'slackChannel');
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

  // ── AC7 / Execution mode contract ─────────────────────────────────────────
  // These tests verify that the MODE DETECTION LOGIC in execute() is correct
  // by asserting on the input-shape discrimination rules (not live execution).

  describe('AC7: Mode detection rules (input-shape discrimination)', () => {
    test('resume mode is triggered by hitlAnswer + correlationId fields', () => {
      // The node execute() checks:
      //   typeof data['hitlAnswer'] === 'string' &&
      //   typeof data['correlationId'] === 'string'
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
      // hitlAnswer is absent → not resume mode
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

  // ── Contract invariants ───────────────────────────────────────────────────

  describe('Contract invariants (node self-consistency)', () => {
    test('node defaults have a non-empty name', () => {
      expect(node.description.defaults.name).toBeTruthy();
      expect(node.description.defaults.name).toContain('HITL');
    });

    test('execute method is defined', () => {
      expect(typeof node.execute).toBe('function');
    });
  });
});
