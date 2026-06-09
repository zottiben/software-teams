/**
 * `output` verb — open a GitHub PR or issue from a completed NodeEnvelope.
 *
 * Normative sources:
 *   CLI-RECIPE.md §5 (verb→engine map: createPullRequest / createIssue + extractBranchName)
 *   CLI-RECIPE.md §2–§4 (input resolution / output rule / exit-code mapping via runVerb)
 *   CONTRACT.md §2 (artifacts append-not-replace)
 *   ORCHESTRATION §Risks R-02 (token from env only — NEVER a CLI arg)
 *   SPEC AC6, AC7
 *
 * Reuse-check: all GitHub API calls + branch extraction + slugify are delegated
 * to `n8n/src/output/github.ts`.  This file contains only arg-parsing, env-token
 * resolution, and envelope → input mapping.  No new HTTP logic introduced.
 */

import { defineCommand } from "citty";
import { runVerb, stderrLog } from "./_envelope-io";
import {
  createPullRequest,
  createIssue,
  extractBranchName,
  slugify,
} from "../../../n8n/src/output/github";
import type {
  CreatePrInput,
  CreateIssueInput,
  GitHubCreatedRef,
} from "../../../n8n/src/output/github";
import type { NodeEnvelope } from "../contract/envelope";

// ---------------------------------------------------------------------------
// Test stub support (env-gated, subprocess-level purity testing)
// ---------------------------------------------------------------------------
//
// When ST_CLI_TEST_STUB=1, output swaps the GitHub API calls for deterministic
// offline mocks. This allows subprocess tests to verify json-purity and exit-code
// gates without touching the network or real tokens. The stubs return fake refs
// that parse successfully but have no secrets.
//
// Token validation logic is NOT bypassed — the subprocess test for
// "missing GITHUB_TOKEN" still exercises the real token check before the engine.
// Only the API call side is stubbed away.
//
// Reuse pattern for T9 (cross-verb spawn matrix): call getOutputDeps() and pass
// to runOutputEngine, or initialize deps directly in the command handler.

function getOutputDeps(): OutputDeps {
  if (process.env.ST_CLI_TEST_STUB === "1") {
    // Offline stubs: no network, no real token validation side-effects.
    return {
      createPr: async () => ({
        url: "https://github.com/test-owner/test-repo/pull/999",
        number: 999,
      }),
      createIss: async () => ({
        url: "https://github.com/test-owner/test-repo/issues/888",
        number: 888,
      }),
    };
  }
  // Real GitHub API (production).
  return {
    createPr: createPullRequest,
    createIss: createIssue,
  };
}

// ---------------------------------------------------------------------------
// Injectable dependencies — exported so unit tests can supply mocks without
// network access or real tokens (reuse-check: no GitHub logic lives here).
// ---------------------------------------------------------------------------

export interface OutputDeps {
  createPr: (input: CreatePrInput) => Promise<GitHubCreatedRef>;
  createIss: (input: CreateIssueInput) => Promise<GitHubCreatedRef>;
}

export interface OutputEngineArgs {
  mode: "pr" | "issue";
  owner: string;
  repo: string;
  base: string;
  head?: string;
  title?: string;
  labels?: string;
}

// ---------------------------------------------------------------------------
// Engine function (exported for unit-testing — pure business logic)
// ---------------------------------------------------------------------------

/**
 * Core output engine: maps a completed NodeEnvelope to a PR or issue,
 * appends the created URL to artifacts (accrete, never replace), and
 * returns the updated envelope.
 *
 * The GitHub token is a required caller argument — the command resolves it
 * from the environment (R-02) and passes it here; tests supply a stub token.
 */
