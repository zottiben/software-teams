import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "./git";

/**
 * Standard PR template paths checked by GitHub itself, in detection order.
 * The runner uses the first match — repos that ship multiple templates via
 * `.github/PULL_REQUEST_TEMPLATE/` directory are an edge case we don't try
 * to disambiguate (the human picks at PR-open time anyway).
 */
const PR_TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
];

export interface PrTemplate {
  path: string;   // workspace-relative
  body: string;   // raw template content
}

/**
 * Locate a PR template at the conventional paths. Returns null if none
 * exist. Used by the action runner to hand the template body to the
 * implementation subagent so the "PR proposal" block fills the template
 * the repo already prefers rather than emitting generic default text.
 */
export function findPrTemplate(cwd: string): PrTemplate | null {
  for (const rel of PR_TEMPLATE_PATHS) {
    const full = join(cwd, rel);
    if (existsSync(full)) {
      try {
        const body = readFileSync(full, "utf-8");
        if (body.trim()) return { path: rel, body };
      } catch {
        // unreadable — try next candidate
      }
    }
  }
  return null;
}

/**
 * Fetch the title and body of a GitHub issue via `gh api`.
 * Returns null on non-zero exit (e.g. network failure, not found).
 * GitHub returns null for empty issue bodies — coerced to empty string.
 */
/**
 * Returns true when `number` is an open or closed pull request in `repo`.
 * Issues that are NOT PRs return false (the `gh api .../pulls/{n}` endpoint
 * 404s for issue-only numbers). Used to distinguish issue-context runs (no
 * associated PR — implementation must open one) from PR-context runs (push
 * to the existing PR branch).
 */
export async function isPullRequest(
  repo: string,
  number: number,
): Promise<boolean> {
  if (!repo || !number) return false;
  const { exitCode } = await exec([
    "gh", "api",
    `repos/${repo}/pulls/${number}`,
    "--silent",
  ]);
  return exitCode === 0;
}

/**
 * Return the originating issue numbers a PR closes, as resolved by GitHub
 * from `Closes #N` / `Fixes #N` / `Resolves #N` trailers in the PR body or
 * commits. Used by the action runner to bridge conversation context: when
 * Software Teams runs on a PR, it ALSO fetches comments from the original
 * issue so the agent doesn't restart from scratch.
 */
export async function fetchPrLinkedIssues(
  repo: string,
  prNumber: number,
): Promise<number[]> {
  if (!repo || !prNumber) return [];
  // GraphQL via `gh pr view` — closingIssuesReferences resolves the linked
  // issues GitHub itself associates with the PR (the same ones that auto-
  // close on merge).
  const { stdout, exitCode } = await exec([
    "gh", "pr", "view", String(prNumber),
    "--repo", repo,
    "--json", "closingIssuesReferences",
    "--jq", ".closingIssuesReferences[].number",
  ]);
  if (exitCode !== 0 || !stdout.trim()) return [];
  return stdout
    .trim()
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function fetchIssueTitleAndBody(
  repo: string,
  issueNumber: number,
): Promise<{ title: string; body: string } | null> {
  const { stdout, exitCode } = await exec([
    "gh", "api",
    `repos/${repo}/issues/${issueNumber}`,
    "--jq", "{title: .title, body: .body}",
  ]);

  if (exitCode !== 0 || !stdout.trim()) return null;

  try {
    const parsed = JSON.parse(stdout.trim());
    return {
      title: parsed.title ?? "",
      // GitHub returns null for issues with no body — coerce to empty string
      body: parsed.body ?? "",
    };
  } catch {
    return null;
  }
}

export interface ThreadComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  isSoftwareTeams: boolean;
}

