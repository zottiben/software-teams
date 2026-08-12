/**
 * Read the auth configuration out of a decrypted n8n credential.
 *
 * Shared by every node so they cannot disagree about which credential is in
 * use. The returned object is passed down to the spawn layer, which builds the
 * child environment from it - deliberately NOT written to `process.env`, since
 * an n8n worker is long-lived and shared and a mutation there leaks into every
 * later execution on that worker.
 */

/** Credential fields relevant to authentication. */
export interface AuthCredentialFields {
  authMode?: unknown;
  claudeCodeOauthToken?: unknown;
  anthropicApiKey?: unknown;
}

export interface ResolvedAuth {
  readonly mode: "subscription" | "apiKey";
  readonly oauthToken?: string;
  readonly apiKey?: string;
}

/**
 * Resolve the auth mode and its secret.
 *
 * Defaults to `subscription`, which is the mode that exists so that running a
 * Claude Code instance per node bills a Claude plan rather than the API.
 */
export function authFromCredentials(credentials: AuthCredentialFields): ResolvedAuth {
  const mode = credentials.authMode === "apiKey" ? "apiKey" : "subscription";

  if (mode === "apiKey") {
    return {
      mode,
      ...(typeof credentials.anthropicApiKey === "string"
        ? { apiKey: credentials.anthropicApiKey }
        : {}),
    };
  }

  return {
    mode,
    ...(typeof credentials.claudeCodeOauthToken === "string"
      ? { oauthToken: credentials.claudeCodeOauthToken }
      : {}),
  };
}
