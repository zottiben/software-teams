import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "fs";
import { exec, gitRoot } from "../utils/git";
import { readAdapter } from "../utils/adapter";
import { readState, writeState } from "../utils/state";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export const worktreeCommand = defineCommand({
  meta: {
    name: "worktree",
    description: "Create a git worktree with optional environment setup",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree/branch name",
      required: true,
    },
    lightweight: {
      type: "boolean",
      description: "Skip environment setup (deps only)",
      default: false,
    },
    base: {
      type: "string",
      description: "Base branch to create from",
      default: "HEAD",
    },
  },
  async run({ args }) {
    const root = await gitRoot();
    if (!root) {
      consola.error("Not in a git repository.");
      return;
    }

    const slug = slugify(args.name);
    const worktreePath = `${root}/.worktrees/${slug}`;

    if (existsSync(worktreePath)) {
      consola.error(`Worktree already exists at ${worktreePath}`);
      return;
    }

    // Check branch doesn't already exist
    const { stdout: branches } = await exec(["git", "branch", "--list", slug]);
    if (branches.trim()) {
      consola.error(`Branch "${slug}" already exists. Choose a different name.`);
      return;
    }

    // Create worktree
    consola.start(`Creating worktree: ${slug}`);
    const { exitCode } = await exec([
      "git", "worktree", "add", "-b", slug, worktreePath, args.base,
    ]);
    if (exitCode !== 0) {
      consola.error("Failed to create worktree.");
      return;
    }
    consola.success(`Worktree created at ${worktreePath}`);

    // Read adapter for setup steps
    const adapter = await readAdapter(root);

    if (adapter?.worktree) {
      const wt = adapter.worktree;

      // Full setup unless lightweight
      if (!args.lightweight) {
        if (wt.env_setup) {
          for (const cmd of wt.env_setup) {
            consola.start(`Running: ${cmd}`);
            await exec(["sh", "-c", cmd], worktreePath);
          }
        }
        if (wt.database?.create) {
          consola.start("Creating database...");
          await exec(["sh", "-c", wt.database.create], worktreePath);
        }
        if (wt.web_server?.setup) {
          consola.start("Setting up web server...");
          await exec(["sh", "-c", wt.web_server.setup], worktreePath);
        }
      }

      // Always run dependency install
      if (adapter.dependency_install) {
        consola.start(`Installing dependencies: ${adapter.dependency_install}`);
        await exec(["sh", "-c", adapter.dependency_install], worktreePath);
      }

      // Migrations and seeders (unless lightweight)
      if (!args.lightweight) {
        if (wt.database?.migrate) {
          consola.start("Running migrations...");
          await exec(["sh", "-c", wt.database.migrate], worktreePath);
        }
        if (wt.database?.seed) {
          consola.start("Running seeders...");
          await exec(["sh", "-c", wt.database.seed], worktreePath);
        }
      }
    } else if (adapter?.dependency_install) {
      consola.start(`Installing dependencies: ${adapter.dependency_install}`);
      await exec(["sh", "-c", adapter.dependency_install], worktreePath);
    }

    // Update state
    const state = await readState(root) ?? {};
    state.worktree = {
      active: true,
      path: worktreePath,
      branch: slug,
    };
    await writeState(root, state);

    consola.success(`Worktree ready: ${worktreePath}`);
    consola.info(`  Branch: ${slug}`);
    consola.info(`  cd ${worktreePath}`);
  },
});
