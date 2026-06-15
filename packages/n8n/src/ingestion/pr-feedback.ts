/**
 * PR-feedback ingestion — continue-marker constant + comments-to-envelope mapper.
 *
 * Pure, Bun-free, side-effect-free module. Safe to import in Node/n8n and in
 * unit tests. T7 (the PR-Feedback node) imports `PR_FEEDBACK_TASK_ID` and
 * `prCommentsToEnvelope` from here — no duplicate literals.
 *
 * Plan 1-01 T4 — AC2 (PR-feedback re-entry).
 */

import type { NodeEnvelope, FeedbackComment } from "@websitelabs/software-teams";

// ---------------------------------------------------------------------------
// Continue-run marker
// ---------------------------------------------------------------------------

/**
 * The continue-run marker string written to `input.context.taskId` so the
 * Orchestrator continue branch (`SoftwareTeamsOrchestrator.node.ts:163-181`,
 * keys on `typeof ctx?.taskId === 'string'`) re-enters the run.
 *
 * T7 imports this same constant — no second literal.
 */
export const PR_FEEDBACK_TASK_ID = "pr-feedback";

// ---------------------------------------------------------------------------
// ReviewComment — local mirror of the CLI shape (dep-light)
// ---------------------------------------------------------------------------

/**
 * Shape emitted by `feedback --json`. Mirrors `ReviewComment` in
 * `packages/cli/src/commands/feedback.ts` without creating a runtime import
 * dependency on the CLI package (which uses Bun APIs).
 */
export interface ReviewComment {
  path: string;
  line: number | null;
  body: string;
  author: string;
  category: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Build a continue-run `NodeEnvelope` from categorised PR review comments.
 *
 * The returned envelope satisfies the Orchestrator's continue branch:
 * - `correlationId` matches the original run (supplied via `base.correlationId`)
 * - `input.context.taskId` is a non-empty string (`PR_FEEDBACK_TASK_ID`)
 * - `status` is `'ok'`
 * - `feedback.comments` carries the categorised review comments
 *
 * The caller (T7 — the PR-Feedback node) supplies the real `correlationId`
 * parsed from the PR-tag and the `agentId` that should handle the feedback.
 */
export function prCommentsToEnvelope(
  base: { correlationId: string; agentId: string },
  comments: readonly ReviewComment[],
): NodeEnvelope {
  const blocking = comments.filter((c) => c.category === "blocking");
  const changeRequests = comments.filter((c) => c.category === "change_request");
  const questions = comments.filter((c) => c.category === "question");
  const suggestions = comments.filter((c) => c.category === "suggestion");
  const nitpicks = comments.filter((c) => c.category === "nitpick");

  const lines: string[] = [
    "Address the following PR review feedback:",
  ];

  if (blocking.length > 0) {
    lines.push(`- ${blocking.length} blocking issue(s) — must fix before merge`);
  }
  if (changeRequests.length > 0) {
    lines.push(`- ${changeRequests.length} change request(s) — apply requested changes`);
  }
  if (questions.length > 0) {
    lines.push(`- ${questions.length} question(s) — respond with clarification`);
  }
  if (suggestions.length > 0) {
    lines.push(`- ${suggestions.length} suggestion(s) — consider applying`);
  }
  if (nitpicks.length > 0) {
    lines.push(`- ${nitpicks.length} nitpick(s) — optional fixes`);
  }

  const feedbackComments: FeedbackComment[] = comments.map((c) => ({
    path: c.path,
    line: c.line,
    body: c.body,
    author: c.author,
    category: c.category,
    action: c.action,
  }));

  return {
    correlationId: base.correlationId,
    agentId: base.agentId,
    status: "ok",
    input: {
      prompt: lines.join("\n"),
      context: { taskId: PR_FEEDBACK_TASK_ID },
    },
    result: { text: "" },
    artifacts: [],
    feedback: { comments: feedbackComments },
  };
}
