import { exec } from "./git";

export interface ThreadComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  isJdi: boolean;
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
        // Detect JDI's own comments by the header
        isJdi: parsed.body.includes("JDI <sup>"),
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
 * Includes previous "Hey jdi" commands, JDI responses, and user feedback.
 */
export function buildConversationContext(
  thread: ThreadComment[],
  currentCommentId: number,
): { history: string; previousJdiRuns: number; isFollowUp: boolean; isPostImplementation: boolean } {
  // Filter to only JDI-related comments (commands, responses, feedback between them)
  const jdiSegments: ThreadComment[] = [];
  let inJdiConversation = false;

  for (const comment of thread) {
    // Don't include the current triggering comment
    if (comment.id === currentCommentId) break;

    if (/hey\s+jdi/i.test(comment.body)) {
      inJdiConversation = true;
      jdiSegments.push(comment);
    } else if (inJdiConversation) {
      // Include all comments between "Hey jdi" triggers and JDI responses
      jdiSegments.push(comment);
      if (comment.isJdi) {
        // JDI responded — keep tracking for follow-up feedback
      }
    }
  }

  const previousJdiRuns = jdiSegments.filter((c) => c.isJdi).length;

  // Determine if this is a follow-up to an existing JDI conversation
  const isFollowUp = previousJdiRuns > 0;

  // Detect if implementation has already happened (JDI posted an "implement" response)
  const isPostImplementation = jdiSegments.some(
    (c) => c.isJdi && c.body.includes("<sup>implement</sup>"),
  );

  if (jdiSegments.length === 0) {
    return { history: "", previousJdiRuns: 0, isFollowUp: false, isPostImplementation: false };
  }

  // Format as conversation log
  const lines: string[] = ["## Previous Conversation", ""];
  for (const comment of jdiSegments) {
    const role = comment.isJdi ? "JDI" : `@${comment.author}`;
    // Truncate long JDI responses to keep context manageable
    let body = comment.body;
    if (comment.isJdi && body.length > 2000) {
      body = body.slice(0, 2000) + "\n\n... (truncated)";
    }
    lines.push(`**${role}** (${comment.createdAt}):`);
    lines.push(body);
    lines.push("");
  }

  return { history: lines.join("\n"), previousJdiRuns, isFollowUp, isPostImplementation };
}

const COMMAND_EMOJI: Record<string, string> = {
  plan: "🔮",
  implement: "▶",
  quick: "⚡",
  review: "💠",
  feedback: "🌀",
  ping: "🔹",
};

export function formatJdiComment(
  command: string,
  response: string,
): string {
  const emoji = COMMAND_EMOJI[command] ?? "◈";
  return [
    `<h3>${emoji} JDI <sup>${command}</sup></h3>`,
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
    `<h3>${emoji} JDI <sup>${command} · failed</sup></h3>`,
    ``,
    `---`,
    ``,
    summary,
  ].join("\n");
}
