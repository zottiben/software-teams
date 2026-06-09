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

async function readInstalledVersion(
  cwd: string,
  existsSync: (p: string) => boolean,
  join: (...parts: string[]) => string,
): Promise<string> {
  try {
    const pkgPath = join(cwd, "node_modules/@websitelabs/software-teams/package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      return pkg.version as string;
    }
  } catch {}
  return "unknown";
}

export async function runApprovalHandler(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  commentId: number | null;
  placeholderCommentId: number | null;
  intent: ParsedIntent;
}): Promise<void> {
  const { cwd, repo, issueNumber, commentId, placeholderCommentId } = opts;

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
  if (repo && issueNumber) {
    await setLifecycleLabel(repo, issueNumber, "plan-approved").catch(() => {});
  }
}

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

  const version = await readInstalledVersion(cwd, existsSync, join);

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

export { buildRulesBlock };
