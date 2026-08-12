import { describe, expect, test } from "bun:test";
import {
  ClaudeAuthError,
  assertAuthEnv,
  buildAuthEnv,
  describeAuthMismatch,
} from "../claude-auth";

describe("buildAuthEnv — subscription mode", () => {
  test("sets the OAuth token", () => {
    const env = buildAuthEnv({ mode: "subscription", oauthToken: "tok" }, {});
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok");
  });

  test("strips ANTHROPIC_API_KEY, which would otherwise outrank the token", () => {
    // This is the whole point of the module. ANTHROPIC_API_KEY sits above
    // CLAUDE_CODE_OAUTH_TOKEN in Claude Code's precedence and, in -p mode, is
    // always used when present — so a worker with a stray key would silently
    // bill the API while the operator believed the subscription was in use.
    const env = buildAuthEnv(
      { mode: "subscription", oauthToken: "tok" },
      { ANTHROPIC_API_KEY: "sk-ant-leftover", PATH: "/usr/bin" },
    );
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok");
    expect(env["PATH"]).toBe("/usr/bin");
  });

  test("strips every higher-precedence credential var", () => {
    const env = buildAuthEnv(
      { mode: "subscription", oauthToken: "tok" },
      {
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_AUTH_TOKEN: "t",
        CLAUDE_CODE_USE_BEDROCK: "1",
        CLAUDE_CODE_USE_VERTEX: "1",
        CLAUDE_CODE_USE_FOUNDRY: "1",
      },
    );
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });

  test("does not mutate the base environment it was given", () => {
    // A mutated process.env on a long-lived n8n worker leaks into every later
    // execution on that worker.
    const base = { ANTHROPIC_API_KEY: "k" };
    buildAuthEnv({ mode: "subscription", oauthToken: "tok" }, base);
    expect(base.ANTHROPIC_API_KEY).toBe("k");
  });

  test("refuses to build without a token, naming the fix", () => {
    expect(() => buildAuthEnv({ mode: "subscription" }, {})).toThrow(ClaudeAuthError);
    expect(() => buildAuthEnv({ mode: "subscription", oauthToken: "  " }, {})).toThrow(
      /claude setup-token/,
    );
  });
});

describe("buildAuthEnv — apiKey mode", () => {
  test("sets the key and clears the OAuth token", () => {
    const env = buildAuthEnv(
      { mode: "apiKey", apiKey: "sk-ant-x" },
      { CLAUDE_CODE_OAUTH_TOKEN: "stale" },
    );
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-x");
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });

  test("refuses to build without a key", () => {
    expect(() => buildAuthEnv({ mode: "apiKey" }, {})).toThrow(ClaudeAuthError);
  });
});

describe("assertAuthEnv", () => {
  test("passes for a correctly built subscription environment", () => {
    const env = buildAuthEnv({ mode: "subscription", oauthToken: "tok" }, {});
    expect(() => assertAuthEnv("subscription", env)).not.toThrow();
  });

  test("catches an API key that slipped back in after the build", () => {
    const env = buildAuthEnv({ mode: "subscription", oauthToken: "tok" }, {});
    env["ANTHROPIC_API_KEY"] = "sk-ant-sneaky";
    expect(() => assertAuthEnv("subscription", env)).toThrow(/would be overridden/);
  });

  test("catches a missing token", () => {
    expect(() => assertAuthEnv("subscription", {})).toThrow(/not set/);
  });

  test("is a no-op for apiKey mode", () => {
    expect(() => assertAuthEnv("apiKey", { ANTHROPIC_API_KEY: "k" })).not.toThrow();
  });
});

describe("describeAuthMismatch", () => {
  test("accepts the matching method", () => {
    expect(
      describeAuthMismatch("subscription", { loggedIn: true, authMethod: "oauth_token" }),
    ).toBeNull();
    expect(describeAuthMismatch("apiKey", { loggedIn: true, authMethod: "api_key" })).toBeNull();
  });

  test("flags a logged-in worker that is using the WRONG credential", () => {
    // `loggedIn: true` alone is not good enough: a stray API key reports
    // logged-in while billing the wrong account.
    const msg = describeAuthMismatch("subscription", { loggedIn: true, authMethod: "api_key" });
    expect(msg).toContain("api_key");
    expect(msg).toContain("bill the API");
  });

  test("flags a worker that is not logged in, with a mode-specific fix", () => {
    expect(describeAuthMismatch("subscription", { loggedIn: false })).toContain("setup-token");
    expect(describeAuthMismatch("apiKey", { loggedIn: false })).toContain("API key");
  });
});
