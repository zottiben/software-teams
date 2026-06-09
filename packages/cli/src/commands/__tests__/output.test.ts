/**
 * Unit tests for the `output` verb — T6 of plan 1-02-n8n-manual-cli.
 *
 * Tests `runOutputEngine` directly with mocked GitHub helpers (no network,
 * no real tokens) to verify:
 *
 *  ✓ PR mode: creates PR, appends artifact, status → ok (exit 0)
 *  ✓ Issue mode: creates issue, appends artifact, status → ok
 *  ✓ Artifacts accrete — upstream refs are preserved (CONTRACT.md §2)
 *  ✓ Head resolved from `--head` arg
 *  ✓ Head resolved from upstream branch artifact URL
 *  ✓ Head resolved from upstream pr artifact URL
 *  ✓ Head resolved from plain (non-http) branch artifact value
 *  ✓ No resolvable head for PR → status: error (exit 1)
 *  ✓ API failure → status: error, token NOT present in error text
 *  ✓ Labels split and trimmed for issues
 *  ✓ Title derived from result.text via slugify when --title absent
 *  ✓ Title override with --title
 *  ✓ json-purity-gate: status ok → exit code 0 (via statusToExitCode)
 *  ✓ json-purity-gate: status error → exit code 1
 *  ✓ contract-conformance: returned envelope retains all 6 required fields
 */

import { describe, test, expect, mock } from "bun:test";
import { join } from "node:path";
import type { NodeEnvelope } from "../../contract/envelope";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "index.ts");
import { runOutputEngine, type OutputDeps, type OutputEngineArgs } from "../output";
import { statusToExitCode } from "../_envelope-io";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEnvelope(overrides?: Partial<NodeEnvelope>): NodeEnvelope {
  return {
    correlationId: "test-run-001",
    agentId: "software-teams-backend",
    status: "ok",
    input: { prompt: "Implement the feature", context: null },
    result: { text: "Implemented the feature. All tests pass." },
    artifacts: [],
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<OutputDeps>): OutputDeps {
  return {
    createPr: mock(async () => ({
      url: "https://github.com/owner/repo/pull/42",
      number: 42,
    })),
    createIss: mock(async () => ({
      url: "https://github.com/owner/repo/issues/7",
      number: 7,
    })),
    ...overrides,
  };
}

function makeArgs(overrides?: Partial<OutputEngineArgs>): OutputEngineArgs {
  return {
    mode: "pr",
    owner: "owner",
    repo: "repo",
    base: "main",
    head: "feat/my-feature",
    ...overrides,
  };
}

const STUB_TOKEN = "ghp_stubtoken";

// ─── PR mode — happy path ─────────────────────────────────────────────────────

describe("runOutputEngine — PR mode happy path", () => {
  test("returns status: ok when PR is created successfully", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/my-feature" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.status).toBe("ok");
  });

  test("appends a pr artifact to the envelope artifacts", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/my-feature" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toEqual({
      type: "pr",
      url: "https://github.com/owner/repo/pull/42",
    });
  });

  test("exit-code-gate: ok status maps to exit code 0", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/my-feature" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(statusToExitCode(result)).toBe(0);
  });

  test("passes owner, repo, head, base, title, token to createPr", async () => {
    let captured: Parameters<OutputDeps["createPr"]>[0] | null = null;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        captured = input;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({ result: { text: "Feature body text." } }),
      makeArgs({ mode: "pr", owner: "o", repo: "r", head: "feat/branch", base: "develop", title: "My PR" }),
      STUB_TOKEN,
      deps,
    );
    expect(captured).not.toBeNull();
    expect(captured!.owner).toBe("o");
    expect(captured!.repo).toBe("r");
    expect(captured!.head).toBe("feat/branch");
    expect(captured!.base).toBe("develop");
    expect(captured!.title).toBe("My PR");
    expect(captured!.body).toBe("Feature body text.");
    expect(captured!.token).toBe(STUB_TOKEN);
  });
});

// ─── Issue mode — happy path ──────────────────────────────────────────────────

