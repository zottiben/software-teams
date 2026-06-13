import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "node:fs";
import { exec, gitRoot } from "../utils/git";
import { readState, writeState } from "../utils/state";

// ---------------------------------------------------------------------------
// `software-teams worktree-merge` — the deterministic merge-back that completes
// ST's worktree story. ST owns the worktree name/branch (created by
// `software-teams worktree <name>`), so there is no discovery gap: work is
// committed on the worktree's branch and this merges that branch into the
// current branch, then optionally removes the worktree.
//
// Reliable by design: it merges COMMITTED work (ST's orchestrator commits in the
// worktree). Uncommitted changes are reported, not silently dropped. Conflicts
// abort cleanly and are reported for manual resolution.
// ---------------------------------------------------------------------------

export interface MergeWorktreeOptions {
  name?: string;
  remove?: boolean;
  noFf?: boolean;
}

export interface MergeWorktreeResult {
  merged: boolean;
  branch: string;
  reason?: "uncommitted" | "nothing-to-merge" | "conflict" | "not-found" | "same-branch";
  removed?: boolean;
}

async function resolveWorktree(
  root: string,
  nameArg: string | undefined,
): Promise<{ name: string; path: string } | null> {
  if (nameArg) return { name: nameArg, path: `${root}/.worktrees/${nameArg}` };
  const state = await readState(root);
  if (state?.worktree?.active && state.worktree.path && state.worktree.branch) {
    return { name: String(state.worktree.branch), path: String(state.worktree.path) };
  }
  return null;
}

export async function mergeWorktree(
  root: string,
  opts: MergeWorktreeOptions,
): Promise<MergeWorktreeResult> {
  const wt = await resolveWorktree(root, opts.name);
  if (!wt) {
    return { merged: false, branch: "", reason: "not-found" };
  }
  const branch = wt.name;

  const { stdout: cur } = await exec(["git", "rev-parse", "--abbrev-ref", "HEAD"], root);
  if (cur === branch) {
    return { merged: false, branch, reason: "same-branch" };
  }

  // Uncommitted work in the worktree would NOT be carried by a branch merge.
  if (existsSync(wt.path)) {
    const { stdout: dirty } = await exec(["git", "-C", wt.path, "status", "--porcelain"]);
    if (dirty.trim().length > 0) {
      return { merged: false, branch, reason: "uncommitted" };
    }
  }

  // Anything to merge? (commits on `branch` not reachable from current HEAD)
  const { stdout: ahead } = await exec(["git", "rev-list", "--count", `HEAD..${branch}`], root);
  if ((Number.parseInt(ahead, 10) || 0) === 0) {
    const removed = opts.remove ? await removeWorktree(root, wt) : false;
    return { merged: false, branch, reason: "nothing-to-merge", removed };
  }

  const mergeArgs = ["git", "merge"];
  if (opts.noFf) mergeArgs.push("--no-ff");
  mergeArgs.push(branch, "-m", `merge: software-teams worktree '${branch}' into ${cur}`);
  const { exitCode } = await exec(mergeArgs, root);
  if (exitCode !== 0) {
    await exec(["git", "merge", "--abort"], root); // leave a clean tree
    return { merged: false, branch, reason: "conflict" };
  }

  const removed = opts.remove ? await removeWorktree(root, wt) : false;
  return { merged: true, branch, removed };
}

async function removeWorktree(root: string, wt: { name: string; path: string }): Promise<boolean> {
  const { exitCode } = await exec(["git", "worktree", "remove", wt.path, "--force"], root);
  if (exitCode !== 0) return false;
  await exec(["git", "branch", "-D", wt.name], root);
  const state = await readState(root);
  if (state?.worktree?.branch === wt.name || state?.worktree?.path === wt.path) {
    state.worktree = { active: false, path: null, branch: null };
    await writeState(root, state);
  }
  return true;
}

export const worktreeMergeCommand = defineCommand({
  meta: {
    name: "worktree-merge",
    description: "Merge a Software Teams worktree's branch back into the current branch (and optionally remove it)",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree/branch name to merge (defaults to the active worktree from state)",
      required: false,
    },
    remove: { type: "boolean", description: "Remove the worktree + branch after a successful merge", default: false },
    "no-ff": { type: "boolean", description: "Force a merge commit even when fast-forward is possible", default: false },
  },
  async run({ args }) {
    const root = await gitRoot();
    if (!root) {
      consola.error("Not in a git repository.");
      process.exit(1);
    }
    const result = await mergeWorktree(root, {
      name: args.name as string | undefined,
      remove: Boolean(args.remove),
      noFf: Boolean(args["no-ff"]),
    });

    switch (result.reason) {
      case "not-found":
        consola.error("No worktree specified and none active in state. Usage: software-teams worktree-merge <name>");
        { const { stdout } = await exec(["git", "worktree", "list"], root); consola.info(stdout); }
        process.exit(1);
        break;
      case "same-branch":
        consola.error(`The worktree branch '${result.branch}' is the current branch — nothing to merge into.`);
        process.exit(1);
        break;
      case "uncommitted":
        consola.error(`Worktree '${result.branch}' has uncommitted changes. Commit them in the worktree first (a branch merge only moves committed work).`);
        process.exit(1);
        break;
      case "conflict":
        consola.error(`Merge of '${result.branch}' hit conflicts — aborted to keep your tree clean. Resolve manually: git merge ${result.branch}`);
        process.exit(1);
        break;
      case "nothing-to-merge":
        consola.info(`Worktree '${result.branch}' has no commits ahead of the current branch — nothing to merge.${result.removed ? " Worktree removed." : ""}`);
        process.exit(0);
        break;
      default:
        consola.success(`Merged worktree '${result.branch}' into the current branch.${result.removed ? " Worktree removed." : ""}`);
        process.exit(0);
    }
  },
});
