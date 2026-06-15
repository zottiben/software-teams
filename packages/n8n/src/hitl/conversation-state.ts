import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { NodeEnvelope } from '@websitelabs/software-teams';

/** Supported HITL delivery channels. */
export type HitlChannel = 'slack' | 'email' | 'notify' | 'discord';

/** All the state the HITL node needs to resume a parked run. */
export interface ConversationState {
  correlationId: string;
  originalEnvelope: NodeEnvelope;
  slackChannel: string;
  slackThreadTs: string;
  resumeUrl: string;
  question: string;
  createdAt: number;

  /**
   * Which delivery channel this conversation is using.
   * Optional for back-compat — omitted states are implicitly Slack.
   */
  channel?: HitlChannel;

  /**
   * Current round number (1-based). Omitted states default to round 1.
   * Callers increment via `nextRound()` and re-save to continue the loop.
   */
  round?: number;

  /**
   * Generic bag for non-Slack channel delivery coordinates (e.g. Discord
   * channel/message id, email thread id). Avoids adding new top-level
   * fields for every channel.
   */
  delivery?: Record<string, unknown>;
}

type StateStore = Record<string, ConversationState>;

/** Resolve the path for the JSON state file. */
export function getStorePath(): string {
  return (
    process.env['HITL_STATE_PATH'] ??
    join(homedir(), '.n8n', 'software-teams-hitl-state.json')
  );
}

function readStore(): StateStore {
  const path = getStorePath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as StateStore;
  } catch {
    return {};
  }
}

function writeStore(store: StateStore): void {
  const path = getStorePath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}

/** Persist a conversation state record keyed by `correlationId`. */
export function saveState(state: ConversationState): void {
  const store = readStore();
  store[state.correlationId] = state;
  writeStore(store);
}

/** Load the conversation state for `correlationId`. Returns `null` if not found. */
export function loadState(correlationId: string): ConversationState | null {
  const store = readStore();
  return store[correlationId] ?? null;
}

/** Remove the conversation state for `correlationId` after a successful resume. */
export function deleteState(correlationId: string): void {
  const store = readStore();
  if (!(correlationId in store)) return;
  delete store[correlationId];
  writeStore(store);
}

/** Return all stored states (useful for auditing / expiry sweeps). */
export function allStates(): ConversationState[] {
  return Object.values(readStore());
}

/**
 * Return the next round number for a conversation state.
 * States with no `round` field are treated as round 1, so the next is 2.
 */
export function nextRound(state: ConversationState): number {
  return (state.round ?? 1) + 1;
}
