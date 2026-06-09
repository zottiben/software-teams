import { gitBranch, gitCheckoutNewBranch, slugify } from "../../../utils/git";
import { isPullRequest } from "../../../utils/github";
import type { FeatureBranchContext } from "./types";

/**
 * When the trigger came from an issue (no associated PR), cut a feature
 * branch off the current (default) branch BEFORE any agent runs so that the
 * implementation lands on a reviewable PR — never directly on main/master.
 * Returns null for PR-context runs (existing flow unchanged).
 *
 * Branch name format: `issue-<N>-<slug>` where slug is derived from the
 * user's description with leading command verbs ("implement", "quick",
 * "plan", "do", "the") stripped. No "software-teams/" prefix — the
 * branch name surfaces in PR titles when GitHub falls back from
 * commit-message derivation, and we don't want the brand leaking there.
 *
 * Examples:
 *   "Hey Software Teams implement the plan" (issue 49)
 *     description = "implement the plan"
 *     slug after strip = "plan" (leading "implement the" → leading verbs)
 *     branch = "issue-49-plan"
 *   "Hey Software Teams quick fix the nav bug" (issue 50)
 *     description = "fix the nav bug"
 *     slug after strip = "fix-the-nav-bug" (no leading command-verb to strip)
 *     branch = "issue-50-fix-the-nav-bug"
 */
/**
 * Derive the slug used in the feature-branch name. Prefers the plan's
 * filename slug (most specific to the work — e.g. `01-01-users-api.orchestration.md`
 * yields `users-api`) over the user's free-form description (often just
 * "implement the plan"). Falls back to the description, then to "task"
 * when both are empty.
 */
export function deriveFeatureBranchSlug(opts: {
  description: string;
  orchestrationPath?: string;
}): string {
  if (opts.orchestrationPath) {
    const filename = opts.orchestrationPath.split("/").pop() ?? "";
    const planSlug = filename
      .replace(/\.orchestration\.md$/, "")
      // Strip leading phase/plan numeric prefixes like `01-01-` or `1-02-`.
      .replace(/^\d+-\d+-/, "")
      .replace(/^\d+-/, "");
    const slugged = slugify(planSlug, 40);
    if (slugged && slugged !== "task") return slugged;
  }

  // Fallback: strip leading filler verbs/articles the user often types after
  // the trigger phrase ("implement the plan", "quick fix the foo", etc.) so
  // the slug doesn't double up with the command word.
  const stripped = opts.description
    .replace(/^\s*(implement|quick|plan|do|the)\s+/i, "")
    .replace(/^\s*(implement|quick|plan|do|the)\s+/i, "")
    .trim();
  const slugBase = stripped.length > 0 ? stripped : opts.description;
  return slugify(slugBase, 40);
}

export async function prepareIssueFeatureBranch(opts: {
  cwd: string;
  repo: string | undefined;
  issueNumber: number;
  description: string;
  commandKind: "implement" | "quick";
  orchestrationPath?: string;
}): Promise<FeatureBranchContext | null> {
  if (!opts.repo || !opts.issueNumber) return null;
  if (await isPullRequest(opts.repo, opts.issueNumber)) return null;

  const defaultBranch = await gitBranch();
  const slug = deriveFeatureBranchSlug({
    description: opts.description,
    orchestrationPath: opts.orchestrationPath,
  });

  const branchName = `issue-${opts.issueNumber}-${slug}`;
  await gitCheckoutNewBranch(branchName, opts.cwd);
  return { branchName, defaultBranch };
}
