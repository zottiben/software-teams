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

  return [
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, "<jwt>"],
    [/\b\d{3}-\d{2}-\d{4}\b/g, "<ssn>"],
    [/\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, "<card>"],
    [/\b\d{16}\b/g, "<card>"],
    [/\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}(?!\w)/g, "<phone>"],
    [/(?<!\w)\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\w)/g, "<phone>"],
    [/\b[A-Za-z0-9_-]{60,}\b/g, "<long-token>"],
    [/\b\d{8,}\b/g, "<id>"],
  ].reduce<string>((acc, [pattern, replacement]) => acc.replace(pattern as RegExp, replacement as string), text);
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
