/**
 * Secret redaction utility.
 *
 * Applied only to text that crosses the stdout/stderr boundary or lands in
 * error messages. NEVER applied to prompts sent to providers — redacting
 * prompts would corrupt them.
 */

/** Patterns that identify secrets and how to replace them. */
const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // api_key=<token> / api-key: <token> / apikey=<token>
  {
    pattern: /\bapi[-_]?key\s*[:=]\s*\S+/gi,
    replacement: "api_key=***REDACTED***",
  },
  // Authorization: Bearer <token>
  {
    pattern: /Bearer\s+\S+/g,
    replacement: "Bearer ***REDACTED***",
  },
  // Common API key prefixes: sk-, xai-, moon-
  {
    pattern: /\b(sk|xai|moon)-[A-Za-z0-9_-]{16,}\b/g,
    replacement: "***REDACTED***",
  },
];

/**
 * Replace known secret patterns in `input` with `***REDACTED***`.
 *
 * Safe to call multiple times (idempotent on already-redacted output).
 * Does NOT modify prompts — callers must not pass prompt text here.
 */
export function redact(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
