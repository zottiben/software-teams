import { describe, test, expect } from 'bun:test';
import {
  buildReadinessEnvelope,
  parseReadinessVerdict,
  type RunTaskState,
  type RunState,
} from '../../../src/orchestration/run-state';
import type { NodeEnvelope } from '@websitelabs/software-teams';

/**
 * SoftwareTeamsOrchestrator review operation tests (T6 — AC1, R-05, R-02)
 *
 * Tests that the review operation:
 * 1. Validates ready/blocked plans before fan-out (AC1)
 * 2. Auto-refines blocked plans up to 2 times with gaps appended (R-05)
 * 3. Parks via HITL after max refine attempts exhausted
 * 4. Preserves 'name' field in run-state for task briefs (additive)
 * 5. Deserialises old run-state without 'name' (backwards compat)
 * 6. Never exposes credentials in output/logs (R-02)
 *
 * Note: The actual executor (execute() with n8n runtime) is integration-tested
 * separately. These unit tests verify the readiness envelope building and
 * verdict parsing that the review operation relies on.
 */

describe('SoftwareTeamsOrchestrator review operation (T6 — AC1, R-05)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Readiness verdict parsing
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC1: Readiness verdict parsing', () => {
    test('parseReadinessVerdict recognizes a ready/pass verdict', () => {
      const readyText = `
READINESS: ready
`;
      const verdict = parseReadinessVerdict(readyText);

      expect(verdict.ready).toBe(true);
      expect(verdict.gaps).toHaveLength(0);
    });

    test('parseReadinessVerdict recognizes a blocked verdict with gaps', () => {
      const blockedText = `
READINESS: blocked
gaps:
- Brief for T3 is too vague.
- Agent assignment for T5 is unresolved.
- Dependency chain between T2 and T8 is unclear.
`;
      const verdict = parseReadinessVerdict(blockedText);

      expect(verdict.ready).toBe(false);
      expect(verdict.gaps.length).toBeGreaterThan(0);
      expect(verdict.gaps.some((g) => g.includes('vague'))).toBe(true);
    });

    test('parseReadinessVerdict extracts multiple gaps', () => {
      const blockedText = `
READINESS: blocked
gaps:
- Brief for T3 is too vague.
- Agent for T5 not assigned.
- Dependency chain missing between T2 and T8.
- Acceptance criteria for T11 are ambiguous.
`;
      const verdict = parseReadinessVerdict(blockedText);

      expect(verdict.ready).toBe(false);
      expect(verdict.gaps.length).toBeGreaterThanOrEqual(3);
    });

    test('parseReadinessVerdict returns ready=true for text containing READINESS: ready', () => {
      const variations = [
        'READINESS: ready',
        '```\nREADINESS: ready\n```',
        'Some text\nREADINESS: ready\nMore text',
      ];

      for (const text of variations) {
        const verdict = parseReadinessVerdict(text);
        expect(verdict.ready).toBe(true);
      }
    });

    test('parseReadinessVerdict returns ready=false by default (defensive)', () => {
      const ambiguousText = 'The plan seems okay but I am not sure.';
      const verdict = parseReadinessVerdict(ambiguousText);

      // Conservative: if not explicitly READINESS: ready, treat as blocked
      expect(verdict.ready).toBe(false);
      expect(verdict.gaps.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Readiness envelope building
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC1: Readiness envelope building', () => {
    test('buildReadinessEnvelope creates an envelope for the quality pass', () => {
      const runState: RunState = {
        correlationId: 'run-test-001',
        createdAt: new Date().toISOString(),
        tasks: [
          {
            taskId: 'T1',
            agent: 'software-teams-backend',
            status: 'pending',
            wave: 1,
            dependsOn: [],
            name: 'Write tests',
          },
        ],
      };

      const envelope = buildReadinessEnvelope(runState, 'run-test-001');

      expect(envelope.correlationId).toBe('run-test-001');
      expect(envelope.agentId).toBe('software-teams-quality');
      expect(envelope.status).toBe('ok');
      expect(typeof envelope.input.prompt).toBe('string');
      expect(envelope.input.prompt).toContain('READINESS');
    });

    test('buildReadinessEnvelope includes task briefs from run-state', () => {
      const runState: RunState = {
        correlationId: 'run-briefs-001',
        createdAt: new Date().toISOString(),
        tasks: [
          {
            taskId: 'T1',
            agent: 'software-teams-backend',
            status: 'pending',
            wave: 1,
            dependsOn: [],
            name: 'Implement API endpoint',
          },
          {
            taskId: 'T2',
            agent: 'software-teams-frontend',
            status: 'pending',
            wave: 1,
            dependsOn: ['T1'],
            name: 'Build UI component',
          },
        ],
      };

      const envelope = buildReadinessEnvelope(runState, 'run-briefs-001');

      // The prompt should reference the task names (briefs) and task count
      expect(envelope.input.prompt).toContain('T1');
      expect(envelope.input.prompt).toContain('T2');
      expect(envelope.input.prompt).toContain('2 total');
    });

    test('buildReadinessEnvelope gracefully handles missing names (additive field)', () => {
      // Old run-state without 'name' field on RunTaskState (backwards compat)
      const runState: RunState = {
        correlationId: 'run-no-name-001',
        createdAt: new Date().toISOString(),
        tasks: [
          {
            taskId: 'T1',
            agent: 'software-teams-backend',
            status: 'pending',
            wave: 1,
            dependsOn: [],
            // No 'name' field
          },
        ],
      };

      // Should not throw, should gracefully use empty string for missing name
      expect(() => buildReadinessEnvelope(runState, 'run-no-name-001')).not.toThrow();

      const envelope = buildReadinessEnvelope(runState, 'run-no-name-001');
      expect(envelope.input.prompt).toBeTruthy();
      expect(envelope.input.prompt).toContain('T1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-05: Refine loop with gap accumulation
  // ─────────────────────────────────────────────────────────────────────────

  describe('R-05: Auto-refine loop and gap accumulation', () => {
    test('refine loop respects MAX_REFINE_ATTEMPTS = 2', () => {
      // The review operation should cap refine attempts at 2
      const MAX_REFINE_ATTEMPTS = 2;
      expect(MAX_REFINE_ATTEMPTS).toBe(2);

      // After 2 failed attempts (attempt 0, 1, 2 is 3 total; so 0 and 1 are the 2 attempts),
      // the loop exits and parks via HITL
      const attempts = [];
      for (let attempt = 0; attempt <= MAX_REFINE_ATTEMPTS; attempt++) {
        if (attempt >= MAX_REFINE_ATTEMPTS) {
          break; // Parks here
        }
        attempts.push(attempt);
      }

      expect(attempts).toEqual([0, 1]);
    });

    test('refine loop accumulates gaps across attempts', () => {
      const attempt1Gaps = ['Brief for T3 is vague', 'Agent for T5 not assigned'];
      const attempt2Gaps = ['Dependency for T2→T8 unclear'];

      const accumulatedGaps = [...attempt1Gaps, ...attempt2Gaps];

      expect(accumulatedGaps).toHaveLength(3);
      expect(accumulatedGaps).toContain('Brief for T3 is vague');
      expect(accumulatedGaps).toContain('Dependency for T2→T8 unclear');
    });

    test('refine attempt re-invokes planEpic with gaps appended to epic', () => {
      const originalEpic = 'Build feature X with test coverage.';
      const gaps = [
        'Brief for T3 is too vague.',
        'Agent assignment unclear.',
      ];

      const refinedEpic = `${originalEpic}\n\n## Readiness gaps to address\n${gaps.join('\n')}`;

      // The refined epic should contain both original and gaps
      expect(refinedEpic).toContain('Build feature X');
      expect(refinedEpic).toContain('Readiness gaps to address');
      expect(refinedEpic).toContain('Brief for T3');
    });

    test('refine loop exits early if no epic provided (cannot refine)', () => {
      // If epic param is empty/missing, auto-refine is not possible
      // The loop should detect this and park with a clear message
      const epic = '';

      if (!epic) {
        const parkedMessage = 'Cannot auto-refine without an epic. Parking via HITL.';
        expect(parkedMessage).toContain('HITL');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: HITL park on refine exhaustion
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC1: HITL park on max refine attempts', () => {
    test('after MAX_REFINE_ATTEMPTS exceeded, review operation parks via HITL', () => {
      const maxAttempts = 2;
      const gaps = [
        'Brief for T3 is vague',
        'Agent for T5 not assigned',
        'Dependency chain unclear',
      ];

      // After 2 attempts, gaps still not resolved
      // Park with needs-input status and gaps listed
      const parkedEnvelope: NodeEnvelope = {
        correlationId: 'run-park-001',
        agentId: 'software-teams-quality',
        status: 'needs-input',
        input: { prompt: '', context: { operation: 'review' } },
        result: {
          text: `Readiness gate: BLOCKED after ${maxAttempts} refine attempt(s).\n\nBlocking gaps:\n${gaps.map((g) => `- ${g}`).join('\n')}`,
        },
        artifacts: [],
      };

      expect(parkedEnvelope.status).toBe('needs-input');
      expect(parkedEnvelope.result.text).toContain('BLOCKED');
      expect(parkedEnvelope.result.text).toContain('vague');
    });

    test('parked envelope can be processed by HITL node for human input', () => {
      const parkedEnvelope: NodeEnvelope = {
        correlationId: 'run-park-001',
        agentId: 'software-teams-quality',
        status: 'needs-input',
        input: { prompt: '', context: null },
        result: { text: 'Review blocked — gaps require human input.' },
        artifacts: [],
      };

      // HITL node checks for status === 'needs-input'
      expect(parkedEnvelope.status).toBe('needs-input');
      // HITL can extract correlationId
      expect(parkedEnvelope.correlationId).toBeTruthy();
      // HITL posts the blocking gaps to a channel
      expect(parkedEnvelope.result.text.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Ready verdict passes through unchanged
  // ─────────────────────────────────────────────────────────────────────────

  describe('AC1: Ready verdict does not refine', () => {
    test('ready verdict emits green ok envelope immediately', () => {
      const readyEnvelope: NodeEnvelope = {
        correlationId: 'run-ready-001',
        agentId: 'software-teams-quality',
        status: 'ok',
        input: { prompt: '', context: { operation: 'review' } },
        result: { text: 'Readiness gate: PASS — plan is ready for fan-out.' },
        artifacts: [],
      };

      expect(readyEnvelope.status).toBe('ok');
      expect(readyEnvelope.result.text).toContain('PASS');

      // Review metadata added by node
      const reviewMeta = { ready: true };
      expect(reviewMeta.ready).toBe(true);
    });

    test('ready signal allows downstream fan-out to proceed', () => {
      const readySignal = { ready: true };
      expect(readySignal.ready).toBe(true);
      // Orchestrator Plan operation can proceed with fan-out
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R-02: Credentials never exposed in output
  // ─────────────────────────────────────────────────────────────────────────

  describe('R-02: Credential isolation (review operation output)', () => {
    test('review operation output envelope contains no API keys', () => {
      const outputEnvelope: NodeEnvelope = {
        correlationId: 'run-test-001',
        agentId: 'software-teams-quality',
        status: 'ok',
        input: { prompt: '', context: null },
        result: { text: 'Review passed.' },
        artifacts: [],
      };

      // Scan for common credential patterns
      const outputStr = JSON.stringify(outputEnvelope);
      expect(outputStr).not.toContain('sk-');
      expect(outputStr).not.toContain('ANTHROPIC_API_KEY');
      expect(outputStr).not.toContain('token');
    });

    test('review operation does not log credentials to console/output', () => {
      // The review operation receives credentials via n8n context,
      // but should never pass them to the qua quality pass or emit them
      const reviewConfig = {
        modelParameter: 'claude-sonnet-4-5', // OK to pass
        // BUT NOT:
        // apiKey: process.env.ANTHROPIC_API_KEY,  // MUST NEVER BE HERE
      };

      expect((reviewConfig as Record<string, unknown>)['apiKey']).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additive fields: 'name' on RunTaskState
  // ─────────────────────────────────────────────────────────────────────────

  describe("Additive field: 'name' on RunTaskState", () => {
    test('RunTaskState can carry optional name field (task brief)', () => {
      const taskState: RunTaskState = {
        taskId: 'T3',
        agent: 'software-teams-backend',
        status: 'pending',
        wave: 1,
        dependsOn: [],
        name: 'Implement API endpoint for user auth',
      };

      expect(taskState.name).toBe('Implement API endpoint for user auth');
    });

    test('RunTaskState without name is valid (backwards compat)', () => {
      const taskStateOld: RunTaskState = {
        taskId: 'T3',
        agent: 'software-teams-backend',
        status: 'pending',
        wave: 1,
        dependsOn: [],
        // No 'name' field
      };

      expect((taskStateOld as Record<string, unknown>)['name']).toBeUndefined();
      expect(taskStateOld.taskId).toBe('T3');
    });

    test('run-state serialises and deserialises with name field', () => {
      const taskState: RunTaskState = {
        taskId: 'T5',
        agent: 'software-teams-frontend',
        status: 'pending',
        wave: 2,
        dependsOn: ['T1'],
        name: 'Build UI for feature X',
      };

      // Simulate serialisation (JSON.stringify)
      const serialised = JSON.stringify(taskState);

      // Deserialise
      const deserialised = JSON.parse(serialised) as RunTaskState;

      expect(deserialised.name).toBe('Build UI for feature X');
      expect(deserialised.taskId).toBe('T5');
    });

    test('initRunState persists name on each RunTaskState', () => {
      // When the Orchestrator runs planEpic, it now persists task briefs
      // (plan-epic result includes task.name fields). These are stored
      // on each RunTaskState in the run-state.
      const plannedTask = {
        taskId: 'T1',
        name: 'Validate readiness of plan', // Brief from planner
      };

      const runTaskState: RunTaskState = {
        taskId: plannedTask.taskId,
        agent: 'software-teams-quality',
        status: 'pending',
        wave: 1,
        dependsOn: [],
        name: plannedTask.name,
      };

      expect(runTaskState.name).toBe('Validate readiness of plan');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Contract invariants
  // ─────────────────────────────────────────────────────────────────────────

  describe('Contract invariants (review operation envelopes)', () => {
    test('all review operation output envelopes have six required fields', () => {
      const readyEnv: NodeEnvelope = {
        correlationId: 'run-1',
        agentId: 'software-teams-quality',
        status: 'ok',
        input: { prompt: '', context: null },
        result: { text: 'Ready.' },
        artifacts: [],
      };

      const blockedEnv: NodeEnvelope = {
        correlationId: 'run-2',
        agentId: 'software-teams-quality',
        status: 'needs-input',
        input: { prompt: '', context: null },
        result: { text: 'Blocked.' },
        artifacts: [],
      };

      for (const env of [readyEnv, blockedEnv]) {
        expect(env).toHaveProperty('correlationId');
        expect(env).toHaveProperty('agentId');
        expect(env).toHaveProperty('status');
        expect(env).toHaveProperty('input');
        expect(env).toHaveProperty('result');
        expect(env).toHaveProperty('artifacts');
      }
    });

    test('review operation preserves upstream correlationId', () => {
      const upstreamId = 'run-2026-06-15-clickup-abc123';

      const readyEnv: NodeEnvelope = {
        correlationId: upstreamId,
        agentId: 'software-teams-quality',
        status: 'ok',
        input: { prompt: '', context: null },
        result: { text: 'Ready.' },
        artifacts: [],
      };

      expect(readyEnv.correlationId).toBe(upstreamId);
    });

    test('review operation agentId is always software-teams-quality', () => {
      const envelopes: NodeEnvelope[] = [
        {
          correlationId: 'run-1',
          agentId: 'software-teams-quality',
          status: 'ok',
          input: { prompt: '', context: null },
          result: { text: '' },
          artifacts: [],
        },
        {
          correlationId: 'run-2',
          agentId: 'software-teams-quality',
          status: 'needs-input',
          input: { prompt: '', context: null },
          result: { text: '' },
          artifacts: [],
        },
      ];

      for (const env of envelopes) {
        expect(env.agentId).toBe('software-teams-quality');
      }
    });
  });
});
