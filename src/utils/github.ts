import { exec } from "./git";

/**
 * Fetch the title and body of a GitHub issue via `gh api`.
 * Returns null on non-zero exit (e.g. network failure, not found).
 * GitHub returns null for empty issue bodies — coerced to empty string.
 */
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
        // Detect Software Teams' own comments by the header.
        isSoftwareTeams: parsed.body.includes("Software Teams <sup>"),
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
 * Includes previous "Hey software-teams" commands, Software Teams responses, and user feedback.
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

  // Detect if implementation has already happened (Software Teams posted an "implement" response)
  const isPostImplementation = segments.some(
    (c) => c.isSoftwareTeams && c.body.includes("<sup>implement</sup>"),
  );

  if (segments.length === 0) {
    return { history: "", previousRuns: 0, isFollowUp: false, isPostImplementation: false };
  }

  // Format as conversation log
  const lines: string[] = ["## Previous Conversation", ""];
  for (const comment of segments) {
    const role = comment.isSoftwareTeams ? "Software Teams" : `@${comment.author}`;
    // Truncate long Software Teams responses to keep context manageable
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

const COMMAND_EMOJI: Record<string, string> = {
  plan: "🔮",
  implement: "▶",
  quick: "⚡",
  review: "💠",
  feedback: "🌀",
  ping: "🔹",
};

export function formatSoftwareTeamsComment(
  command: string,
  response: string,
): string {
  const emoji = COMMAND_EMOJI[command] ?? "◈";
  return [
    `<h3>${emoji} Software Teams <sup>${command}</sup></h3>`,
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
  const emoji = COMMAND_EMOJI[command] ?? "◈";
  return [
    `<h3>${emoji} Software Teams <sup>${command} · failed</sup></h3>`,
    ``,
    `---`,
    ``,
    summary,
  ].join("\n");
}
