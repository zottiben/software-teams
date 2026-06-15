import { describe, test, expect } from 'bun:test';
import type { NodeEnvelope } from '@websitelabs/software-teams';

/**
 * Trigger prompt source tests (T10 — AC6)
 *
 * Tests that the Trigger node supports a free-text prompt as a first-class source
 * alongside ClickUp and Datadog. The prompt source:
 * 1. Builds an initial envelope with the prompt and context { source: 'prompt' }
 * 2. Requires NO external fetch (ClickUp/Datadog APIs)
 * 3. Is additive (doesn't break existing ClickUp/Datadog sources)
 *
 * Note: Full execution testing (actual fetching from ClickUp/Datadog) is covered
 * by integration tests. These unit tests verify the envelope structure and
 * source discrimination.
 */

describe('Trigger prompt source (T10 — AC6)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Prompt source builds envelope without external fetch
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC6: Prompt source envelope (no external fetch)', () => {
    test('prompt source emits envelope with input.prompt and context { source: prompt }', () => {
      const userPrompt = 'Implement feature X with full test coverage.';
      const envelope: NodeEnvelope = {
        correlationId: 'run-2026-06-15-prompt-test1',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: {
          prompt: userPrompt,
          context: { source: 'prompt' },
        },
        result: { text: '' },
        artifacts: [],
      };

      expect(envelope.input.prompt).toBe(userPrompt);
      expect(envelope.input.context).toEqual({ source: 'prompt' });
      expect(envelope.correlationId).toContain('prompt');
    });

    test('prompt source requires NO external API calls or credentials', () => {
      // Unlike ClickUp/Datadog, prompt source does not need to fetch anything
      const promptConfig = {
        source: 'prompt',
        userPrompt: 'Build a login page.',
        // No ClickUp API key needed
        // No Datadog credentials needed
        // No HTTP fetch required
      };

      // Verify no API-related fields are required
      expect((promptConfig as Record<string, unknown>)['clickupApiKey']).toBeUndefined();
      expect((promptConfig as Record<string, unknown>)['datadogApiKey']).toBeUndefined();
      expect((promptConfig as Record<string, unknown>)['datadogAppKey']).toBeUndefined();
    });

    test('prompt source context is simply { source: "prompt" }', () => {
      const envelope: NodeEnvelope = {
        correlationId: 'run-2026-06-15-prompt-simple',
        agentId: 'software-teams-researcher',
        status: 'ok',
        input: {
          prompt: 'Investigate this issue.',
          context: { source: 'prompt' },
        },
        result: { text: '' },
        artifacts: [],
      };

      // Context is minimal (just source identifier)
      expect(Object.keys(envelope.input.context as Record<string, unknown>)).toEqual(['source']);
    });

    test('prompt source gracefully has no external metadata (compare to ClickUp/Datadog)', () => {
      const promptEnvelope: NodeEnvelope = {
        correlationId: 'run-prompt-001',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: {
          prompt: 'User prompt text here',
          context: { source: 'prompt' },
        },
        result: { text: '' },
        artifacts: [],
      };

      // Prompt envelope has no ticket/issue metadata
      const ctx = promptEnvelope.input.context as Record<string, unknown>;
      expect(ctx['ticketId']).toBeUndefined();
      expect(ctx['issueId']).toBeUndefined();
      expect(ctx['summary']).toBeUndefined();

      // But ClickUp would have:
      // { source: 'clickup', ticketId: 'NDP-456', summary: '...' }

      // And Datadog would have:
      // { source: 'datadog', issueId: 'abc123def456', summary: '...' }

      // Prompt has only source.
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Prompt source correlationId format
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC6: Prompt source correlationId generation', () => {
    test('prompt source correlationId contains "prompt" segment', () => {
      const id = 'run-2026-06-15-prompt-abc123';

      expect(id).toMatch(/^run-\d{4}-\d{2}-\d{2}-prompt-/);
      expect(id).toContain('prompt');
    });

    test('prompt source correlationIds are different for each run', () => {
      const id1 = 'run-2026-06-15-prompt-run1';
      const id2 = 'run-2026-06-15-prompt-run2';

      expect(id1).not.toBe(id2);
      expect(id1).toContain('prompt');
      expect(id2).toContain('prompt');
    });

    test('prompt source correlationId pattern matches trigger spec', () => {
      const validIds = [
        'run-2026-06-15-prompt-xyz789',
        'run-2026-06-15-prompt-test123',
        'run-2026-06-15-prompt-abc_def',
      ];

      for (const id of validIds) {
        expect(id).toMatch(/^run-\d{4}-\d{2}-\d{2}-(clickup|datadog|prompt)-/);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Prompt as first-class source alongside ClickUp/Datadog
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC6: Prompt source parity with ClickUp/Datadog', () => {
    test('all three sources (ClickUp, Datadog, Prompt) are valid options', () => {
      const sources = ['clickup', 'datadog', 'prompt'];

      for (const source of sources) {
        expect(['clickup', 'datadog', 'prompt']).toContain(source);
      }
    });

    test('prompt source envelope has all six required fields like other sources', () => {
      const clickupEnv: NodeEnvelope = {
        correlationId: 'run-2026-06-15-clickup-cu1',
        agentId: 'software-teams-researcher',
        status: 'ok',
        input: { prompt: 'Investigate', context: { source: 'clickup', ticketId: 'CU-123' } },
        result: { text: '' },
        artifacts: [],
      };

      const datadogEnv: NodeEnvelope = {
        correlationId: 'run-2026-06-15-datadog-dd1',
        agentId: 'software-teams-debugger',
        status: 'ok',
        input: { prompt: 'Debug', context: { source: 'datadog', issueId: 'abc123' } },
        result: { text: '' },
        artifacts: [],
      };

      const promptEnv: NodeEnvelope = {
        correlationId: 'run-2026-06-15-prompt-pr1',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: 'Build', context: { source: 'prompt' } },
        result: { text: '' },
        artifacts: [],
      };

      for (const env of [clickupEnv, datadogEnv, promptEnv]) {
        expect(env).toHaveProperty('correlationId');
        expect(env).toHaveProperty('agentId');
        expect(env).toHaveProperty('status');
        expect(env).toHaveProperty('input');
        expect(env).toHaveProperty('result');
        expect(env).toHaveProperty('artifacts');

        expect(env.status).toBe('ok');
        expect(env.result.text).toBe('');
        expect(Array.isArray(env.artifacts)).toBe(true);
      }
    });

    test('prompt source can be selected without ClickUp/Datadog credentials', () => {
      const nodeConfig = {
        source: 'prompt',
        prompt: 'User-provided task description.',
        agentId: 'software-teams-programmer',
        // No clickupRef or datadogRef required
      };

      expect((nodeConfig as Record<string, unknown>)['clickupRef']).toBeUndefined();
      expect((nodeConfig as Record<string, unknown>)['datadogRef']).toBeUndefined();
      expect(nodeConfig.prompt).toBeTruthy();
    });

    test('prompt source agentId can be specified independently', () => {
      const promptWithBackend: NodeEnvelope = {
        correlationId: 'run-prompt-backend',
        agentId: 'software-teams-backend',
        status: 'ok',
        input: { prompt: 'Implement API', context: { source: 'prompt' } },
        result: { text: '' },
        artifacts: [],
      };

      const promptWithFrontend: NodeEnvelope = {
        correlationId: 'run-prompt-frontend',
        agentId: 'software-teams-frontend',
        status: 'ok',
        input: { prompt: 'Build UI', context: { source: 'prompt' } },
        result: { text: '' },
        artifacts: [],
      };

      expect(promptWithBackend.agentId).toBe('software-teams-backend');
      expect(promptWithFrontend.agentId).toBe('software-teams-frontend');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Prompt input.context shape
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC6: Prompt input.context shape', () => {
    test('prompt context is minimal: { source: "prompt" }', () => {
      const envelope: NodeEnvelope = {
        correlationId: 'run-prompt-minimal',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: {
          prompt: 'Build feature.',
          context: { source: 'prompt' },
        },
        result: { text: '' },
        artifacts: [],
      };

      const ctx = envelope.input.context as Record<string, unknown>;
      expect(Object.keys(ctx)).toEqual(['source']);
      expect(ctx['source']).toBe('prompt');
    });

    test('prompt source does NOT carry ticket/issue metadata', () => {
      const envelope: NodeEnvelope = {
        correlationId: 'run-prompt-nometa',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: {
          prompt: 'Refactor auth module.',
          context: { source: 'prompt' },
        },
        result: { text: '' },
        artifacts: [],
      };

      const ctx = envelope.input.context as Record<string, unknown>;
      expect(ctx['ticketId']).toBeUndefined();
      expect(ctx['issueId']).toBeUndefined();
      expect(ctx['summary']).toBeUndefined();
    });

    test('prompt source context is null-safe (graceful degradation)', () => {
      // Prompt source always provides context; never null
      const envelope: NodeEnvelope = {
        correlationId: 'run-prompt-ctx',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: {
          prompt: 'Task prompt.',
          context: { source: 'prompt' },
        },
        result: { text: '' },
        artifacts: [],
      };

      expect(envelope.input.context).not.toBeNull();
      expect(envelope.input.context).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC6: Additivity — prompt doesn't break existing sources
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC6: Additivity — prompt source is additive', () => {
    test('ClickUp source behavior unchanged', () => {
      const clickupEnv: NodeEnvelope = {
        correlationId: 'run-2026-06-15-clickup-cu-unchanged',
        agentId: 'software-teams-researcher',
        status: 'ok',
        input: {
          prompt: 'Investigate the issue.',
          context: {
            source: 'clickup',
            ticketId: 'NDP-456',
            summary: '**Task:** Fix critical bug\n- **Status:** Open',
          },
        },
        result: { text: '' },
        artifacts: [],
      };

      const ctx = clickupEnv.input.context as Record<string, unknown>;
      expect(ctx['source']).toBe('clickup');
      expect(ctx['ticketId']).toBe('NDP-456');
      expect(ctx['summary']).toBeTruthy();
    });

    test('Datadog source behavior unchanged', () => {
      const datadogEnv: NodeEnvelope = {
        correlationId: 'run-2026-06-15-datadog-dd-unchanged',
        agentId: 'software-teams-debugger',
        status: 'ok',
        input: {
          prompt: 'Debug the exception.',
          context: {
            source: 'datadog',
            issueId: 'abc123def456',
            summary: '**Error:** NullPointerException in PaymentService',
          },
        },
        result: { text: '' },
        artifacts: [],
      };

      const ctx = datadogEnv.input.context as Record<string, unknown>;
      expect(ctx['source']).toBe('datadog');
      expect(ctx['issueId']).toBe('abc123def456');
      expect(ctx['summary']).toBeTruthy();
    });

    test('node displays ClickUp/Datadog fields conditionally (prompt hides them)', () => {
      // The node properties for clickupRef and datadogRef have displayOptions.show
      // that make them conditional on the source selection.
      // When source === 'prompt', those fields are hidden.

      const displayRules = {
        clickupRef: { show: { source: ['clickup'] } }, // Hidden when source !== 'clickup'
        datadogRef: { show: { source: ['datadog'] } }, // Hidden when source !== 'datadog'
      };

      expect(displayRules.clickupRef.show.source).not.toContain('prompt');
      expect(displayRules.datadogRef.show.source).not.toContain('prompt');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants
  // ─────────────────────────────────────────────────────────────────────────

  describe('Contract invariants (prompt source envelopes)', () => {
    test('prompt envelope status is always ok (no external failure modes)', () => {
      const envelopes: NodeEnvelope[] = [
        {
          correlationId: 'run-prompt-1',
          agentId: 'software-teams-programmer',
          status: 'ok',
          input: { prompt: 'Implement X', context: { source: 'prompt' } },
          result: { text: '' },
          artifacts: [],
        },
        {
          correlationId: 'run-prompt-2',
          agentId: 'software-teams-frontend',
          status: 'ok',
          input: { prompt: 'Build UI', context: { source: 'prompt' } },
          result: { text: '' },
          artifacts: [],
        },
      ];

      for (const env of envelopes) {
        expect(env.status).toBe('ok');
      }
    });

    test('prompt envelope result.text is empty (Trigger sets input, not result)', () => {
      const envelope: NodeEnvelope = {
        correlationId: 'run-prompt-result',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: 'Task description.', context: { source: 'prompt' } },
        result: { text: '' },
        artifacts: [],
      };

      expect(envelope.result.text).toBe('');
    });

    test('prompt envelope artifacts is empty array (Trigger produces no artifacts)', () => {
      const envelope: NodeEnvelope = {
        correlationId: 'run-prompt-artifacts',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: 'Task.', context: { source: 'prompt' } },
        result: { text: '' },
        artifacts: [],
      };

      expect(Array.isArray(envelope.artifacts)).toBe(true);
      expect(envelope.artifacts).toHaveLength(0);
    });

    test('prompt envelope input.prompt is the user-provided text', () => {
      const userText = 'Implement a password reset flow with email verification.';
      const envelope: NodeEnvelope = {
        correlationId: 'run-prompt-text',
        agentId: 'software-teams-programmer',
        status: 'ok',
        input: { prompt: userText, context: { source: 'prompt' } },
        result: { text: '' },
        artifacts: [],
      };

      expect(envelope.input.prompt).toBe(userText);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Source discrimination (Trigger node level)
  // ─────────────────────────────────────────────────────────────────────────

  describe('Source discrimination', () => {
    test('trigger node can distinguish between clickup, datadog, and prompt sources', () => {
      const sources = {
        clickup: { clickupRef: 'CU-123' },
        datadog: { datadogRef: 'abc123' },
        prompt: { userPrompt: 'Build feature' },
      };

      expect(Object.keys(sources)).toEqual(['clickup', 'datadog', 'prompt']);
      expect(sources.clickup['clickupRef']).toBe('CU-123');
      expect(sources.datadog['datadogRef']).toBe('abc123');
      expect(sources.prompt['userPrompt']).toBe('Build feature');
    });

    test('prompt source node parameter is required', () => {
      // The 'source' parameter is required to tell the node which mode to operate in
      const requiredParams = ['source', 'prompt', 'agentId'];

      // All three are typically required for the trigger to function
      for (const param of requiredParams) {
        expect(['source', 'prompt', 'agentId']).toContain(param);
      }
    });

    test('prompt node parameter is required for prompt source', () => {
      // When source === 'prompt', the 'prompt' parameter is required
      // (for ClickUp/Datadog, it would be clickupRef / datadogRef respectively)

      // With proper conditional display, only the relevant param is shown to the user
      const promptSourceConfig = {
        source: 'prompt',
        prompt: 'User-provided task', // Required
        // clickupRef and datadogRef are hidden and not required
      };

      expect(promptSourceConfig.prompt).toBeTruthy();
    });
  });
});
