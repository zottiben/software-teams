/**
 * Lifecycle labels for issues/PRs that pass through Software Teams.
 *
 * One label at a time per target — when the runner advances the
 * workflow (researcher → planner → approval → implementation), the new
 * label replaces any other Software Teams lifecycle label that was
 * present so the board reflects the CURRENT state, not the history.
 *
 * Failure handling: label add/remove/create errors log a warning but
 * never throw. The work shipping (a comment posted, a PR created)
 * matters more than the cosmetic label, and a missing `issues: write`
 * permission shouldn't fail the run.
 */

import { consola } from "consola";
import { exec } from "./git";

export const LIFECYCLE_LABELS = [
  "questions-pending",
  "plan-ready",
  "plan-approved",
  "ready-to-review",
] as const;

export type LifecycleLabel = (typeof LIFECYCLE_LABELS)[number];

const LABEL_META: Record<LifecycleLabel, { color: string; description: string }> = {
  "questions-pending": {
    color: "fbca04",
    description: "Software Teams: pre-plan researcher has questions for the user",
  },
  "plan-ready": {
    color: "1d76db",
    description: "Software Teams: plan produced; awaiting approval or implementation",
  },
  "plan-approved": {
    color: "0e8a16",
    description: "Software Teams: plan approved; awaiting Hey Software Teams implement",
  },
  "ready-to-review": {
    color: "5319e7",
    description: "Software Teams: implementation finished; PR ready for review",
  },
};

/**
 * Add `label` to the issue/PR, removing any other Software Teams
 * lifecycle labels that are currently present. Auto-creates the label
 * in the repo if it doesn't exist. All failures are logged-only.
 */
export async function setLifecycleLabel(
  repo: string,
  number: number,
  label: LifecycleLabel,
): Promise<void> {
  if (!repo || !number) return;
  await ensureLabelExists(repo, label);

  // Only attempt to remove labels that are ACTUALLY on the target —
  // `gh issue edit --remove-label X` errors out when X isn't present,
  // which would also kill the --add-label part of the same command.
  const current = await getCurrentLabels(repo, number);
  const toRemove = LIFECYCLE_LABELS.filter((l) => l !== label && current.includes(l));
  if (current.includes(label) && toRemove.length === 0) return; // nothing to do

  const args = ["gh", "issue", "edit", String(number), "--repo", repo, "--add-label", label];
  for (const r of toRemove) args.push("--remove-label", r);
  const { exitCode } = await exec(args);
  if (exitCode !== 0) {
    consola.warn(`Failed to set lifecycle label '${label}' on ${repo}#${number} (exit ${exitCode})`);
  }
}

async function ensureLabelExists(repo: string, label: LifecycleLabel): Promise<void> {
  const meta = LABEL_META[label];
  // `--force` makes label create idempotent (creates or updates).
  const { exitCode } = await exec([
    "gh", "label", "create", label,
    "--repo", repo,
    "--color", meta.color,
    "--description", meta.description,
    "--force",
  ]);
  if (exitCode !== 0) {
    consola.warn(`Failed to ensure label '${label}' exists in ${repo} (exit ${exitCode})`);
  }
}

async function getCurrentLabels(repo: string, number: number): Promise<string[]> {
  const { stdout, exitCode } = await exec([
    "gh", "issue", "view", String(number),
    "--repo", repo,
    "--json", "labels",
  ]);
  if (exitCode !== 0) return [];
  try {
    const data = JSON.parse(stdout) as { labels?: { name: string }[] };
    return (data.labels ?? []).map((l) => l.name);
  } catch {
    return [];
  }
}

/**
 * Find the open PR whose head branch matches `branch`. Returns the PR
 * number or null. Used by the implement flow to label the PR (and the
 * originating issue) with `ready-to-review` once the programmer has
 * pushed and opened a PR.
 */
export async function findPrForBranch(
  repo: string,
  branch: string,
): Promise<number | null> {
  const { stdout, exitCode } = await exec([
    "gh", "pr", "list",
    "--repo", repo,
    "--head", branch,
    "--state", "open",
    "--json", "number",
    "--limit", "1",
  ]);
  if (exitCode !== 0) return null;
  try {
    const data = JSON.parse(stdout) as { number: number }[];
    return data[0]?.number ?? null;
  } catch {
    return null;
  }
}