export async function runOutputEngine(
  envelope: NodeEnvelope,
  args: OutputEngineArgs,
  token: string,
  deps: OutputDeps,
): Promise<NodeEnvelope> {
  const body = envelope.result.text;
  // Title: --title override, else slugify the first 72 chars of result.text.
  const title = args.title ?? slugify(body.slice(0, 72));

  if (args.mode === "pr") {
    const head = args.head ?? envelope.artifacts.reduce<string | null>((found, artifact) => {
      if (found) return found;
      if (artifact.type === "branch" || artifact.type === "pr") {
        const extracted = extractBranchName(artifact.url);
        return extracted ?? null;
      }
      return null;
    }, null);

    if (!head) {
      return {
        ...envelope,
        status: "error",
        result: {
          text: "Cannot open a PR: no head branch resolved. Supply --head or ensure a branch/pr artifact with a resolvable URL is present.",
        },
      };
    }

    const prResult = await deps.createPr({
      owner: args.owner, repo: args.repo, title, body, head, base: args.base, token,
    }).catch((err) => ({ _error: err instanceof Error ? err.message : String(err) }));

    if ("_error" in prResult) {
      return { ...envelope, status: "error", result: { text: `GitHub PR creation failed: ${prResult._error}` } };
    }

    return {
      ...envelope,
      status: "ok",
      artifacts: [...envelope.artifacts, { type: "pr", url: prResult.url }],
    };
  }

  // ── mode === "issue" ─────────────────────────────────────────────────────
  const labelsList = args.labels
    ? args.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
    : undefined;

  const issResult = await deps.createIss({
    owner: args.owner, repo: args.repo, title, body, labels: labelsList, token,
  }).catch((err) => ({ _error: err instanceof Error ? err.message : String(err) }));

  if ("_error" in issResult) {
    return { ...envelope, status: "error", result: { text: `GitHub issue creation failed: ${issResult._error}` } };
  }

  return {
    ...envelope,
    status: "ok",
    artifacts: [...envelope.artifacts, { type: "issue", url: issResult.url }],
  };
}

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

export const outputCommand = defineCommand({
  meta: {
    name: "output",
    description: 'Create a GitHub PR or issue from a completed NodeEnvelope ("pr" mode by default)',
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit a machine-parseable NodeEnvelope on stdout (§3 output rule)",
      default: false,
    },
    envelope: {
      type: "string",
      description: "Inline input envelope JSON (precedence over stdin per §2)",
    },
    mode: {
      type: "string",
      description: 'Output mode: "pr" (default) or "issue"',
      default: "pr",
    },
    owner: {
      type: "string",
      description: "GitHub repository owner (required)",
    },
    repo: {
      type: "string",
      description: "GitHub repository name (required)",
    },
    base: {
      type: "string",
      description: "Base branch to merge into for a PR (default: main)",
      default: "main",
    },
    head: {
      type: "string",
      description:
        "Head branch for the PR — resolved from branch/pr artifacts if absent",
    },
    title: {
      type: "string",
      description: "PR/issue title — derived from result.text via slugify if absent",
    },
    labels: {
      type: "string",
      description: "Comma-separated labels to attach to an issue",
    },
  },

  async run({ args }) {
    // ── Verb-level flag validation → exit 2 (input error, per CLI-RECIPE.md §2) ──
    if (args.mode !== "pr" && args.mode !== "issue") {
      stderrLog.error(`--mode must be "pr" or "issue", got "${args.mode}"`);
      process.exit(2);
    }
    if (!args.owner) {
      stderrLog.error("--owner is required");
      process.exit(2);
    }
    if (!args.repo) {
      stderrLog.error("--repo is required");
      process.exit(2);
    }

    // ── Token resolution (R-02: env ONLY — never a CLI arg, never logged) ──────
    // Must happen before runVerb so errors exit with proper stderr + exit 1.
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) {
      stderrLog.error(
        "Missing GitHub token: set the GITHUB_TOKEN or GH_TOKEN environment variable",
      );
      process.exit(1);
    }

    const mode = args.mode as "pr" | "issue";

    await runVerb(args, async (envelope: NodeEnvelope): Promise<NodeEnvelope> => {
      return runOutputEngine(
        envelope,
        {
          mode,
          owner: args.owner,
          repo: args.repo,
          base: args.base ?? "main",
          head: args.head,
          title: args.title,
          labels: args.labels,
        },
        token,
        getOutputDeps(),
      );
    });
  },
});
