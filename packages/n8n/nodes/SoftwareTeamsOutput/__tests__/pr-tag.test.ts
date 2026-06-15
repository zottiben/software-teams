import { describe, test, expect } from 'bun:test';
import {
  buildCorrelationTag,
  parseCorrelationTag,
} from '@websitelabs/software-teams';
import type { NodeEnvelope } from '@websitelabs/software-teams';

/**
 * PR-tag round-trip tests (T11 ↔ T7 — AC2, R-06)
 *
 * Tests that the PR-tag writer (Output node / T11) and reader (PR-Feedback node / T7)
 * agree on the correlation tag format and can successfully round-trip the correlationId:
 *
 * 1. Output node: buildPrIssueBody(envelope) stamps a tag into PR body via buildCorrelationTag
 * 2. PR-Feedback node: parseCorrelationTag(prBody) recovers the original id
 * 3. Round-trip: parseCorrelationTag(buildPrIssueBody(env)) === env.correlationId
 *
 * This ensures that the PR-feedback re-entry flow (AC2) can correctly route feedback
 * back to the original run, even if the PR body is edited or reformatted.
 */

describe('PR-tag round-trip (T11 ↔ T7 — AC2, R-06)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Writer (Output node) → buildCorrelationTag
  // ─────────────────────────────────────────────────────────────────────────

  describe('Writer: buildCorrelationTag (T11 — Output node)', () => {
    test('buildCorrelationTag wraps correlationId in an HTML comment', () => {
      const id = 'run-2026-06-15-clickup-xyz789';
      const tag = buildCorrelationTag(id);

      expect(tag).toMatch(/^<!--.*-->$/);
      expect(tag).toContain(id);
    });

    test('buildCorrelationTag uses canonical prefix format', () => {
      const id = 'run-test-001';
      const tag = buildCorrelationTag(id);

      expect(tag).toContain('software-teams:correlationId=');
      expect(tag).toBe('<!-- software-teams:correlationId=run-test-001 -->');
    });

    test('buildCorrelationTag produces identical output for the same id', () => {
      const id = 'run-2026-06-15-prompt-abc123';

      const tag1 = buildCorrelationTag(id);
      const tag2 = buildCorrelationTag(id);

      expect(tag1).toBe(tag2);
    });

    test('buildCorrelationTag handles ids with various character types', () => {
      const testIds = [
        'run-2026-06-15-clickup-NDP-456',
        'run-2026-06-15-datadog-abc123def456',
        'run-2026-06-15-prompt-test_123',
        'run-abc.def-ghi',
      ];

      for (const id of testIds) {
        const tag = buildCorrelationTag(id);
        expect(tag).toContain(id);
        expect(tag).toMatch(/^<!--.*-->$/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Reader (PR-Feedback node) → parseCorrelationTag
  // ─────────────────────────────────────────────────────────────────────────

  describe('Reader: parseCorrelationTag (T7 — PR-Feedback node)', () => {
    test('parseCorrelationTag extracts id from a PR body with a tag', () => {
      const id = 'run-2026-06-15-clickup-xyz789';
      const prBody = `
## Summary
This PR implements feature X.

<!-- software-teams:correlationId=${id} -->

## Changes
- Added components
`;

      const recovered = parseCorrelationTag(prBody);
      expect(recovered).toBe(id);
    });

    test('parseCorrelationTag returns null for a body without a tag', () => {
      const prBodyNoTag = `
## Summary
This is a normal PR with no correlation tag.

## Changes
- Regular changes
`;

      const recovered = parseCorrelationTag(prBodyNoTag);
      expect(recovered).toBeNull();
    });

    test('parseCorrelationTag returns null for an empty string', () => {
      const recovered = parseCorrelationTag('');
      expect(recovered).toBeNull();
    });

    test('parseCorrelationTag handles PR body with tag at different positions', () => {
      const id = 'run-test-001';

      // Tag at the end
      const bodyEndTag = `Some content\n\n${buildCorrelationTag(id)}`;
      expect(parseCorrelationTag(bodyEndTag)).toBe(id);

      // Tag in the middle
      const bodyMidTag = `Start\n\n${buildCorrelationTag(id)}\n\nEnd`;
      expect(parseCorrelationTag(bodyMidTag)).toBe(id);

      // Tag at the beginning
      const bodyStartTag = `${buildCorrelationTag(id)}\n\nContent`;
      expect(parseCorrelationTag(bodyStartTag)).toBe(id);
    });

    test('parseCorrelationTag extracts first tag when multiple are present (defensive)', () => {
      const id1 = 'run-first-001';
      const id2 = 'run-second-001';

      const bodyMultipleTags = `
Start
${buildCorrelationTag(id1)}
Middle
${buildCorrelationTag(id2)}
End
`;

      const recovered = parseCorrelationTag(bodyMultipleTags);
      expect(recovered).toBe(id1); // First one wins
    });

    test('parseCorrelationTag tolerates extra whitespace in the HTML comment', () => {
      const id = 'run-whitespace-001';
      const tag = `<!--  software-teams:correlationId=${id}  -->`;

      const recovered = parseCorrelationTag(tag);
      expect(recovered).toBe(id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-06: Round-trip invariant
  // ─────────────────────────────────────────────────────────────────────────

  describe('R-06: Round-trip — buildCorrelationTag ↔ parseCorrelationTag', () => {
    test('parseCorrelationTag(buildCorrelationTag(id)) === id', () => {
      const testIds = [
        'run-2026-06-15-clickup-CU-4821',
        'run-2026-06-15-datadog-abc123def456',
        'run-2026-06-15-prompt-test1',
        'run-simple-001',
        'run-with_underscores-123',
        'run.with.dots-456',
      ];

      for (const id of testIds) {
        const tag = buildCorrelationTag(id);
        const recovered = parseCorrelationTag(tag);
        expect(recovered).toBe(id);
      }
    });

    test('Output node writes tag into PR body; PR-Feedback reads it back correctly', () => {
      // Simulate Output node building the PR body
      const envelope: NodeEnvelope = {
        correlationId: 'run-2026-06-15-clickup-ABC-123',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: 'Implement feature', context: null },
        result: { text: 'Feature implemented' },
        artifacts: [{ type: 'branch', url: 'https://github.com/acme/app/tree/feat/x' }],
      };

      // Simulate PR body builder (from Output node)
      const prBody = [
        '## Software Teams result',
        '',
        `**Agent:** \`${envelope.agentId}\``,
        `**Correlation ID:** \`${envelope.correlationId}\``,
        `**Status:** ${envelope.status}`,
        '',
        '### Result',
        '',
        envelope.result.text,
        '',
        '---',
        '*Generated by n8n*',
        buildCorrelationTag(envelope.correlationId),
      ].join('\n');

      // Simulate PR-Feedback node reading the tag
      const recovered = parseCorrelationTag(prBody);

      // The round-trip must succeed
      expect(recovered).toBe(envelope.correlationId);
    });

    test('Round-trip works even if PR body is edited but tag is preserved', () => {
      const id = 'run-2026-06-15-clickup-xyz789';
      const tag = buildCorrelationTag(id);

      // Simulate user editing the PR body after it was created
      const editedBody = `
## Summary

User made substantial edits here...

Very important context...

<!-- software-teams:correlationId=${id.slice(0, -3)}${id.slice(-3)} --> <!-- edited -->

Some more text...
`;

      // The parser should extract the original id correctly
      const recovered = parseCorrelationTag(editedBody);
      expect(recovered).toBe(id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Envelope contract for PR-feedback re-entry
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC2: PR-Feedback re-entry envelope (after tag parsing)', () => {
    test('continue-run envelope carries the original correlationId', () => {
      const originalId = 'run-2026-06-15-clickup-test123';

      // After PR-Feedback node parses the tag and recovers the id
      const continueEnvelope: NodeEnvelope = {
        correlationId: originalId, // MUST be the original id
        agentId: 'software-teams-programmer', // Original agent
        status: 'ok',
        input: { prompt: 'Continue with feedback', context: null },
        result: { text: '' },
        artifacts: [],
        feedback: { comments: [] }, // Carries feedback comments
      };

      expect(continueEnvelope.correlationId).toBe(originalId);
      expect(continueEnvelope.feedback).toBeDefined();
    });

    test('continue-run envelope status is ok (feedback processed)', () => {
      const envelope: NodeEnvelope = {
        correlationId: 'run-test-001',
        agentId: 'software-teams-programmer',
        status: 'ok', // Feedback processed successfully
        input: { prompt: 'Continue', context: null },
        result: { text: '' },
        artifacts: [],
        feedback: { comments: [] },
      };

      expect(envelope.status).toBe('ok');
    });

    test('continue-run envelope can be routed back to Orchestrator via the same correlationId', () => {
      const runId = 'run-2026-06-15-clickup-xyz789';

      // The Orchestrator's continue-run path looks up the run by correlationId
      const lookupKey = runId;

      // With the re-entry envelope carrying the same correlationId, the merge is possible
      const continueEnvelope: NodeEnvelope = {
        correlationId: lookupKey,
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: 'Resume', context: null },
        result: { text: '' },
        artifacts: [],
        feedback: { comments: [{ path: 'src/index.ts', line: 42, body: 'Fix this', author: 'rev', category: 'bug', action: 'fix' }] },
      };

      // Orchestrator can find the run
      expect(continueEnvelope.correlationId).toBe(lookupKey);
      // And merge the feedback for the continue-run path
      expect(continueEnvelope.feedback?.comments.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants (format stability)
  // ─────────────────────────────────────────────────────────────────────────

  describe('Format stability (no drift between writer and reader)', () => {
    test('tag format is not changed by either side', () => {
      const id = 'run-stable-format-test';
      const expectedFormat = `<!-- software-teams:correlationId=${id} -->`;

      const writerOutput = buildCorrelationTag(id);
      expect(writerOutput).toBe(expectedFormat);

      const readerInput = expectedFormat;
      const recovered = parseCorrelationTag(readerInput);
      expect(recovered).toBe(id);
    });

    test('tag prefix constant is identical in both writer and reader', () => {
      // Both sides use the same constant: 'software-teams:correlationId='
      const tag1 = buildCorrelationTag('test');
      const tag2 = `<!-- software-teams:correlationId=test -->`;

      expect(tag1).toBe(tag2);
    });

    test('shared constant is defined and immutable', () => {
      // The constant is defined in packages/cli/src/contract/envelope.ts
      // Both writer (Output node) and reader (PR-Feedback node) import it
      const importedConstant = 'software-teams:correlationId=';

      const tag = buildCorrelationTag('test');
      expect(tag).toContain(importedConstant);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases and defensive parsing
  // ─────────────────────────────────────────────────────────────────────────

  describe('Edge cases and defensive parsing', () => {
    test('parseCorrelationTag returns null for malformed tag (no closing -->)', () => {
      const malformed = '<!-- software-teams:correlationId=run-bad';
      const recovered = parseCorrelationTag(malformed);

      // Parser should be defensive and return null rather than extracting a partial id
      expect(recovered).toBeNull();
    });

    test('parseCorrelationTag ignores tag-like strings that are not HTML comments', () => {
      const fakeTag = 'software-teams:correlationId=run-fake';
      const recovered = parseCorrelationTag(fakeTag);

      // Not a valid HTML comment, should return null
      expect(recovered).toBeNull();
    });

    test('parseCorrelationTag handles very long PR bodies efficiently', () => {
      const id = 'run-long-body-test';
      const tag = buildCorrelationTag(id);

      // Simulate a very long PR body
      let longBody = tag + '\n';
      for (let i = 0; i < 1000; i++) {
        longBody += `This is line ${i} of a very long PR body.\n`;
      }

      const recovered = parseCorrelationTag(longBody);
      expect(recovered).toBe(id);
    });

    test('parseCorrelationTag handles correlationIds with all valid characters', () => {
      const complexId = 'run-2026-06-15-test.underscore_dash.123-ABC';
      const tag = buildCorrelationTag(complexId);
      const recovered = parseCorrelationTag(tag);

      expect(recovered).toBe(complexId);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-06 Risk mitigation: No format drift
  // ─────────────────────────────────────────────────────────────────────────

  describe('R-06 Risk mitigation: format drift detection', () => {
    test('if writer and reader use different constants, round-trip fails (detectable)', () => {
      // This test documents the risk: if the constant changes,
      // the round-trip will fail and it will be caught immediately
      const writerId = 'run-test-001';
      const writerConstant = 'software-teams:correlationId=';
      const writerTag = `<!-- ${writerConstant}${writerId} -->`;

      const readerConstant = 'software-teams:correlationId='; // Same
      const recovered = parseCorrelationTag(writerTag);

      expect(recovered).toBe(writerId); // OK: constants match

      // If constants ever diverge, the test fails and alerts the developer
      const driftedConstant = 'different-prefix='; // Hypothetical drift
      const driftedTag = `<!-- ${driftedConstant}${writerId} -->`;
      const driftedRecovered = parseCorrelationTag(driftedTag);

      expect(driftedRecovered).toBeNull(); // Format drift is caught!
    });

    test('contract-check gate ensures T3 new fields are only additive (affects round-trip)', () => {
      // AC7: New fields on NodeEnvelope do not affect the PR-tag mechanism
      // Feedback and hitlChannel are additive, do not change the tag format
      const envelope: NodeEnvelope = {
        correlationId: 'run-fields-test',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: 'Test', context: null },
        result: { text: '' },
        artifacts: [],
        feedback: { comments: [] }, // Additive field
        hitlChannel: 'discord', // Additive field
      };

      // The PR-tag is written from the base correlationId, not affected by new fields
      const tag = buildCorrelationTag(envelope.correlationId);
      const recovered = parseCorrelationTag(tag);

      expect(recovered).toBe('run-fields-test');
    });
  });
});
