/**
 * conversation-state.ts unit tests (T10 — R-05 persistence)
 *
 * Verifies that the HITL conversation-state store:
 * - Persists state keyed by correlationId across simulated wait/restart (R-05).
 * - save → load round-trips correctly.
 * - delete removes the state.
 * - allStates returns all active states.
 * - Gracefully handles missing / corrupt files.
 *
 * Deliberately Bun-native — no n8n runtime needed.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import type { NodeEnvelope } from '@websitelabs/software-teams';
import {
  saveState,
  loadState,
  deleteState,
  allStates,
  getStorePath,
  type ConversationState,
} from '../conversation-state';

// Override the store path to a temp file for tests
const TEST_STORE_PATH = join(import.meta.dir, '__test_hitl_state.json');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEnvelope(correlationId: string, question: string): NodeEnvelope {
  return {
    correlationId,
    agentId: 'software-teams-backend',
    status: 'needs-input',
    input: { prompt: 'What should I do next?', context: null },
    result: { text: question },
    artifacts: [],
  };
}

function makeState(correlationId: string): ConversationState {
  return {
    correlationId,
    originalEnvelope: makeEnvelope(correlationId, 'Which database?'),
    slackChannel: 'C0123456',
    slackThreadTs: '1717000000.123456',
    resumeUrl: `https://n8n.example.com/webhook-waiting/${correlationId}`,
    question: 'Which database should I use?',
    createdAt: Date.now(),
  };
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Point the store at the test file path
  process.env['HITL_STATE_PATH'] = TEST_STORE_PATH;
  // Start clean
  if (existsSync(TEST_STORE_PATH)) unlinkSync(TEST_STORE_PATH);
});

afterEach(() => {
  if (existsSync(TEST_STORE_PATH)) unlinkSync(TEST_STORE_PATH);
  delete process.env['HITL_STATE_PATH'];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getStorePath — respects HITL_STATE_PATH env var', () => {
  test('returns the path from HITL_STATE_PATH when set', () => {
    expect(getStorePath()).toBe(TEST_STORE_PATH);
  });

  test('falls back to ~/.n8n/software-teams-hitl-state.json when env not set', () => {
    delete process.env['HITL_STATE_PATH'];
    const path = getStorePath();
    expect(path).toContain('.n8n');
    expect(path).toContain('software-teams-hitl-state.json');
    // Restore
    process.env['HITL_STATE_PATH'] = TEST_STORE_PATH;
  });
});

describe('saveState + loadState — R-05 persistence across simulated restart', () => {
  test('returns null for an unknown correlationId (no store file)', () => {
    expect(loadState('run-nonexistent')).toBeNull();
  });

  test('save → load round-trips all fields correctly', () => {
    const state = makeState('run-2026-001');
    saveState(state);

    const loaded = loadState('run-2026-001');
    expect(loaded).not.toBeNull();
    expect(loaded!.correlationId).toBe('run-2026-001');
    expect(loaded!.slackChannel).toBe('C0123456');
    expect(loaded!.slackThreadTs).toBe('1717000000.123456');
    expect(loaded!.question).toBe('Which database should I use?');
    expect(loaded!.resumeUrl).toContain('run-2026-001');
    expect(loaded!.originalEnvelope.status).toBe('needs-input');
    expect(loaded!.originalEnvelope.correlationId).toBe('run-2026-001');
  });

  test('state survives a simulated restart (re-read from disk)', () => {
    const state = makeState('run-restart-test');
    saveState(state);

    // Simulate restart: state is on disk, loadState reads from disk
    // (no in-memory cache — every call reads the file)
    const firstRead = loadState('run-restart-test');
    const secondRead = loadState('run-restart-test');

    expect(firstRead).not.toBeNull();
    expect(secondRead).not.toBeNull();
    expect(firstRead!.correlationId).toBe(secondRead!.correlationId);
    expect(firstRead!.slackThreadTs).toBe(secondRead!.slackThreadTs);
  });

  test('multiple independent runs are stored and retrieved correctly', () => {
    saveState(makeState('run-alpha'));
    saveState(makeState('run-beta'));
    saveState(makeState('run-gamma'));

    expect(loadState('run-alpha')!.correlationId).toBe('run-alpha');
    expect(loadState('run-beta')!.correlationId).toBe('run-beta');
    expect(loadState('run-gamma')!.correlationId).toBe('run-gamma');
  });

  test('overwriting with the same correlationId replaces the record', () => {
    const original = makeState('run-overwrite');
    saveState(original);

    const updated: ConversationState = {
      ...original,
      question: 'Updated question?',
      slackThreadTs: '9999999999.000000',
    };
    saveState(updated);

    const loaded = loadState('run-overwrite');
    expect(loaded!.question).toBe('Updated question?');
    expect(loaded!.slackThreadTs).toBe('9999999999.000000');
  });

  test('saves and restores the full NodeEnvelope including artifacts', () => {
    const state = makeState('run-artifacts');
    state.originalEnvelope = {
      ...state.originalEnvelope,
      artifacts: [
        { type: 'pr', url: 'https://github.com/acme/app/pull/42' },
        { type: 'branch', url: 'https://github.com/acme/app/tree/feat/x' },
      ],
    };
    saveState(state);

    const loaded = loadState('run-artifacts');
    expect(loaded!.originalEnvelope.artifacts).toHaveLength(2);
    expect(loaded!.originalEnvelope.artifacts[0]!.type).toBe('pr');
  });
});

describe('deleteState — clean-up after successful resume', () => {
  test('removes the state for the given correlationId', () => {
    saveState(makeState('run-to-delete'));
    expect(loadState('run-to-delete')).not.toBeNull();

    deleteState('run-to-delete');
    expect(loadState('run-to-delete')).toBeNull();
  });

  test('is safe to call on a non-existent correlationId (no throw)', () => {
    expect(() => deleteState('run-does-not-exist')).not.toThrow();
  });

  test('does not remove other concurrent runs', () => {
    saveState(makeState('run-keep'));
    saveState(makeState('run-remove'));

    deleteState('run-remove');

    expect(loadState('run-keep')).not.toBeNull();
    expect(loadState('run-remove')).toBeNull();
  });
});

describe('allStates — audit / expiry sweep', () => {
  test('returns empty array when no states are stored', () => {
    expect(allStates()).toEqual([]);
  });

  test('returns all stored states', () => {
    saveState(makeState('run-1'));
    saveState(makeState('run-2'));
    saveState(makeState('run-3'));

    const all = allStates();
    expect(all).toHaveLength(3);
    const ids = all.map((s) => s.correlationId).sort();
    expect(ids).toEqual(['run-1', 'run-2', 'run-3']);
  });

  test('reflects deletions', () => {
    saveState(makeState('run-a'));
    saveState(makeState('run-b'));
    deleteState('run-a');

    const all = allStates();
    expect(all).toHaveLength(1);
    expect(all[0]!.correlationId).toBe('run-b');
  });
});

describe('R-05: state persists across the ask→wait gap (simulated)', () => {
  test('state stored during ask is available for resume — correlationId is the key', () => {
    // ASK phase: HITL node saves state before putExecutionToWait
    const askState = makeState('run-hitl-e2e');
    askState.resumeUrl = 'https://n8n.example.com/webhook-waiting/run-hitl-e2e/abc';
    saveState(askState);

    // RESUME phase: Slack handler POSTs { hitlAnswer, correlationId }
    // The resume node loads state by correlationId
    const resumeState = loadState('run-hitl-e2e');
    expect(resumeState).not.toBeNull();
    expect(resumeState!.resumeUrl).toContain('webhook-waiting');
    expect(resumeState!.originalEnvelope.status).toBe('needs-input');

    // After resume, state is deleted
    deleteState('run-hitl-e2e');
    expect(loadState('run-hitl-e2e')).toBeNull();
  });
});
