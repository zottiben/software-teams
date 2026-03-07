import { defineCommand } from "citty";
import { consola } from "consola";
import { exec } from "../utils/git";

interface ReviewComment {
  path: string;
  line: number | null;
  body: string;
  author: string;
  category: string;
  action: string;
}

function categorise(body: string): { category: string; action: string } {
  const lower = body.toLowerCase();

  if (lower.includes("must") || lower.includes("blocking") || lower.includes("critical") || lower.includes("required")) {
    return { category: "blocking", action: "Fix before merge" };
  }
  if (lower.includes("request") || lower.includes("please change") || lower.includes("should be")) {
    return { category: "change_request", action: "Apply requested change" };
  }
  if (lower.includes("?") && !lower.includes("nit")) {
    return { category: "question", action: "Respond with clarification" };
  }
  if (lower.includes("consider") || lower.includes("could") || lower.includes("maybe") || lower.includes("suggest")) {
    return { category: "suggestion", action: "Consider applying" };
  }
  if (lower.includes("nit") || lower.includes("minor") || lower.includes("optional")) {
    return { category: "nitpick", action: "Optional fix" };
  }

  return { category: "suggestion", action: "Review and decide" };
}

export const feedbackCommand = defineCommand({
  meta: {
    name: "feedback",
    description: "Fetch and categorise PR review comments",
  },
  args: {
    pr: {
      type: "positional",
      description: "PR number",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    // Check gh CLI
    const { exitCode: ghCheck } = await exec(["which", "gh"]);
    if (ghCheck !== 0) {
      consola.error("GitHub CLI (gh) is required. Install from https://cli.github.com");
      return;
    }

    const prNum = String(args.pr);

    // Get repo name
    const { stdout: repoJson, exitCode: repoExit } = await exec([
      "gh", "repo", "view", "--json", "nameWithOwner",
    ]);
    if (repoExit !== 0) {
      consola.error("Failed to detect repository. Are you in a GitHub repo?");
      return;
    }

    const { nameWithOwner } = JSON.parse(repoJson);

    // Fetch review comments
    const { stdout: commentsJson, exitCode: commentsExit } = await exec([
      "gh", "api", `repos/${nameWithOwner}/pulls/${prNum}/comments`,
    ]);
    if (commentsExit !== 0) {
      consola.error(`Failed to fetch comments for PR #${prNum}.`);
      return;
    }

    const rawComments = JSON.parse(commentsJson) as Array<{
      path?: string;
      line?: number;
      body: string;
      user?: { login: string };
    }>;

    // Also fetch review-level comments
    const { stdout: reviewsJson } = await exec([
      "gh", "api", `repos/${nameWithOwner}/pulls/${prNum}/reviews`,
    ]);
    const reviews = JSON.parse(reviewsJson || "[]") as Array<{
      body: string;
      user?: { login: string };
      state: string;
    }>;

    const comments: ReviewComment[] = rawComments.map((c) => {
      const { category, action } = categorise(c.body);
      return {
        path: c.path ?? "(general)",
        line: c.line ?? null,
        body: c.body,
        author: c.user?.login ?? "unknown",
        category,
        action,
      };
    });

    // Add review-level comments that have a body
    for (const r of reviews) {
      if (r.body?.trim()) {
        const { category, action } = categorise(r.body);
        comments.push({
          path: "(review)",
          line: null,
          body: r.body,
          author: r.user?.login ?? "unknown",
          category,
          action,
        });
      }
    }

    if (comments.length === 0) {
      consola.info(`No review comments found for PR #${prNum}.`);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(comments, null, 2));
      return;
    }

    // Priority order for display
    const priority = ["blocking", "change_request", "question", "suggestion", "nitpick"];

    consola.info(`PR #${prNum} — ${comments.length} comment(s)\n`);

    for (const cat of priority) {
      const items = comments.filter((c) => c.category === cat);
      if (items.length === 0) continue;

      consola.info(`## ${cat.toUpperCase()} (${items.length})`);
      for (const item of items) {
        const loc = item.line ? `${item.path}:${item.line}` : item.path;
        consola.info(`  [${loc}] @${item.author}`);
        consola.info(`    ${item.body.split("\n")[0]}`);
        consola.info(`    -> ${item.action}`);
      }
      consola.info("");
    }
  },
});
