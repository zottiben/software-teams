import { defineCommand } from "citty";
import { consola } from "consola";
import { exec, gitRoot } from "../utils/git";
import { readAdapter } from "../utils/adapter";
import { readState, writeState } from "../utils/state";

export const worktreeRemoveCommand = defineCommand({
  meta: {
    name: "worktree-remove",
    description: "Remove a git worktree and clean up resources",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name to remove (defaults to current worktree from state)",
      required: false,
    },
    force: {
      type: "boolean",
      description: "Skip confirmation",
      default: false,
    },
    "keep-branch": {
      type: "boolean",
      description: "Keep the branch after removing worktree",
      default: false,
    },
  },
  async run({ args }) {
    const root = await gitRoot();
    if (!root) {
      consola.error("Not in a git repository.");
      return;
    }

    // Determine which worktree to remove
    let name = args.name as string | undefined;
    let worktreePath: string;

    if (name) {
      worktreePath = `${root}/.worktrees/${name}`;
    } else {
      // Try state.yaml
      const state = await readState(root);
      if (state?.worktree?.active && state.worktree.path && state.worktree.branch) {
        name = state.worktree.branch;
        worktreePath = state.worktree.path;
      } else {
        // List worktrees and let user see
        const { stdout } = await exec(["git", "worktree", "list"]);
        consola.info("Active worktrees:");
        consola.info(stdout);
        consola.info("\nSpecify a worktree name: software-teams worktree-remove <name>");
        return;
      }
    }

    // Confirm
    if (!args.force) {
      const confirmed = await consola.prompt(`Remove worktree "${name}" at ${worktreePath}?`, {
        type: "confirm",
      });
      if (!confirmed) {
        consola.info("Aborted.");
        return;
      }
    }

    // Run adapter cleanup
    const adapter = await readAdapter(root);
    if (adapter?.worktree) {
      const wt = adapter.worktree;
      if (wt.database?.drop) {
        consola.start("Dropping database...");
        await exec(["sh", "-c", wt.database.drop], worktreePath);
      }
      if (wt.web_server?.cleanup) {
        consola.start("Cleaning up web server...");
        await exec(["sh", "-c", wt.web_server.cleanup], worktreePath);
      }
      if (wt.cleanup) {
        for (const cmd of wt.cleanup) {
          consola.start(`Cleanup: ${cmd}`);
          await exec(["sh", "-c", cmd], worktreePath);
        }
      }
    }

    // Remove worktree
    consola.start("Removing worktree...");
    const { exitCode } = await exec(["git", "worktree", "remove", worktreePath, "--force"]);
    if (exitCode !== 0) {
      consola.error("Failed to remove worktree.");
      return;
    }

    // Delete branch
    if (!args["keep-branch"] && name) {
      consola.start(`Deleting branch: ${name}`);
      await exec(["git", "branch", "-D", name]);
    }

    // Update state
    const state = await readState(root) ?? {};
    state.worktree = { active: false, path: null, branch: null };
    await writeState(root, state);

    consola.success(`Worktree "${name}" removed.`);
  },
});
