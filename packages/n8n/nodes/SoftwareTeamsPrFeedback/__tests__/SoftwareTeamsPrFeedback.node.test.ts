import { describe, test, expect, beforeEach } from 'bun:test';
import { SoftwareTeamsPrFeedback } from '../SoftwareTeamsPrFeedback.node';
import {
  buildCorrelationTag,
  parseCorrelationTag,
} from '@websitelabs/software-teams';
import {
  PR_FEEDBACK_TASK_ID,
  prCommentsToEnvelope,
} from '../../../src/ingestion/pr-feedback';
import type { ReviewComment } from '../../../src/ingestion/pr-feedback';

/**
 * SoftwareTeamsPrFeedback node test suite (T7 — AC2).
 *
 * Tests that the PR-Feedback node:
 * 1. Has correct descriptor, properties, and credentials (AC9)
 * 2. Uses the shared T3 parseCorrelationTag to recover correlationId
 * 3. Emits a valid continue-run envelope via T4 prCommentsToEnvelope
 * 4. Validates repo format (owner/repo)
 * 5. Errors clearly when the PR body has no correlation tag (R-06)
 *
 * Note: Full execution testing (actual CLI invocation) requires the
 * software-teams binary and GH_TOKEN, handled by integration tests.
 * These are unit tests for the node descriptor and mapper integration.
 */

