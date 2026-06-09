import { slugify as slugifyShared } from "@websitelabs/software-teams";

/** Convert a free-text string to a URL-safe slug (default maxLength 50). */
export function slugify(input: string, maxLength = 50): string {
  return slugifyShared(input, maxLength);
}

export interface CreatePrInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
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
  url: string;
  number: number;
}

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

/** Open a GitHub pull request. Throws when the GitHub API returns a non-2xx status. */
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

/** Open a GitHub issue. Throws when the GitHub API returns a non-2xx status. */
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
  if (!url.startsWith("http")) return url;
  return null;
}
