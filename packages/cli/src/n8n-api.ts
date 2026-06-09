/**
 * Node-safe public API for @websitelabs/n8n-nodes-software-teams.
 *
 * This module is compiled to CommonJS (lib/) by tsconfig.node.json and
 * consumed by the n8n community node package at both build time (types)
 * and runtime (require()). It exports ONLY utilities that work under
 * Node.js >=18 — no Bun-specific APIs.
 *
 * Claude-CLI spawning is intentionally excluded. n8n/src/execution/single-turn.ts
 * implements its own Node-compatible spawn using child_process.
 */

export {
  extractClickUpRef,
  extractClickUpId,
  fetchClickUpTicket,
  formatTicketAsContext,
} from "./utils/clickup";
export type { ClickUpRef, ClickUpTicket } from "./utils/clickup";

export {
  extractDatadogIssue,
  fetchDatadogIssue,
  formatDatadogAsContext,
} from "./utils/datadog";
export type { DatadogIssue, DatadogStackFrame } from "./utils/datadog";

export { scrubPII } from "./utils/pii-scrubber";

export { sanitizeUserInput, fenceUserInput } from "./utils/sanitize";

export {
  DEFAULT_ALLOWED_TOOLS,
  SINGLE_TURN_ALLOWED_TOOLS,
} from "./shared/agent-tools";

export { slugify } from "./shared/slugify";

export type { NodeEnvelope, ArtifactRef } from "./contract/envelope";
