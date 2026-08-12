/**
 * The shape of a `claude -p --output-format json` result, and how to read its
 * terminal state.
 *
 * Node-safe (no Bun APIs) so the n8n package can consume it across the
 * workspace boundary.
 *
 * Why this matters for unattended work: a support queue needs to tell apart
 * "this ticket failed" from "this worker ran out of allowance, try again after
 * the window resets". Both surface as a non-zero-ish result today, and treating
 * the second as the first burns the ticket. The terminal states below are read
 * from the fields Claude Code actually sets, verified on 2.1.220.
 */

/** Per-model usage and cost breakdown from the result payload. */
export interface ClaudeModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly costUSD?: number;
  readonly canonicalModel?: string;
}

/**
 * The `type: "result"` object emitted as the final line of a `claude -p` run.
 * Only the fields Software Teams reads are declared; the payload carries more.
 */
export interface ClaudeResultPayload {
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly result?: string | null;
  readonly structured_output?: unknown;
  readonly session_id?: string;
  readonly total_cost_usd?: number;
  readonly num_turns?: number;
  readonly stop_reason?: string;
  readonly terminal_reason?: string;
  readonly api_error_status?: number | null;
  readonly modelUsage?: Record<string, ClaudeModelUsage>;
  readonly permission_denials?: readonly unknown[];
}

/**
 * How a run ended, in terms the caller can act on.
 *
 * - `ok`             completed normally
 * - `needs-input`    the agent asked a question and is waiting on a human
 * - `budget`         hit the per-run spend cap
 * - `turns`          hit the per-run turn cap
 * - `usage-limit`    the account's five-hour or weekly allowance is exhausted
 * - `auth`           the credential is missing, expired, or rejected
 * - `error`          anything else
 *
 * `budget`, `turns`, and `usage-limit` are all retryable, but only
 * `usage-limit` is retryable *without changing anything* - it just needs time.
 */
export type ClaudeTerminalState =
  | "ok"
  | "needs-input"
  | "budget"
  | "turns"
  | "usage-limit"
  | "auth"
  | "error";

/**
 * Verified terminal signals (Claude Code 2.1.220):
 *   budget cap  -> subtype `error_max_budget_usd`, terminal_reason `budget_exhausted`
 *   turn cap    -> subtype `error_max_turns`,      terminal_reason `max_turns`
 *   success     -> subtype `success`,              terminal_reason `completed`
 *
 * The budget cap is enforced between turns, not mid-turn, so a run can and does
 * overshoot the cap it was given. Treat it as a brake, not a guarantee.
 */
const BUDGET_SUBTYPE = "error_max_budget_usd";
const TURNS_SUBTYPE = "error_max_turns";

/**
 * Usage-limit and auth failures arrive as prose rather than a dedicated
 * subtype, so they are matched on the message. Kept narrow and anchored on
 * Anthropic's own wording to avoid classifying an unrelated error as retryable.
 */
const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /hit your (session|weekly|usage) limit/i,
  /usage limit reached/i,
  /rate.?limit/i,
];

const AUTH_PATTERNS: readonly RegExp[] = [
  /not logged in/i,
  /login expired/i,
  /oauth (access )?token is invalid/i,
  /failed to authenticate/i,
  /invalid.{0,20}api key/i,
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * Classify a completed run.
 *
 * `text` is the run's visible output, which for a failure is often the only
 * place the reason appears - `result` is `null` on a budget stop, and an auth
 * failure is printed rather than structured.
 */
export function classifyResult(
  payload: ClaudeResultPayload | undefined,
  text: string,
): ClaudeTerminalState {
  if (payload?.subtype === BUDGET_SUBTYPE) return "budget";
  if (payload?.subtype === TURNS_SUBTYPE) return "turns";

  const haystack = `${text}\n${payload?.result ?? ""}`;
  if (matchesAny(haystack, AUTH_PATTERNS)) return "auth";
  if (matchesAny(haystack, USAGE_LIMIT_PATTERNS)) return "usage-limit";

  // 429 is the wire-level form of an exhausted allowance.
  if (payload?.api_error_status === 429) return "usage-limit";
  if (payload?.api_error_status === 401 || payload?.api_error_status === 403) return "auth";

  if (payload?.is_error === true) return "error";
  return "ok";
}

/**
 * True when the state will likely clear on its own, given time.
 *
 * A workflow should park and re-run the same ticket rather than marking it
 * failed. Budget and turn caps are excluded: they clear only if the caller
 * raises the cap, so retrying unchanged just burns the allowance again.
 */
export function isRetryableLater(state: ClaudeTerminalState): boolean {
  return state === "usage-limit";
}

/** Total spend for a run, or 0 when the payload did not report it. */
export function totalCostUsd(payload: ClaudeResultPayload | undefined): number {
  return typeof payload?.total_cost_usd === "number" ? payload.total_cost_usd : 0;
}