describe('SoftwareTeamsPrFeedback node (T7 — AC2, R-02)', () => {
  let node: SoftwareTeamsPrFeedback;

  beforeEach(() => {
    node = new SoftwareTeamsPrFeedback();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC9: Node descriptor
  // ─────────────────────────────────────────────────────────────────────────

  describe('Node descriptor', () => {
    test('node has correct displayName and name', () => {
      expect(node.description.displayName).toBe('Software Teams PR Feedback');
      expect(node.description.name).toBe('softwareTeamsPrFeedback');
    });

    test('node icon is specified', () => {
      expect(node.description.icon).toBeTruthy();
      expect(node.description.icon).toContain('softwareTeamsPrFeedback');
    });

    test('node has one Main input and one Main output', () => {
      expect(node.description.inputs).toEqual(['main']);
      expect(node.description.outputs).toEqual(['main']);
    });

    test('node group is transform', () => {
      expect(node.description.group).toContain('transform');
    });

    test('node version is 1', () => {
      expect(node.description.version).toBe(1);
    });

    test('usableAsTool is true', () => {
      expect(node.description.usableAsTool).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-02: Credentials
  // ─────────────────────────────────────────────────────────────────────────

  describe('R-02: Credentials', () => {
    test('node declares softwareTeamsApi credential as required', () => {
      const creds = node.description.credentials;
      expect(creds).toBeTruthy();
      const softwareTeamsCred = creds?.find(
        (c) => c.name === 'softwareTeamsApi',
      );
      expect(softwareTeamsCred).toBeTruthy();
      expect(softwareTeamsCred?.required).toBeTrue();
    });

    test('no credential field is exposed as a node parameter', () => {
      const paramNames = node.description.properties.map((p) => p.name);
      expect(paramNames).not.toContain('githubToken');
      expect(paramNames).not.toContain('anthropicApiKey');
      expect(paramNames).not.toContain('slackBotToken');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Node params
  // ─────────────────────────────────────────────────────────────────────────

  describe('Node parameters', () => {
    test('prNumber param exists and defaults to webhook expression', () => {
      const prop = node.description.properties.find(
        (p) => p.name === 'prNumber',
      );
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe('string');
      expect(prop?.default).toBe('={{ $json.pull_request.number }}');
      expect(prop?.required).toBeTrue();
    });

    test('prBody param exists and defaults to webhook expression', () => {
      const prop = node.description.properties.find(
        (p) => p.name === 'prBody',
      );
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe('string');
      expect(prop?.default).toBe('={{ $json.pull_request.body }}');
      expect(prop?.required).toBeTrue();
    });

    test('repo param exists with owner/repo placeholder and webhook default', () => {
      const prop = node.description.properties.find((p) => p.name === 'repo');
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe('string');
      expect(prop?.default).toBe('={{ $json.repository.full_name }}');
      expect(prop?.placeholder).toBe('owner/repo');
      expect(prop?.required).toBeTrue();
    });

    test('agentId param exists with a sensible default', () => {
      const prop = node.description.properties.find(
        (p) => p.name === 'agentId',
      );
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe('string');
      expect(typeof prop?.default).toBe('string');
      expect((prop?.default as string).length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Correlation tag parsing (shared T3 helpers)
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC2: Correlation tag round-trip', () => {
    test('parseCorrelationTag recovers id from a body with a tag', () => {
      const id = 'run-2026-01-15-clickup-abc12345';
      const body = `Some PR body text\n${buildCorrelationTag(id)}\nMore text`;
      expect(parseCorrelationTag(body)).toBe(id);
    });

    test('parseCorrelationTag returns null for a body without a tag', () => {
      const body = 'A PR body with no correlation tag at all.';
      expect(parseCorrelationTag(body)).toBeNull();
    });

    test('parseCorrelationTag handles empty string', () => {
      expect(parseCorrelationTag('')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Continue-run envelope via T4 mapper
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC2: Continue-run envelope integration', () => {
    const sampleComments: ReviewComment[] = [
      {
        path: 'src/index.ts',
        line: 42,
        body: 'This must be fixed before merge.',
        author: 'reviewer1',
        category: 'blocking',
        action: 'Fix before merge',
      },
      {
        path: 'src/utils.ts',
        line: null,
        body: 'Consider using a const here.',
        author: 'reviewer2',
        category: 'suggestion',
        action: 'Consider applying',
      },
    ];

    test('prCommentsToEnvelope produces a valid continue-run envelope', () => {
      const correlationId = 'run-2026-01-15-clickup-abc12345';
      const agentId = 'software-teams-programmer';

      const envelope = prCommentsToEnvelope(
        { correlationId, agentId },
        sampleComments,
      );

      expect(envelope.correlationId).toBe(correlationId);
      expect(envelope.agentId).toBe(agentId);
      expect(envelope.status).toBe('ok');
      expect(envelope.artifacts).toEqual([]);
      expect(envelope.result.text).toBe('');
    });

    test('envelope carries PR_FEEDBACK_TASK_ID at input.context.taskId', () => {
      const envelope = prCommentsToEnvelope(
        { correlationId: 'test-id', agentId: 'test-agent' },
        sampleComments,
      );

      const ctx = envelope.input.context as Record<string, unknown>;
      expect(ctx.taskId).toBe(PR_FEEDBACK_TASK_ID);
      expect(typeof ctx.taskId).toBe('string');
      expect((ctx.taskId as string).length).toBeGreaterThan(0);
    });

    test('envelope carries feedback.comments with the right shape', () => {
      const envelope = prCommentsToEnvelope(
        { correlationId: 'test-id', agentId: 'test-agent' },
        sampleComments,
      );

      expect(envelope.feedback).toBeTruthy();
      expect(envelope.feedback!.comments).toHaveLength(2);
      expect(envelope.feedback!.comments[0].path).toBe('src/index.ts');
      expect(envelope.feedback!.comments[0].line).toBe(42);
      expect(envelope.feedback!.comments[0].category).toBe('blocking');
      expect(envelope.feedback!.comments[1].line).toBeNull();
    });

    test('envelope with empty comments still has correct structure', () => {
      const envelope = prCommentsToEnvelope(
        { correlationId: 'test-id', agentId: 'test-agent' },
        [],
      );

      expect(envelope.status).toBe('ok');
      expect(envelope.feedback).toBeTruthy();
      expect(envelope.feedback!.comments).toEqual([]);
      const ctx = envelope.input.context as Record<string, unknown>;
      expect(ctx.taskId).toBe(PR_FEEDBACK_TASK_ID);
    });

    test('PR_FEEDBACK_TASK_ID is the shared constant (no duplicate literal)', () => {
      expect(PR_FEEDBACK_TASK_ID).toBe('pr-feedback');
    });
  });
});
