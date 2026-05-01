import { defineCommand } from "citty";
import { consola } from "consola";
import { exec, gitDiffNames, gitStatus } from "../utils/git";
import { dirname } from "node:path";

export function detectType(files: string[]): string {
  if (files.every((f) => f.startsWith("test") || f.includes("__tests__") || f.includes(".test.") || f.includes(".spec."))) return "test";
  if (files.every((f) => f.endsWith(".md"))) return "docs";
  if (files.every((f) => f.includes("Dockerfile") || f.includes(".yml") || f.includes(".yaml") || f.includes(".github/"))) return "ci";

  // Check status to see if files are new
  const hasNew = files.length > 0; // simplified; refined below in run()
  return "feat";
}

export function detectScope(files: string[]): string | null {
  if (files.length === 0) return null;

  const dirs = files.map((f) => {
    const d = dirname(f);
    return d === "." ? null : d.split("/")[0];
  }).filter(Boolean);

  const unique = [...new Set(dirs)];
  if (unique.length === 1) return unique[0]!;
  return null;
}

export const commitCommand = defineCommand({
  meta: {
    name: "commit",
    description: "Auto-detect type/scope and create a conventional commit",
  },
  args: {
    message: {
      type: "positional",
      description: "Override commit message",
      required: false,
    },
    all: {
      type: "boolean",
      description: "Stage all changed files",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would be committed without committing",
      default: false,
    },
  },
  async run({ args }) {
    // Check for staged files first, fall back to unstaged
    let stagedFiles = await gitDiffNames(true);
    let needsStaging = false;

    if (stagedFiles.length === 0) {
      const unstagedFiles = await gitDiffNames(false);
      // Also check untracked files
      const status = await gitStatus();
      const untrackedFiles = status
        .split("\n")
        .filter((l) => l.startsWith("??"))
        .map((l) => l.slice(3));

      const allFiles = [...unstagedFiles, ...untrackedFiles];

      if (allFiles.length === 0) {
        consola.warn("No changes to commit.");
        return;
      }

      if (!args.all) {
        consola.info("No staged files. Changed files:");
        for (const f of allFiles) consola.info(`  ${f}`);
        consola.info("\nUse --all to stage and commit all, or stage files manually.");
        return;
      }

      stagedFiles = allFiles;
      needsStaging = true;
    }

    // Detect type from file paths
    const status = await gitStatus();
    const newFiles = status
      .split("\n")
      .filter((l) => l.startsWith("??") || l.startsWith("A "))
      .map((l) => l.slice(3).trim());

    let type: string;
    if (stagedFiles.every((f) => f.startsWith("test") || f.includes("__tests__") || f.includes(".test.") || f.includes(".spec."))) {
      type = "test";
    } else if (stagedFiles.every((f) => f.endsWith(".md"))) {
      type = "docs";
    } else if (stagedFiles.every((f) => f.includes("Dockerfile") || f.includes(".yml") || f.includes(".yaml") || f.includes(".github/"))) {
      type = "ci";
    } else if (stagedFiles.every((f) => newFiles.includes(f))) {
      type = "feat";
    } else {
      type = "feat";
    }

    const scope = detectScope(stagedFiles);
    const scopePart = scope ? `(${scope})` : "";

    // Build message
    let commitMsg: string;
    if (args.message) {
      commitMsg = args.message;
    } else {
      const filesSummary = stagedFiles.length <= 5
        ? stagedFiles.join(", ")
        : `${stagedFiles.length} files`;
      commitMsg = `${type}${scopePart}: update ${filesSummary}`;
    }

    // Dry run
    if (args["dry-run"]) {
      consola.info("Dry run — would commit:");
      consola.info(`  Message: ${commitMsg}`);
      consola.info(`  Files:`);
      for (const f of stagedFiles) consola.info(`    ${f}`);
      return;
    }

    // Confirm
    const confirmed = await consola.prompt(`Commit with message: "${commitMsg}"?`, {
      type: "confirm",
    });
    if (!confirmed) {
      consola.info("Aborted.");
      return;
    }

    // Stage files individually
    if (needsStaging) {
      for (const file of stagedFiles) {
        const { exitCode } = await exec(["git", "add", file]);
        if (exitCode !== 0) {
          consola.error(`Failed to stage ${file}`);
          return;
        }
      }
    }

    // Commit
    const { exitCode, stdout } = await exec(["git", "commit", "-m", commitMsg]);
    if (exitCode !== 0) {
      consola.error("Commit failed.");
      return;
    }

    consola.success(stdout || `Committed: ${commitMsg}`);
  },
});
