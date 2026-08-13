import { defineCommand } from "citty";
import { consola } from "consola";
import { readAdapter } from "../utils/adapter";
import { exec } from "../utils/git";

/**
 * Provision the CURRENT directory as a working environment.
 *
 * Claude Code owns worktree creation, entry, and cleanup: `--worktree` for a
 * session, `isolation: worktree` for a subagent, `.worktreeinclude` to carry
 * gitignored files like `.env`. None of that provisions a database or starts a
 * web server, and there is no post-creation hook to hang that on - a
 * `WorktreeCreate` hook *replaces* git creation rather than following it.
 *
 * So this runs the adapter's setup steps in place, inside a worktree the
 * harness already made. It is the one piece of the retired `worktree` command
 * that has no native equivalent.
 */
export const provisionWorktreeCommand = defineCommand({
  meta: {
    name: "provision-worktree",
    description:
      "Run the adapter's environment setup (deps, database, web server) in the current directory",
  },
  args: {
    lightweight: {
      type: "boolean",
      description: "Dependencies and migrations only - skip database creation, seeds, web server",
      default: false,
    },
  },
  async run({ args }) {
    const adapter = await readAdapter(process.cwd());
    if (!adapter) {
      consola.warn("No adapter config found - nothing to provision.");
      return;
    }

    const run = async (label: string, command: string): Promise<void> => {
      consola.start(`${label}: ${command}`);
      const { exitCode } = await exec(["sh", "-c", command], process.cwd());
      if (exitCode !== 0) {
        consola.error(`${label} failed (exit ${exitCode}).`);
        process.exit(exitCode);
      }
    };

    const worktree = adapter.worktree;
    if (!args.lightweight && worktree?.env_setup) {
      for (const command of worktree.env_setup) await run("Env setup", command);
    }
    if (!args.lightweight && worktree?.database?.create) {
      await run("Create database", worktree.database.create);
    }
    if (!args.lightweight && worktree?.web_server?.setup) {
      await run("Web server", worktree.web_server.setup);
    }
    if (adapter.dependency_install) {
      await run("Install dependencies", adapter.dependency_install);
    }
    if (worktree?.database?.migrate) {
      await run("Migrate", worktree.database.migrate);
    }
    if (!args.lightweight && worktree?.database?.seed) {
      await run("Seed", worktree.database.seed);
    }

    consola.success("Environment provisioned.");
  },
});
