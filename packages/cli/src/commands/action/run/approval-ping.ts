import { consola } from "consola";
import { readState, writeState } from "../../../utils/state";
import { buildRulesBlock } from "../../../utils/prompt-builder";
import {
  postGitHubComment,
  updateGitHubComment,
  reactToComment,
  formatSoftwareTeamsComment,
} from "../../../utils/github";
import { setLifecycleLabel } from "../../../utils/labels";
import type { ParsedIntent } from "./types";

/**
 * Handle the approval fast-path — no Claude invocation needed.
 * Updates state.yaml, posts the confirmation comment, and sets the
 * plan-approved lifecycle label. Returns after posting.
 */
export async function runApprovalHandler(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  commentId: number | null;
  placeholderCommentId: number | null;
  intent: ParsedIntent;
}): Promise<void> {
  const { cwd, repo, issueNumber, commentId, placeholderCommentId } = opts;

  // Update state.yaml using proper YAML parser
  const state = await readState(cwd) ?? {};
  state.review = {
    ...state.review,
    status: "approved",
    approved_at: new Date().toISOString(),
  } as any;
  await writeState(cwd, state);

  const approvalBody = `Plan approved and locked in.\n\nSay **\`Hey Software Teams implement\`** when you're ready to go.`;
  const finalBody = formatSoftwareTeamsComment("plan", approvalBody);

  if (repo && placeholderCommentId) {
    await updateGitHubComment(repo, placeholderCommentId, finalBody).catch((err) => {
      consola.error("Failed to update approval comment:", err);
    });
  } else if (repo && issueNumber) {
    await postGitHubComment(repo, issueNumber, finalBody).catch((err) => {
      consola.error("Failed to post approval comment:", err);
    });
  } else {
    console.log(finalBody);
  }

  if (repo && commentId) {
    await reactToComment(repo, commentId, "+1").catch(() => {});
  }
  // Lifecycle label: plan locked in, awaiting `Hey Software Teams implement`.
  if (repo && issueNumber) {
    await setLifecycleLabel(repo, issueNumber, "plan-approved").catch(() => {});
  }
}

/**
 * Handle the ping fast-path — framework status check, no Claude invocation.
 * Posts a status table comment and returns.
 */
export async function runPingHandler(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  commentId: number | null;
  placeholderCommentId: number | null;
}): Promise<void> {
  const { cwd, repo, issueNumber, commentId, placeholderCommentId } = opts;

  const { existsSync } = await import("fs");
  const { join } = await import("path");

  const frameworkExists = existsSync(join(cwd, ".software-teams/framework"));
  const claudeMdExists = existsSync(join(cwd, ".claude/CLAUDE.md"));
  const stateExists = existsSync(join(cwd, ".software-teams/config/state.yaml"));
  const rulesExists = existsSync(join(cwd, ".software-teams/rules"));

  let version = "unknown";
  try {
    const pkgPath = join(cwd, "node_modules/@websitelabs/software-teams/package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      version = pkg.version;
    }
  } catch {}

  const statusBody = [
    `**Framework Status**`,
    ``,
    `| Component | Status |`,
    `|-----------|--------|`,
    `| Framework files | ${frameworkExists ? "found" : "missing"} |`,
    `| CLAUDE.md | ${claudeMdExists ? "found" : "missing"} |`,
    `| State config | ${stateExists ? "found" : "missing"} |`,
    `| Rules | ${rulesExists ? "found" : "missing"} |`,
    `| Version | \`${version}\` |`,
  ].join("\n");

  const finalBody = formatSoftwareTeamsComment("ping", statusBody);

  if (repo && placeholderCommentId) {
    await updateGitHubComment(repo, placeholderCommentId, finalBody).catch((err) => {
      consola.error("Failed to update ping comment:", err);
    });
  } else if (repo && issueNumber) {
    await postGitHubComment(repo, issueNumber, finalBody).catch((err) => {
      consola.error("Failed to post ping comment:", err);
    });
  } else {
    console.log(finalBody);
  }

  if (repo && commentId) {
    await reactToComment(repo, commentId, "+1").catch(() => {});
  }
}

// Re-export so command.ts can use buildRulesBlock without an extra import
export { buildRulesBlock };
