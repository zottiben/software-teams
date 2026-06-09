/**
 * Persistent conversation-state store for the Slack HITL state machine.
 *
 * Keyed by `correlationId` (the stable run/conversation ID from the
 * inter-node data contract). State is written to a JSON file so it
 * **survives n8n worker restarts** (R-05).
 *
 * Storage path: `HITL_STATE_PATH` env var, or
 *   `{HOME}/.n8n/software-teams-hitl-state.json` by default.
 *
 * Deliberately Bun-free — uses only Node.js `fs`, `path`, `os` — so this
 * module can be unit-tested in plain Bun/Node without any n8n runtime.
 *
 * Contract reference: n8n/CONTRACT.md §5 (needs-input), n8n/CONTRACT.md §1
 * (correlationId carry-through). Feeds T10 (Slack HITL state machine).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { NodeEnvelope } from '../contract/envelope';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** All the state the HITL node needs to resume a parked run. */
export interface ConversationState {
  /** The stable run id — the join key across nodes and runs. */
  correlationId: string;
  /** The envelope that arrived with status 'needs-input'. Restored on resume. */
  originalEnvelope: NodeEnvelope;
  /** Slack channel the question was posted to (for threaded replies). */
  slackChannel: string;
  /** Slack message ts from the original chat.postMessage (for threading). */
  slackThreadTs: string;
  /** Signed n8n resume URL — the target the Slack handler must POST to. */
  resumeUrl: string;
  /** The agent's question text (extracted from result.text). */
  question: string;
  /** Unix ms timestamp when the ask was made (expiry accounting). */
  createdAt: number;
}

/** The shape stored on disk. */
type StateStore = Record<string, ConversationState>;

// --------------------------------------------------------------------------
// Path resolution
// --------------------------------------------------------------------------

/** Resolve the path for the JSON state file. */
export function getStorePath(): string {
  return (
    process.env['HITL_STATE_PATH'] ??
    join(homedir(), '.n8n', 'software-teams-hitl-state.json')
  );
}

// --------------------------------------------------------------------------
// Internal I/O helpers
// --------------------------------------------------------------------------

function readStore(): StateStore {
  const path = getStorePath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as StateStore;
  } catch {
    // Corrupted / empty file — start fresh
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

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Persist a conversation state record keyed by `correlationId`.
 * Overwrites any existing record for the same key.
 */
export function saveState(state: ConversationState): void {
  const store = readStore();
  store[state.correlationId] = state;
  writeStore(store);
}

/**
 * Load the conversation state for `correlationId`.
 * Returns `null` if not found (handles missing/stale records gracefully).
 */
export function loadState(correlationId: string): ConversationState | null {
  const store = readStore();
  return store[correlationId] ?? null;
}

/**
 * Remove the conversation state for `correlationId` after a successful resume.
 * Safe to call even when the key is absent.
 */
export function deleteState(correlationId: string): void {
  const store = readStore();
  if (!(correlationId in store)) return;
  delete store[correlationId];
  writeStore(store);
}

/**
 * Return all stored states (useful for auditing / expiry sweeps).
 */
export function allStates(): ConversationState[] {
  return Object.values(readStore());
}
