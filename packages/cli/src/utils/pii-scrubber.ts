/**
 * PII scrubber for external context that lands in agent prompts.
 *
 * Any text fetched from production-facing sources (Datadog error
 * messages, ClickUp ticket descriptions, anywhere else we add later)
 * is run through this scrubber before being added to the agent's
 * prompt. The goal is defence-in-depth: even when we already restrict
 * WHICH fields we fetch (whitelist), individual field values can carry
 * interpolated user data, so we redact a conservative set of
 * PII-shaped patterns.
 *
 * Design choices:
 *   - Over-scrub rather than under-scrub. False positives (an internal
 *     6-digit error code becoming `<id>`) are fine; false negatives are
 *     not. The agent still has the surrounding code context, so a
 *     redacted value rarely blocks investigation.
 *   - Replacement tokens are visible (`<email>`, `<phone>`, …) so a
 *     reviewer auditing the prompt post-hoc can see exactly what was
 *     scrubbed, and the agent knows not to invent the original value.
 *   - Order matters — longer / more specific patterns run before
 *     shorter ones so we don't double-scrub (e.g. JWT before long-id,
 *     SSN before generic numeric ID).
 */

/**
 * Replace PII-shaped substrings in `text` with visible scrub markers.
 * Returns the scrubbed text and a count of replacements made (useful
 * for tests + telemetry, but optional to inspect).
 */
export function scrubPII(text: string): string {
  if (!text) return text;

  let out = text;

  // Email addresses — RFC-loose pattern, good enough for redaction.
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>");

  // JWT tokens — eyJ-prefixed b64 strings with at least two dot-separated parts.
  // Run before generic long-id so JWTs get the specific marker.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, "<jwt>");

  // US SSN (NNN-NN-NNNN). Specific shape — run before generic numeric ID.
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "<ssn>");

  // Credit-card-shaped digit groups: 4-4-4-4 with separators (very specific).
  out = out.replace(/\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, "<card>");

  // Bare 16-digit cards (no separators). Tight on length so we don't
  // catch 40-char hashes or arbitrary numeric IDs.
  out = out.replace(/\b\d{16}\b/g, "<card>");

  // Phone numbers — international (+CC) or US-formatted with separators.
  // Use lookaround instead of `\b` because `\b` fails for the `(555)`
  // form (the char before `(` is whitespace, not a word char).
  out = out.replace(/\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}(?!\w)/g, "<phone>");
  out = out.replace(/(?<!\w)\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\w)/g, "<phone>");

  // Long token-like strings (60+ alphanumeric with mixed case) — captures
  // API tokens, session IDs, GitHub PATs. Tighter than 40 to avoid
  // catching long file hashes that don't carry user data.
  out = out.replace(/\b[A-Za-z0-9_-]{60,}\b/g, "<long-token>");

  // Generic numeric IDs (8+ consecutive digits) — captures customer
  // IDs, account numbers, anything sequential. Looser bound than card
  // to catch shorter customer IDs but tight enough to spare line
  // numbers, error codes (4-7 digits usually).
  out = out.replace(/\b\d{8,}\b/g, "<id>");

  return out;
}

/**
 * Convenience: list of all scrub markers this module produces. Useful
 * for tests that want to assert "no raw PII pattern remains" without
 * hardcoding individual markers.
 */
export const SCRUB_MARKERS = [
  "<email>",
  "<phone>",
  "<card>",
  "<ssn>",
  "<jwt>",
  "<long-token>",
  "<id>",
] as const;