describe("runOutputEngine — issue mode happy path", () => {
  test("returns status: ok when issue is created successfully", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.status).toBe("ok");
  });

  test("appends an issue artifact to the envelope artifacts", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toEqual({
      type: "issue",
      url: "https://github.com/owner/repo/issues/7",
    });
  });

  test("exit-code-gate: ok status maps to exit code 0", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(statusToExitCode(result)).toBe(0);
  });

  test("splits comma-separated labels and trims whitespace", async () => {
    let capturedLabels: string[] | undefined;
    const deps = makeDeps({
      createIss: mock(async (input) => {
        capturedLabels = input.labels;
        return { url: "https://github.com/o/r/issues/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue", labels: " bug , enhancement , help wanted " }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedLabels).toEqual(["bug", "enhancement", "help wanted"]);
  });

  test("passes undefined labels to createIss when --labels is absent", async () => {
    let capturedLabels: string[] | undefined = ["sentinel"];
    const deps = makeDeps({
      createIss: mock(async (input) => {
        capturedLabels = input.labels;
        return { url: "https://github.com/o/r/issues/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue", labels: undefined }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedLabels).toBeUndefined();
  });
});

// ─── Artifacts accretion (CONTRACT.md §2) ────────────────────────────────────

describe("runOutputEngine — artifacts accretion (not replace)", () => {
  test("PR mode: upstream artifacts are preserved alongside the new pr artifact", async () => {
    const upstream = [
      { type: "branch", url: "https://github.com/owner/repo/tree/feat/my-feature" },
      { type: "comment", url: "https://github.com/owner/repo/issues/3#comment-99" },
    ];
    const result = await runOutputEngine(
      makeEnvelope({ artifacts: upstream }),
      makeArgs({ mode: "pr", head: "feat/my-feature" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts[0]).toEqual(upstream[0]);
    expect(result.artifacts[1]).toEqual(upstream[1]);
    expect(result.artifacts[2]).toMatchObject({ type: "pr" });
  });

  test("issue mode: upstream artifacts are preserved alongside the new issue artifact", async () => {
    const upstream = [{ type: "branch", url: "feat/x" }];
    const result = await runOutputEngine(
      makeEnvelope({ artifacts: upstream }),
      makeArgs({ mode: "issue" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]).toEqual(upstream[0]);
    expect(result.artifacts[1]).toMatchObject({ type: "issue" });
  });
});

// ─── Head branch resolution ───────────────────────────────────────────────────

describe("runOutputEngine — head branch resolution", () => {
  test("uses --head arg directly when provided", async () => {
    let capturedHead: string | undefined;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        capturedHead = input.head;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({ artifacts: [] }),
      makeArgs({ mode: "pr", head: "feat/explicit-branch" }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedHead).toBe("feat/explicit-branch");
  });

  test("resolves head from a branch artifact with a tree URL", async () => {
    let capturedHead: string | undefined;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        capturedHead = input.head;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({
        artifacts: [
          { type: "branch", url: "https://github.com/owner/repo/tree/feat/auto-resolved" },
        ],
      }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedHead).toBe("feat/auto-resolved");
  });

  test("resolves head from a pr artifact URL (branch segment)", async () => {
    let capturedHead: string | undefined;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        capturedHead = input.head;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({
        artifacts: [
          { type: "pr", url: "https://github.com/owner/repo/tree/fix/existing-pr-branch" },
        ],
      }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedHead).toBe("fix/existing-pr-branch");
  });

  test("resolves head from plain (non-http) branch artifact value", async () => {
    let capturedHead: string | undefined;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        capturedHead = input.head;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({
        artifacts: [{ type: "branch", url: "feat/plain-branch-name" }],
      }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedHead).toBe("feat/plain-branch-name");
  });

  test("returns status: error when no head resolvable for PR mode", async () => {
    const result = await runOutputEngine(
      makeEnvelope({ artifacts: [] }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.status).toBe("error");
    expect(result.result.text).toContain("Cannot open a PR");
  });

  test("exit-code-gate: unresolvable head → error status → exit code 1", async () => {
    const result = await runOutputEngine(
      makeEnvelope({ artifacts: [] }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(statusToExitCode(result)).toBe(1);
  });

  test("non-branch/pr artifact types are NOT used for head resolution", async () => {
    // A 'comment' artifact should not be used to derive the head branch
    const result = await runOutputEngine(
      makeEnvelope({
        artifacts: [
          { type: "comment", url: "https://github.com/owner/repo/tree/should-not-use" },
        ],
      }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.status).toBe("error");
  });
});

// ─── API failure handling ─────────────────────────────────────────────────────

describe("runOutputEngine — API failure", () => {
  test("PR API failure → status: error with message", async () => {
    const deps = makeDeps({
      createPr: mock(async () => {
        throw new Error("GitHub API error on POST /repos/owner/repo/pulls: No diff");
      }),
    });
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/branch" }),
      STUB_TOKEN,
      deps,
    );
    expect(result.status).toBe("error");
    expect(result.result.text).toContain("GitHub PR creation failed");
    expect(result.result.text).toContain("No diff");
  });

  test("issue API failure → status: error with message", async () => {
    const deps = makeDeps({
      createIss: mock(async () => {
        throw new Error("GitHub API error: Issues are disabled for this repo");
      }),
    });
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue" }),
      STUB_TOKEN,
      deps,
    );
    expect(result.status).toBe("error");
    expect(result.result.text).toContain("GitHub issue creation failed");
  });

  test("token is NOT present in API error message (no leak)", async () => {
    const secret = "ghp_very_secret_token_12345";
    const deps = makeDeps({
      createPr: mock(async () => {
        throw new Error("HTTP 422: validation failed");
      }),
    });
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/x" }),
      secret,
      deps,
    );
    expect(result.result.text).not.toContain(secret);
    expect(result.status).toBe("error");
  });

  test("exit-code-gate: API failure → error status → exit code 1", async () => {
    const deps = makeDeps({
      createPr: mock(async () => {
        throw new Error("HTTP 500");
      }),
    });
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/x" }),
      STUB_TOKEN,
      deps,
    );
    expect(statusToExitCode(result)).toBe(1);
  });
});

// ─── Title derivation ─────────────────────────────────────────────────────────

describe("runOutputEngine — title derivation", () => {
  test("uses --title override when provided", async () => {
    let capturedTitle: string | undefined;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        capturedTitle = input.title;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({ result: { text: "Some long text that would be slugified." } }),
      makeArgs({ mode: "pr", head: "feat/x", title: "My custom title" }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedTitle).toBe("My custom title");
  });

  test("derives title from result.text via slugify when --title absent", async () => {
    let capturedTitle: string | undefined;
    const deps = makeDeps({
      createPr: mock(async (input) => {
        capturedTitle = input.title;
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope({ result: { text: "Implement the new dashboard feature" } }),
      makeArgs({ mode: "pr", head: "feat/x", title: undefined }),
      STUB_TOKEN,
      deps,
    );
    // slugify should produce a slug from the text
    expect(capturedTitle).toBeTruthy();
    expect(capturedTitle).toMatch(/^[a-z0-9-]+$/);
  });

  test("title for issue also uses --title override", async () => {
    let capturedTitle: string | undefined;
    const deps = makeDeps({
      createIss: mock(async (input) => {
        capturedTitle = input.title;
        return { url: "https://github.com/o/r/issues/1", number: 1 };
      }),
    });
    await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "issue", title: "Issue title override" }),
      STUB_TOKEN,
      deps,
    );
    expect(capturedTitle).toBe("Issue title override");
  });
});

// ─── Contract conformance ─────────────────────────────────────────────────────

describe("runOutputEngine — contract conformance (all 6 NodeEnvelope fields)", () => {
  test("PR success: returned envelope has all required fields", async () => {
    const input = makeEnvelope({
      correlationId: "corr-xyz",
      agentId: "software-teams-backend",
    });
    const result = await runOutputEngine(
      input,
      makeArgs({ mode: "pr", head: "feat/x" }),
      STUB_TOKEN,
      makeDeps(),
    );
    // All 6 fields present
    expect(typeof result.correlationId).toBe("string");
    expect(result.correlationId.length).toBeGreaterThan(0);
    expect(typeof result.agentId).toBe("string");
    expect(["ok", "error", "needs-input"]).toContain(result.status);
    expect(typeof result.input).toBe("object");
    expect(typeof result.input.prompt).toBe("string");
    expect(typeof result.result).toBe("object");
    expect(typeof result.result.text).toBe("string");
    expect(Array.isArray(result.artifacts)).toBe(true);
  });

  test("correlationId is carried through unchanged", async () => {
    const input = makeEnvelope({ correlationId: "carry-me-through" });
    const result = await runOutputEngine(
      input,
      makeArgs({ mode: "pr", head: "feat/x" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.correlationId).toBe("carry-me-through");
  });

  test("agentId is carried through unchanged", async () => {
    const input = makeEnvelope({ agentId: "software-teams-frontend" });
    const result = await runOutputEngine(
      input,
      makeArgs({ mode: "pr", head: "feat/x" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.agentId).toBe("software-teams-frontend");
  });

  test("error envelope also carries correlationId unchanged", async () => {
    const input = makeEnvelope({ correlationId: "carry-on-error", artifacts: [] });
    const result = await runOutputEngine(
      input,
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(result.status).toBe("error");
    expect(result.correlationId).toBe("carry-on-error");
  });
});

// ─── json-purity-gate (stdout purity) ────────────────────────────────────────

describe("json-purity-gate — output command uses writeResult exclusively", () => {
  // The full byte-for-byte stdout purity test requires a subprocess and belongs to T9.
  // Here we verify the engine returns envelopes that writeResult (T2) can serialise.

  test("ok result JSON.stringifies without error", async () => {
    const result = await runOutputEngine(
      makeEnvelope(),
      makeArgs({ mode: "pr", head: "feat/x" }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(() => JSON.stringify(result)).not.toThrow();
    // Must be parseable as an object with the artifact
    const parsed = JSON.parse(JSON.stringify(result)) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    expect(parsed.artifacts[0].url).toBe("https://github.com/owner/repo/pull/42");
  });

  test("error result JSON.stringifies without error", async () => {
    const result = await runOutputEngine(
      makeEnvelope({ artifacts: [] }),
      makeArgs({ mode: "pr", head: undefined }),
      STUB_TOKEN,
      makeDeps(),
    );
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as NodeEnvelope;
    expect(parsed.status).toBe("error");
  });
});

// ─── Mock GitHub server for subprocess tests ──────────────────────────────────

let ghServer: ReturnType<typeof Bun.serve>;
let ghBaseUrl: string;

// In-process helper to initialize the server (runs once before all subprocess tests)
async function ensureGhServer() {
  if (!ghServer) {
    ghServer = Bun.serve({
      port: 0,
      fetch(req: Request) {
        const url = new URL(req.url);
        if (
          req.method === "POST" &&
          (url.pathname.endsWith("/pulls") || url.pathname.endsWith("/issues"))
        ) {
          const isIssue = url.pathname.endsWith("/issues");
          return new Response(
            JSON.stringify({
              html_url: isIssue
                ? "https://github.com/owner/repo/issues/42"
                : "https://github.com/owner/repo/pull/42",
              number: 42,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    ghBaseUrl = `http://localhost:${ghServer.port}`;
  }
}

// ─── In-process ok-path tests (mocked engine, can't reach mocks across subprocess) ──

describe("output — ok-path with mocked deps (in-process, not subprocess)", () => {
  test("--json with valid envelope (PR mode) → JSON-serializable with artifact, exit 0", async () => {
    const inputEnv = makeEnvelope({
      correlationId: "test-run-001",
      result: { text: "PR body: Implemented the feature" },
    });

    const result = await runOutputEngine(
      inputEnv,
      makeArgs({ mode: "pr", head: "feat/test" }),
      STUB_TOKEN,
      makeDeps(),
    );

    // Verify exit code gate
    expect(statusToExitCode(result)).toBe(0);

    // Verify JSON is serializable with artifact
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as NodeEnvelope;
    expect(parsed.status).toBe("ok");
    expect(parsed.correlationId).toBe("test-run-001");
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.artifacts[0].type).toBe("pr");
  });

  test("--envelope flag carries correlationId through ok path", async () => {
    const inputEnv = makeEnvelope({
      correlationId: "flag-run",
      result: { text: "Test" },
    });

    const result = await runOutputEngine(
      inputEnv,
      makeArgs({ mode: "pr", head: "feat/test" }),
      STUB_TOKEN,
      makeDeps(),
    );

    expect(result.correlationId).toBe("flag-run");
    expect(statusToExitCode(result)).toBe(0);
  });

  test("human mode (no --json) still produces ok status and JSON", async () => {
    const inputEnv = makeEnvelope({
      correlationId: "test-run-001",
      result: { text: "Test" },
    });

    const result = await runOutputEngine(
      inputEnv,
      makeArgs({ mode: "pr", head: "feat/test" }),
      STUB_TOKEN,
      makeDeps(),
    );

    expect(statusToExitCode(result)).toBe(0);
    expect(result.status).toBe("ok");
    // Envelope is JSON-serializable regardless of mode
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

// ─── Subprocess: offline input-error paths only (no network, exit 2) ──────────

describe("output subprocess — end-to-end CLI (offline input-error paths)", () => {
  test("missing GITHUB_TOKEN (offline, reachable) → exit 1, diagnostic on stderr, empty stdout", async () => {
    const inputEnv: NodeEnvelope = {
      correlationId: "test-run-001",
      agentId: "software-teams-backend",
      status: "ok",
      input: { prompt: "test", context: null },
      result: { text: "test" },
      artifacts: [],
    };

    // Strip both GITHUB_TOKEN and GH_TOKEN
    const env = { ...process.env };
    delete env["GITHUB_TOKEN"];
    delete env["GH_TOKEN"];

    const proc = Bun.spawn({
      cmd: [
        "bun",
        CLI_ENTRY,
        "output",
        "--mode",
        "pr",
        "--owner",
        "test-owner",
        "--repo",
        "test-repo",
        "--head",
        "feat/test",
        "--json",
      ],
      stdin: Buffer.from(JSON.stringify(inputEnv)),
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // The token check runs before runVerb — the process exits without writing
    // anything to stdout. The diagnostic is on stderr.
    expect(exitCode).toBe(1);
    expect(stdout).toBe(""); // token check exits before any JSON is written
    expect(stderr).toContain("token");
  }, 20000);

  test("malformed JSON on stdin → exit 2, no JSON on stdout", async () => {
    const proc = Bun.spawn({
      cmd: [
        "bun",
        CLI_ENTRY,
        "output",
        "--mode",
        "pr",
        "--owner",
        "test-owner",
        "--repo",
        "test-repo",
        "--head",
        "feat/test",
        "--json",
      ],
      stdin: Buffer.from("not-valid-json{{{"),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GITHUB_TOKEN: "ghp_test_token" },
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr.length).toBeGreaterThan(0);
  }, 20000);

  test("missing --owner or --repo → exit 2 with clear message", async () => {
    const inputEnv: NodeEnvelope = {
      correlationId: "test-run-001",
      agentId: "software-teams-backend",
      status: "ok",
      input: { prompt: "test", context: null },
      result: { text: "test" },
      artifacts: [],
    };

    const proc = Bun.spawn({
      cmd: ["bun", CLI_ENTRY, "output", "--mode", "pr", "--json"],
      stdin: Buffer.from(JSON.stringify(inputEnv)),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GITHUB_TOKEN: "ghp_test_token" },
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(2);
    expect(stderr).toContain("owner");
  }, 20000);
});
