/**
 * Building the environment a headless `claude` process authenticates with.
 *
 * Node-safe (no Bun APIs) so the n8n package can consume it across the
 * workspace boundary.
 *
 * Claude Code's credential precedence (highest first):
 *   1. cloud provider vars (CLAUDE_CODE_USE_BEDROCK / _VERTEX / _FOUNDRY)
 *   2. ANTHROPIC_AUTH_TOKEN
 *   3. ANTHROPIC_API_KEY          <- outranks the subscription token
 *   4. apiKeyHelper
 *   5. CLAUDE_CODE_OAUTH_TOKEN    <- the subscription credential
 *   6. interactive /login credentials
 *
 * The hazard this module exists for: `ANTHROPIC_API_KEY` sits ABOVE the OAuth
 * token, and in `-p` mode the docs are explicit that the key "is always used
 * when present". An n8n worker with a stray key in its environment therefore
 * bills every ticket to the API while the operator believes their subscription
 * is being used. Nothing warns. The only defence is to construct the child
 * environment explicitly and delete the key.
 */

/** Which credential a spawned `claude` process should authenticate with. */
export type ClaudeAuthMode = "subscription" | "apiKey";

export interface ClaudeAuthConfig {
  readonly mode: ClaudeAuthMode;
  /** Long-lived OAuth token from `claude setup-token`. Required for `subscription`. */
  readonly oauthToken?: string;
  /** Anthropic API key. Required for `apiKey`. */
  readonly apiKey?: string;
}

export class ClaudeAuthError extends Error {}

/**
 * Env vars that would silently outrank, or quietly redirect, the credential we
 * intend to use. Stripped from the child environment in subscription mode.
 */
const OVERRIDING_AUTH_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

/**
 * Build the environment for a spawned `claude` process.
 *
 * Starts from `baseEnv` (normally `process.env`) and returns a NEW object -
 * the caller must never mutate the parent environment, because an n8n worker is
 * long-lived and shared, so a mutation leaks into every later execution.
 *
 * In `subscription` mode every higher-precedence credential var is removed, so
 * the OAuth token is genuinely the credential in use rather than merely
 * present.
 */
export function buildAuthEnv(
  config: ClaudeAuthConfig,
  baseEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...baseEnv };

  if (config.mode === "subscription") {
    const token = config.oauthToken?.trim();
    if (!token) {
      throw new ClaudeAuthError(
        "Subscription auth selected but no OAuth token was provided. " +
          "Generate one with `claude setup-token` on a machine with a browser, " +
          "then store it in the Software Teams credential.",
      );
    }

    for (const name of OVERRIDING_AUTH_VARS) delete env[name];
    env["CLAUDE_CODE_OAUTH_TOKEN"] = token;
    return env;
  }

  const key = config.apiKey?.trim();
  if (!key) {
    throw new ClaudeAuthError(
      "API-key auth selected but no Anthropic API key was provided.",
    );
  }

  delete env["CLAUDE_CODE_OAUTH_TOKEN"];
  env["ANTHROPIC_API_KEY"] = key;
  return env;
}

/**
 * Assert the built environment will actually authenticate the way it claims.
 *
 * Cheap, and it turns the silent-billing failure into a loud one at the moment
 * the environment is constructed rather than at the end of the month.
 */
export function assertAuthEnv(
  mode: ClaudeAuthMode,
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (mode !== "subscription") return;

  const offenders = OVERRIDING_AUTH_VARS.filter((name) => env[name]);
  if (offenders.length > 0) {
    throw new ClaudeAuthError(
      `Subscription auth would be overridden by ${offenders.join(", ")} in the spawn ` +
        "environment. These outrank CLAUDE_CODE_OAUTH_TOKEN, so the run would not use " +
        "the subscription.",
    );
  }

  if (!env["CLAUDE_CODE_OAUTH_TOKEN"]) {
    throw new ClaudeAuthError(
      "Subscription auth selected but CLAUDE_CODE_OAUTH_TOKEN is not set on the spawn " +
        "environment.",
    );
  }
}

/** Shape of `claude auth status --output-format json`, used by the credential test. */
export interface ClaudeAuthStatus {
  readonly loggedIn?: boolean;
  readonly authMethod?: string;
  readonly apiProvider?: string;
}

/**
 * Check a parsed `claude auth status` against the mode we asked for.
 *
 * Returns an error message, or `null` when the credential is good. Asserting
 * the METHOD rather than just `loggedIn` is the point: a worker with a stray
 * API key reports `loggedIn: true` while quietly using the wrong credential.
 */
export function describeAuthMismatch(
  mode: ClaudeAuthMode,
  status: ClaudeAuthStatus,
): string | null {
  if (!status.loggedIn) {
    return (
      "Claude Code reports it is not logged in. " +
      (mode === "subscription"
        ? "Check the OAuth token; `claude setup-token` issues one valid for a year."
        : "Check the Anthropic API key.")
    );
  }

  const expected = mode === "subscription" ? "oauth_token" : "api_key";
  if (status.authMethod && status.authMethod !== expected) {
    return (
      `Expected auth method "${expected}" but the worker is using "${status.authMethod}". ` +
      (mode === "subscription"
        ? "An ANTHROPIC_API_KEY in the worker environment outranks the subscription token, " +
          "so runs would bill the API instead of the subscription."
        : "Another credential is taking precedence over the API key.")
    );
  }

  return null;
}
