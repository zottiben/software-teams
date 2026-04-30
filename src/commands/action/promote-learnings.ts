import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, appendFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { mergeLearnings } from "./fetch-learnings";

function writeGitHubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

export interface JdiInvolvement {
  skip: boolean;
  branch?: string;
  prNumber?: number;
}

/**
 * Check if JDI was involved in the PR associated with a commit.
 * Looks for:
 * - Comments from github-actions[bot] mentioning jdi/JDI
 * - Commits authored by jdi[bot]
 */
export function checkJdiInvolvement(repo: string, sha: string): JdiInvolvement {
  // Find the PR associated with this commit
  const prResult = Bun.spawnSync(
    ["gh", "api", `repos/${repo}/commits/${sha}/pulls`, "--jq", ".[0].number // empty"],
    { stdout: "pipe", stderr: "pipe" },
  );

  const prNumberStr = prResult.stdout.toString().trim();
  if (!prNumberStr) {
    consola.info("No associated PR found — skipping");
    return { skip: true };
  }

  const prNumber = parseInt(prNumberStr, 10);

  // Check for JDI comments
  const commentsResult = Bun.spawnSync(
    [
      "gh", "api", `repos/${repo}/issues/${prNumber}/comments`, "--paginate",
      "--jq", `[.[] | select(.user.login == "github-actions[bot]" and (.body | test("jdi|JDI")))] | length`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const jdiActivity = parseInt(commentsResult.stdout.toString().trim() || "0", 10);

  // Check for jdi[bot] commits
  const commitsResult = Bun.spawnSync(
    [
      "gh", "api", `repos/${repo}/pulls/${prNumber}/commits`, "--paginate",
      "--jq", `[.[] | select(.commit.author.name == "jdi[bot]")] | length`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const jdiCommits = parseInt(commitsResult.stdout.toString().trim() || "0", 10);

  if (jdiActivity > 0 || jdiCommits > 0) {
    // Get the branch name
    const branchResult = Bun.spawnSync(
      ["gh", "api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".head.ref"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const branch = branchResult.stdout.toString().trim();

    consola.info(
      `JDI was active on PR #${prNumber} (comments: ${jdiActivity}, commits: ${jdiCommits}) — promoting learnings`,
    );
    return { skip: false, branch, prNumber };
  }

  consola.info(`No JDI activity on PR #${prNumber} — skipping`);
  return { skip: true };
}

/**
 * Check if any .md files in the learnings directory have non-header content.
 * Returns false if directory doesn't exist or files only contain headers/comments/blank lines.
 */
export function hasLearningsContent(learningsDir: string): boolean {
  if (!existsSync(learningsDir)) {
    return false;
  }

  const files = readdirSync(learningsDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = readFileSync(join(learningsDir, file), "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, headers (#), and HTML comments (<!--)
      if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("<!--")) {
        continue;
      }
      return true;
    }
  }

  return false;
}

/**
 * Commit learnings to the same repository on the current branch.
 */
export function commitLearningsToSameRepo(learningsDir: string, prNumber?: number): boolean {
  // Stage learnings files
  const addResult = Bun.spawnSync(["git", "add", `${learningsDir}/*.md`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (addResult.exitCode !== 0) {
    // Try with glob expansion via shell
    Bun.spawnSync(["bash", "-c", `git add "${learningsDir}"/*.md`], {
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  // Check if there are staged changes
  const diffResult = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (diffResult.exitCode === 0) {
    consola.info("Learnings unchanged — nothing to commit");
    return false;
  }

  const message = prNumber
    ? `chore(jdi): update team learnings\n\nAuto-committed by JDI after PR #${prNumber} merged.\nThese learnings are accumulated from PR reviews and feedback.`
    : `chore(jdi): update team learnings`;

  const commitResult = Bun.spawnSync(["git", "commit", "-m", message], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (commitResult.exitCode !== 0) {
    consola.error("Failed to commit learnings:", commitResult.stderr.toString());
    return false;
  }

  const pushResult = Bun.spawnSync(["git", "push"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (pushResult.exitCode !== 0) {
    consola.error("Failed to push learnings:", pushResult.stderr.toString());
    return false;
  }

  consola.success("Learnings committed and pushed");
  return true;
}

/**
 * Commit learnings to an external repository.
 * Clones the repo, merges learnings, commits and pushes.
 */
export function commitLearningsToExternalRepo(
  learningsDir: string,
  externalRepo: string,
  token: string,
  prNumber?: number,
  sourceRepo?: string,
): boolean {
  const tmpDir = mkdtempSync(join(tmpdir(), "st-promote-"));

  try {
    const cloneUrl = `https://x-access-token:${token}@github.com/${externalRepo}.git`;
    const cloneResult = Bun.spawnSync(
      ["git", "clone", "--depth", "1", cloneUrl, tmpDir],
      { stdout: "pipe", stderr: "pipe" },
    );

    if (cloneResult.exitCode !== 0) {
      consola.warn(`Could not clone learnings repo ${externalRepo} — skipping commit`);
      return false;
    }

    const remoteSubdir = join(tmpDir, "jdi/learnings");
    mkdirSync(remoteSubdir, { recursive: true });

    // Merge learnings from local into the external repo
    mergeLearnings(learningsDir, remoteSubdir);

    // Configure git in the cloned repo
    Bun.spawnSync(["git", "config", "user.name", "jdi[bot]"], { cwd: tmpDir });
    Bun.spawnSync(["git", "config", "user.email", "jdi[bot]@users.noreply.github.com"], { cwd: tmpDir });

    // Stage changes
    Bun.spawnSync(["bash", "-c", `git add "jdi/learnings"/*.md`], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Check for changes
    const diffResult = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (diffResult.exitCode === 0) {
      consola.info("Learnings unchanged in external repo — nothing to commit");
      return false;
    }

    const source = sourceRepo || "unknown";
    const prRef = prNumber ? `PR #${prNumber}` : "merge";
    const message = `chore(jdi): update learnings from ${source}\n\nSource: ${prRef} on ${source}\nLearnings accumulated from PR reviews and feedback.`;

    const commitResult = Bun.spawnSync(["git", "commit", "-m", message], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (commitResult.exitCode !== 0) {
      consola.error("Failed to commit to external repo:", commitResult.stderr.toString());
      return false;
    }

    const pushResult = Bun.spawnSync(["git", "push"], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (pushResult.exitCode !== 0) {
      consola.error("Failed to push to external repo:", pushResult.stderr.toString());
      return false;
    }

    consola.success(`Learnings committed to ${externalRepo}/jdi/learnings`);
    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export const promoteLearningsCommand = defineCommand({
  meta: {
    name: "promote-learnings",
    description: "Check JDI involvement and promote learnings after PR merge",
  },
  args: {
    repo: {
      type: "string",
      description: "Repository in owner/repo format",
      required: true,
    },
    sha: {
      type: "string",
      description: "The merge commit SHA",
      required: true,
    },
    "check-only": {
      type: "boolean",
      description: "Only check involvement, write outputs, and exit",
    },
    "pr-number": {
      type: "string",
      description: "PR number (if already known)",
    },
    branch: {
      type: "string",
      description: "Branch name (if already known)",
    },
    "learnings-repo": {
      type: "string",
      description: "External learnings repository",
    },
    "learnings-token": {
      type: "string",
      description: "Token for the learnings repo",
    },
  },
  run({ args }) {
    const repo = args.repo;
    const sha = args.sha;

    if (args["check-only"]) {
      const involvement = checkJdiInvolvement(repo, sha);
      writeGitHubOutput("skip", String(involvement.skip));
      if (involvement.branch) {
        writeGitHubOutput("branch", involvement.branch);
      }
      if (involvement.prNumber) {
        writeGitHubOutput("pr_number", String(involvement.prNumber));
      }
      return;
    }

    // Promote learnings
    const cwd = process.cwd();
    const learningsDir = join(cwd, ".software-teams/framework/learnings");

    if (!hasLearningsContent(learningsDir)) {
      consola.info("No learnings content to commit — skipping");
      return;
    }

    const learningsRepo = args["learnings-repo"];
    const token = args["learnings-token"] || process.env.LEARNINGS_TOKEN || process.env.GH_TOKEN || "";
    const prNumber = args["pr-number"] ? parseInt(args["pr-number"], 10) : undefined;

    if (learningsRepo) {
      commitLearningsToExternalRepo(learningsDir, learningsRepo, token, prNumber, repo);
    } else {
      commitLearningsToSameRepo(learningsDir, prNumber);
    }
  },
});
