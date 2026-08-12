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
export type { ClickUpRef, ClickUpTicket, ClickUpFetchOptions } from "./utils/clickup";

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
  SINGLE_TURN_DISALLOWED_TOOLS,
} from "./shared/agent-tools";

export {
  buildAuthEnv,
  assertAuthEnv,
  describeAuthMismatch,
  ClaudeAuthError,
} from "./shared/claude-auth";
export type { ClaudeAuthConfig, ClaudeAuthMode, ClaudeAuthStatus } from "./shared/claude-auth";

export {
  classifyResult,
  isRetryableLater,
  totalCostUsd,
} from "./shared/claude-result";
export type {
  ClaudeResultPayload,
  ClaudeTerminalState,
  ClaudeModelUsage,
} from "./shared/claude-result";

export {
  CLAUDE_CODE_TOOLS,
  EFFORT_LEVELS,
  MODEL_ALIASES,
  N8N_DEFAULT_MODEL,
  N8N_EFFORT_OPTIONS,
  N8N_MODEL_OPTIONS,
  isValidModel,
  isValidToolName,
  withStructuredOutput,
  STRUCTURED_OUTPUT_TOOL,
} from "./shared/claude-code-surface";

export { slugify } from "./shared/slugify";

export {
  CORRELATION_TAG_PREFIX,
  buildCorrelationTag,
  parseCorrelationTag,
} from "./contract/envelope";
export type {
  NodeEnvelope,
  ArtifactRef,
  RepoDescriptor,
  ChangeRef,
  FeedbackComment,
  AuditEvent,
} from "./contract/envelope";
