/**
 * GitHub PR / issue creation helpers for the SoftwareTeamsOutput n8n node (T7).
 *
 * Uses the GitHub REST API via fetch (Node.js 18+ / Bun) — no extra dependencies.
 * The GitHub token MUST come from the softwareTeamsApi credential (R-02);
 * it is NEVER accepted as a node parameter or written to logs/output.
 *
 * Reuse notes (T7 contract):
 *  - `slugify` delegates to the communal CLI transform via the workspace
 *    dependency (single source of truth); this node keeps its own maxLength=50
 *    default. No `gitCheckoutNewBranch` / `exec` are needed: the output node
 *    reads the branch name from the upstream envelope's artifacts; the branch is
 *    already pushed by the agent that created it.
 *  - PR/issue creation is net-new — src/utils/github.ts has no such helper and
 *    the GHA runner explicitly forbids `gh pr create` in its own context.
 */

import { slugify as slugifyShared } from "@websitelabs/software-teams";

// ---------------------------------------------------------------------------
// slugify — communal transform; this node defaults maxLength to 50
// ---------------------------------------------------------------------------

/** Convert a free-text string to a URL-safe slug (default maxLength 50). */
export function slugify(input: string, maxLength = 50): string {
  return slugifyShared(input, maxLength);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePrInput {
  owner: string;
  repo: string;
  /** PR title. */
  title: string;
  /** PR body (Markdown). */
  body: string;
  /** Head branch to merge from (e.g. "feat/my-feature"). */
  head: string;
  /** Base branch to merge into (e.g. "main"). */
  base: string;
  /** GitHub token — from softwareTeamsApi credential only (R-02). */
  token: string;
}

export interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  /** GitHub token — from softwareTeamsApi credential only (R-02). */
  token: string;
}

export interface GitHubCreatedRef {
  /** Absolute HTML URL of the created PR or issue. */
  url: string;
  /** GitHub issue / PR number. */
  number: number;
}

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

interface GitHubApiResponse {
  html_url: string;
  number: number;
  message?: string;
  errors?: Array<{ message: string }>;
}

async function ghPost(
  path: string,
  body: Record<string, unknown>,
  token: string,
): Promise<GitHubApiResponse> {
  const githubBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const resp = await fetch(`${githubBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "@websitelabs/n8n-nodes-software-teams",
    },
    body: JSON.stringify(body),
  });

  const data = (await resp.json()) as GitHubApiResponse;

  if (!resp.ok) {
    const detail =
      data.errors?.map((e) => e.message).join("; ") ??
      data.message ??
      `HTTP ${resp.status}`;
    throw new Error(`GitHub API error on POST ${path}: ${detail}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a GitHub pull request.
 *
 * @throws when the GitHub API returns a non-2xx status (e.g. no diff, branch
 *         already has an open PR, insufficient token scopes).
 */
export async function createPullRequest(
  input: CreatePrInput,
): Promise<GitHubCreatedRef> {
  const { owner, repo, title, body, head, base, token } = input;
  const data = await ghPost(
    `/repos/${owner}/${repo}/pulls`,
    { title, body, head, base },
    token,
  );
  return { url: data.html_url, number: data.number };
}

/**
 * Open a GitHub issue.
 *
 * @throws when the GitHub API returns a non-2xx status.
 */
export async function createIssue(
  input: CreateIssueInput,
): Promise<GitHubCreatedRef> {
  const { owner, repo, title, body, labels, token } = input;
  const data = await ghPost(
    `/repos/${owner}/${repo}/issues`,
    { title, body, labels: labels ?? [] },
    token,
  );
  return { url: data.html_url, number: data.number };
}

/**
 * Extract the branch name from a GitHub tree URL or pass through a plain name.
 *
 * Examples:
 *   "https://github.com/acme/site/tree/feat/my-feature" → "feat/my-feature"
 *   "feat/my-feature"                                   → "feat/my-feature"
 *   undefined                                            → null
 */
export function extractBranchName(url: string | undefined): string | null {
  if (!url) return null;
  const treeIdx = url.indexOf("/tree/");
  if (treeIdx !== -1) {
    return url.slice(treeIdx + "/tree/".length);
  }
  // Treat as a plain branch name if it does not look like an http URL.
  if (!url.startsWith("http")) return url;
  return null;
}
