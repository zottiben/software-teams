import { exec } from "./git";

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
  // Filter to only Software-Teams-related comments (commands, responses, feedback between them).
  const segments: ThreadComment[] = [];
  let inConversation = false;

  for (const comment of thread) {
    // Don't include the current triggering comment
    if (comment.id === currentCommentId) break;

    if (/hey\s+software[\s-]?teams/i.test(comment.body)) {
      inConversation = true;
      segments.push(comment);
    } else if (inConversation) {
      // Include all comments between trigger and Software Teams responses
      segments.push(comment);
    }
  }

  const previousRuns = segments.filter((c) => c.isSoftwareTeams).length;

  // Determine if this is a follow-up to an existing conversation
  const isFollowUp = previousRuns > 0;

  // Detect if implementation has already happened (assistant posted an
  // implement response). The new headers don't include the command name
  // verbatim — match against both new and legacy forms.
  const isPostImplementation = segments.some(
    (c) =>
      c.isSoftwareTeams &&
      (c.body.includes("Implementation done!") || c.body.includes("<sup>implement</sup>")),
  );

  if (segments.length === 0) {
    return { history: "", previousRuns: 0, isFollowUp: false, isPostImplementation: false };
  }

  // Format as conversation log. The role label "AI assistant" stays
  // generic — never expose the internal "Software Teams" brand to the
  // subagent's conversation history either.
  const lines: string[] = ["## Previous Conversation", ""];
  for (const comment of segments) {
    const role = comment.isSoftwareTeams ? "AI assistant" : `@${comment.author}`;
    let body = comment.body;
    if (comment.isSoftwareTeams && body.length > 2000) {
      body = body.slice(0, 2000) + "\n\n... (truncated)";
    }
    lines.push(`**${role}** (${comment.createdAt}):`);
    lines.push(body);
    lines.push("");
  }

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
  plan:     { emoji: "🔮", ok: "Plan is ready!",       fail: "Plan didn't work out" },
  implement:{ emoji: "▶",  ok: "Implementation done!", fail: "Implementation didn't go through" },
  quick:    { emoji: "⚡", ok: "Quick fix done!",      fail: "Quick fix didn't go through" },
  review:   { emoji: "💠", ok: "Review complete",      fail: "Review didn't finish" },
  feedback: { emoji: "🌀", ok: "Feedback addressed",   fail: "Couldn't address feedback" },
  ping:     { emoji: "🔹", ok: "Status",               fail: "Status check failed" },
  auth:     { emoji: "🚫", ok: "Access denied",        fail: "Access denied" },
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
