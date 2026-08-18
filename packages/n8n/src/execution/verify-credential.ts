/**
 * Credential verification: does this worker actually authenticate the way the
 * credential says it does?
 *
 * Runs `claude auth status`, which reports `{ loggedIn, authMethod,
 * apiProvider }` as JSON, and checks the METHOD rather than just whether a
 * login exists. That distinction is the whole point: a worker with a stray
 * `ANTHROPIC_API_KEY` reports `loggedIn: true` while quietly billing the API
 * instead of the configured subscription, because the key outranks the OAuth
 * token in Claude Code's credential precedence.
 */

import { parseMcpConfig } from "./mcp-config";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedApi = require("@websitelabs/software-teams") as {
  buildAuthEnv: (
    config: { mode: string; oauthToken?: string; apiKey?: string },
    baseEnv: Readonly<Record<string, string | undefined>>,
  ) => Record<string, string | undefined>;
  describeAuthMismatch: (
    mode: string,
    status: { loggedIn?: boolean; authMethod?: string; apiProvider?: string },
  ) => string | null;
};

export interface VerifyResult {
  readonly ok: boolean;
  readonly message: string;
}

/** Decrypted credential fields this test reads. */
interface CredentialData {
  authMode?: unknown;
  claudeCodeOauthToken?: unknown;
  anthropicApiKey?: unknown;
}

/**
 * The `methods.credentialTest` block every node that declares this credential
 * spreads in.
 *
 * n8n resolves a node's `testedBy: 'softwareTeamsApiTest'` against that node's
 * own `methods.credentialTest`, so each of the nine nodes using the credential
 * needs the entry. Defining it once here keeps them from drifting.
 */
export const softwareTeamsCredentialTest = {
  async softwareTeamsApiTest(credential: {
    data?: Record<string, unknown>;
  }): Promise<{ status: "OK" | "Error"; message: string }> {
    const data = (credential.data ?? {}) as CredentialData;
    const mode = data.authMode === "apiKey" ? "apiKey" : "subscription";

    const result = await verifyCredential({
      mode,
      ...(typeof data.claudeCodeOauthToken === "string"
        ? { oauthToken: data.claudeCodeOauthToken }
        : {}),
      ...(typeof data.anthropicApiKey === "string" ? { apiKey: data.anthropicApiKey } : {}),
    });

    return { status: result.ok ? "OK" : "Error", message: result.message };
  },
};

/**
 * Credential test for the MCP servers credential.
 *
 * Deliberately offline. Reaching out to each declared server would need the
 * worker to have network egress to all of them at edit time, and a server
 * being briefly unreachable is not the same as a credential being wrong. What
 * an operator actually gets wrong is the JSON shape, so that is what is checked.
 */
export const softwareTeamsMcpCredentialTest = {
  async softwareTeamsMcpApiTest(credential: {
    data?: Record<string, unknown>;
  }): Promise<{ status: "OK" | "Error"; message: string }> {
    const raw = (credential.data ?? {})["mcpServers"];
    try {
      const { servers } = parseMcpConfig(typeof raw === "string" ? raw : JSON.stringify(raw ?? ""));
      return {
        status: "OK",
        message:
          `Configuration is valid: ${servers.length} server(s) - ${servers.join(", ")}. ` +
          "Turns run with --strict-mcp-config, so these are the only servers an agent will see.",
      };
    } catch (err) {
      return { status: "Error", message: err instanceof Error ? err.message : String(err) };
    }
  },
};

const INSTALL_HINT =
  "Install it on the n8n worker with `curl -fsSL https://claude.ai/install.sh | bash` " +
  "and ensure ~/.local/bin is on PATH for the n8n process.";

/**
 * Verify a credential against the worker.
 *
 * Never throws: a credential test that crashes gives the operator nothing to
 * act on, so every failure path returns a message describing the fix.
 */
export async function verifyCredential(config: {
  readonly mode: "subscription" | "apiKey";
  readonly oauthToken?: string;
  readonly apiKey?: string;
}): Promise<VerifyResult> {
  const { execFile } = await import("child_process");

  const env = ((): Record<string, string | undefined> | Error => {
    try {
      return sharedApi.buildAuthEnv(config, process.env);
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  })();

  if (env instanceof Error) return { ok: false, message: env.message };

  const raw = await new Promise<{ stdout: string; stderr: string; failed: boolean }>((resolve) => {
    execFile(
      "claude",
      ["auth", "status"],
      { env: env as NodeJS.ProcessEnv, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({ stdout, stderr, failed: Boolean(error) });
      },
    );
  });

  const combined = `${raw.stdout}\n${raw.stderr}`;
  if (/not found|ENOENT|command not found/i.test(combined)) {
    return { ok: false, message: `Claude CLI not found on the n8n worker. ${INSTALL_HINT}` };
  }

  const status = ((): Record<string, unknown> | null => {
    const start = raw.stdout.indexOf("{");
    if (start === -1) return null;
    try {
      return JSON.parse(raw.stdout.slice(start)) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (!status) {
    return {
      ok: false,
      message: raw.failed
        ? `Could not read auth status from the worker: ${combined.trim().slice(0, 300)}`
        : `Unexpected output from \`claude auth status\`: ${combined.trim().slice(0, 300)}`,
    };
  }

  const mismatch = sharedApi.describeAuthMismatch(config.mode, {
    loggedIn: status["loggedIn"] === true,
    ...(typeof status["authMethod"] === "string" ? { authMethod: status["authMethod"] } : {}),
    ...(typeof status["apiProvider"] === "string" ? { apiProvider: status["apiProvider"] } : {}),
  });
  if (mismatch) return { ok: false, message: mismatch };

  const method = typeof status["authMethod"] === "string" ? status["authMethod"] : "unknown";
  const billing =
    config.mode === "subscription"
      ? "Runs will draw on your Claude subscription."
      : "Runs will bill the Anthropic API.";
  return { ok: true, message: `Authenticated on the worker via ${method}. ${billing}` };
}
