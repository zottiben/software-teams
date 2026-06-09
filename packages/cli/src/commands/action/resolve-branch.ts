import { defineCommand } from "citty";
import { consola } from "consola";
import { appendFileSync } from "node:fs";

export interface ResolveBranchOptions {
  prHeadRef?: string;
  prNumber?: string;
  repo?: string;
}

function writeGitHubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

/**
 * Resolve the branch name for a PR.
 * If prHeadRef is provided, returns it directly.
 * Otherwise, fetches the branch from the GitHub API using the PR number.
 * Returns null if neither is available.
 */
export function resolveBranch(opts: ResolveBranchOptions): string | null {
  if (opts.prHeadRef) {
    return opts.prHeadRef;
  }

  if (opts.prNumber && opts.repo) {
    const result = Bun.spawnSync(
      ["gh", "api", `repos/${opts.repo}/pulls/${opts.prNumber}`, "--jq", ".head.ref"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode === 0) {
      const branch = result.stdout.toString().trim();
      if (branch) return branch;
    } else {
      consola.warn(`Failed to resolve branch via API: ${result.stderr.toString().trim()}`);
    }
  }

  return null;
}

export const resolveBranchCommand = defineCommand({
  meta: {
    name: "resolve-branch",
    description: "Resolve the PR head branch for checkout",
  },
  args: {
    "pr-head-ref": {
      type: "string",
      description: "The PR head ref (if available from event context)",
    },
    "pr-number": {
      type: "string",
      description: "The PR number to look up",
    },
    repo: {
      type: "string",
      description: "Repository in owner/repo format",
      required: true,
    },
  },
  run({ args }) {
    const branch = resolveBranch({
      prHeadRef: args["pr-head-ref"],
      prNumber: args["pr-number"],
      repo: args.repo,
    });

    if (branch) {
      writeGitHubOutput("branch", branch);
    } else {
      consola.info("No branch resolved — no PR context available");
    }
  },
});