export async function postGitHubComment(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<number | null> {
  const { stdout, exitCode } = await exec([
    "gh", "api",
    `repos/${repo}/issues/${issueNumber}/comments`,
    "-f", `body=${body}`,
    "--jq", ".id",
  ]);
  if (exitCode === 0 && stdout.trim()) {
    return Number(stdout.trim());
  }
  return null;
}

export async function updateGitHubComment(
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  await exec([
    "gh", "api",
    "-X", "PATCH",
    `repos/${repo}/issues/comments/${commentId}`,
    "-f", `body=${body}`,
  ]);
}

export async function reactToComment(
  repo: string,
  commentId: number,
  reaction: string,
): Promise<void> {
  await exec([
    "gh", "api",
    `repos/${repo}/issues/comments/${commentId}/reactions`,
    "-f", `content=${reaction}`,
  ]);
}

/**
 * Fetch all comments on an issue/PR to reconstruct conversation history.
 */
export async function fetchCommentThread(
  repo: string,
  issueNumber: number,
): Promise<ThreadComment[]> {
  const { stdout, exitCode } = await exec([
    "gh", "api",
    `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    "--jq",
    `.[] | {id: .id, author: .user.login, body: .body, createdAt: .created_at}`,
  ]);

  if (exitCode !== 0 || !stdout.trim()) return [];

  const comments: ThreadComment[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      comments.push({
        id: parsed.id,
        author: parsed.author,
        body: parsed.body,
        createdAt: parsed.createdAt,
        // Detect this action's own comments via the invisible marker; fall
        // back to the legacy "Software Teams <sup>" header for comments
        // written before the discreet-mode rename so existing threads still
        // bridge correctly.
        isSoftwareTeams:
          parsed.body.includes(ASSISTANT_COMMENT_MARKER) ||
          parsed.body.includes(LEGACY_ASSISTANT_MARKER),
      });
    } catch {
      // skip malformed lines
    }
  }

  // Keep only the most recent 100 comments
  return comments.slice(-100);
}

/**
 * Format verification results as a collapsible markdown section.
 */
export function formatVerificationResults(results: { passed: boolean; gates: Array<{ name: string; command: string; passed: boolean; output: string }> }): string {
  const icon = results.passed ? "✅" : "❌";
  const status = results.passed ? "All gates passed" : "Some gates failed";
  const rows = results.gates.map((g) => {
    const gateIcon = g.passed ? "✅" : "❌";
    const output = g.output.trim() ? `\n<pre>${g.output.trim().slice(0, 500)}</pre>` : "";
    return `${gateIcon} **${g.name}** — \`${g.command}\`${output}`;
  }).join("\n\n");

  return [
    `<details>`,
    `<summary>${icon} Quality Gates — ${status}</summary>`,
    ``,
    rows,
    ``,
    `</details>`,
  ].join("\n");
}

/**
 * Build a conversation history string from the comment thread.
 * Includes previous trigger-phrase commands ("Hey AI ..."), assistant responses, and user feedback.
 */
export function buildConversationContext(
  thread: ThreadComment[],
  currentCommentId: number,
): { history: string; previousRuns: number; isFollowUp: boolean; isPostImplementation: boolean } {
  const currentIdx = thread.findIndex((c) => c.id === currentCommentId);
  const relevantComments = currentIdx < 0 ? thread : thread.slice(0, currentIdx);

  const segments = relevantComments.reduce<{ result: ThreadComment[]; active: boolean }>(
    (acc, comment) => {
      const matchesTriggerPhrase = /hey\s+software[\s-]?teams/i.test(comment.body);
      if (matchesTriggerPhrase || comment.isSoftwareTeams) {
        return { result: [...acc.result, comment], active: true };
      }
      if (acc.active) {
        return { result: [...acc.result, comment], active: true };
      }
      return acc;
    },
    { result: [], active: false },
  ).result;

  const previousRuns = segments.filter((c) => c.isSoftwareTeams).length;

  const isFollowUp = previousRuns > 0;

  const isPostImplementation = segments.some(
    (c) =>
      c.isSoftwareTeams &&
      (c.body.includes("Implementation done!") || c.body.includes("<sup>implement</sup>")),
  );

  if (segments.length === 0) {
    return { history: "", previousRuns: 0, isFollowUp: false, isPostImplementation: false };
  }

  const lines = segments.reduce<string[]>(
    (acc, comment) => {
      const role = comment.isSoftwareTeams ? "AI assistant" : `@${comment.author}`;
      const body = comment.isSoftwareTeams && comment.body.length > 2000
        ? comment.body.slice(0, 2000) + "\n\n... (truncated)"
        : comment.body;
      return [...acc, `**${role}** (${comment.createdAt}):`, body, ""];
    },
    ["## Previous Conversation", ""],
  );

  return { history: lines.join("\n"), previousRuns, isFollowUp, isPostImplementation };
}

// Invisible HTML marker — used by `fetchCommentThread` to detect assistant
// comments without exposing the "Software Teams" brand to users. Stable
// across header reword cycles; never user-visible.
export const ASSISTANT_COMMENT_MARKER = "<!-- st-action -->";

// Legacy marker (pre-discreet-mode) — comments posted by older versions used
// `<h3>... Software Teams <sup>...</sup></h3>`. Kept as a fallback detection
// pattern so existing threads in repos that upgraded mid-cycle still bridge
// correctly.
const LEGACY_ASSISTANT_MARKER = "Software Teams <sup>";

interface CommandHeader {
  emoji: string;
  ok: string;        // success/done header
  fail: string;      // failure header
}

const COMMAND_HEADERS: Record<string, CommandHeader> = {
  plan:      { emoji: "🔮", ok: "Plan is ready!",                 fail: "Plan didn't work out" },
  questions: { emoji: "🔮", ok: "A few questions before I plan",  fail: "Couldn't gather pre-plan questions" },
  implement: { emoji: "▶",  ok: "Implementation done!",           fail: "Implementation didn't go through" },
  quick:     { emoji: "⚡", ok: "Quick fix done!",                fail: "Quick fix didn't go through" },
  review:    { emoji: "💠", ok: "Review complete",                fail: "Review didn't finish" },
  feedback:  { emoji: "🌀", ok: "Feedback addressed",             fail: "Couldn't address feedback" },
  ping:      { emoji: "🔹", ok: "Status",                         fail: "Status check failed" },
  auth:      { emoji: "🚫", ok: "Access denied",                  fail: "Access denied" },
};

const DEFAULT_HEADER: CommandHeader = { emoji: "◈", ok: "Done", fail: "Didn't finish" };

export function formatSoftwareTeamsComment(
  command: string,
  response: string,
): string {
  const header = COMMAND_HEADERS[command] ?? DEFAULT_HEADER;
  return [
    ASSISTANT_COMMENT_MARKER,
    `<h3>${header.emoji} ${header.ok}</h3>`,
    ``,
    `---`,
    ``,
    response,
  ].join("\n");
}

export function formatErrorComment(
  command: string,
  summary: string,
): string {
  const header = COMMAND_HEADERS[command] ?? DEFAULT_HEADER;
  return [
    ASSISTANT_COMMENT_MARKER,
    `<h3>${header.emoji} ${header.fail}</h3>`,
    ``,
    `---`,
    ``,
    summary,
  ].join("\n");
}
