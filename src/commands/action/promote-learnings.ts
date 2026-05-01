import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  mergeLearnings,
  LEARNING_CATEGORIES,
  isLearningFile,
  EXTERNAL_LEARNINGS_PATH,
  EXTERNAL_LEARNINGS_PATH_LEGACY,
} from "./fetch-learnings";

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
 * Check if Software Teams was involved in the PR associated with a commit.
 * Looks for:
 * - Comments from github-actions[bot] mentioning software-teams or the
 *   legacy "jdi"/"JDI" branding (back-compat for older PRs).
 * - Commits authored by software-teams[bot] (or legacy jdi[bot]).
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

  // Check for Software Teams comments (matches new branding plus legacy jdi/JDI).
  const commentsResult = Bun.spawnSync(
    [
      "gh", "api", `repos/${repo}/issues/${prNumber}/comments`, "--paginate",
      "--jq", `[.[] | select(.user.login == "github-actions[bot]" and (.body | test("software.?teams|jdi|JDI"; "i")))] | length`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const jdiActivity = parseInt(commentsResult.stdout.toString().trim() || "0", 10);

  // Check for software-teams[bot] commits (legacy: jdi[bot]).
  const commitsResult = Bun.spawnSync(
    [
      "gh", "api", `repos/${repo}/pulls/${prNumber}/commits`, "--paginate",
      "--jq", `[.[] | select(.commit.author.name == "software-teams[bot]" or .commit.author.name == "jdi[bot]")] | length`,
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
 * Check if any LEARNING category files in the rules directory have
 * non-header content. Returns false if directory doesn't exist or the
 * learning category files only contain headers/comments/blank lines.
 *
 * Phase D: only LEARNING_CATEGORIES files are considered. Non-learning
 * rules files (commits.md, deviations.md) sit alongside but are NOT
 * inputs to the learnings promotion flow.
 */
export function hasLearningsContent(learningsDir: string): boolean {
  if (!existsSync(learningsDir)) {
    return false;
  }

  const files = readdirSync(learningsDir).filter((f) => isLearningFile(f));
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
 * Only stages LEARNING_CATEGORIES files — `commits.md` / `deviations.md`
 * (non-learning rules) are kept out of the auto-commit.
 */
export function commitLearningsToSameRepo(learningsDir: string, prNumber?: number): boolean {
  const learningPaths = LEARNING_CATEGORIES.map((c) => join(learningsDir, `${c}.md`)).filter((p) => existsSync(p));
  if (learningPaths.length === 0) {
    consola.info("No learning category files present — nothing to commit");
    return false;
  }
  Bun.spawnSync(["git", "add", ...learningPaths], {
    stdout: "pipe",
    stderr: "pipe",
  });

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
    ? `chore(software-teams): update team learnings\n\nAuto-committed by Software Teams after PR #${prNumber} merged.\nThese learnings are accumulated from PR reviews and feedback.`
    : `chore(software-teams): update team learnings`;

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

    const remoteSubdir = join(tmpDir, EXTERNAL_LEARNINGS_PATH);
    mkdirSync(remoteSubdir, { recursive: true });

    // Carry forward any data that lives at the legacy `jdi/learnings/`
    // path so we can phase it out without losing learnings. This merges
    // legacy → new path inside the clone before pushing.
    const legacySubdir = join(tmpDir, EXTERNAL_LEARNINGS_PATH_LEGACY);
    if (existsSync(legacySubdir)) {
      mergeLearnings(legacySubdir, remoteSubdir);
    }

    // Merge learnings from local into the external repo (new path).
    mergeLearnings(learningsDir, remoteSubdir);

    // Configure git in the cloned repo
    Bun.spawnSync(["git", "config", "user.name", "software-teams[bot]"], { cwd: tmpDir });
    Bun.spawnSync(["git", "config", "user.email", "software-teams[bot]@users.noreply.github.com"], { cwd: tmpDir });

    // Stage learning category files only (non-learning rules like
    // commits.md / deviations.md must NOT leak into the shared repo).
    const stagePaths = LEARNING_CATEGORIES.map(
      (c) => `${EXTERNAL_LEARNINGS_PATH}/${c}.md`,
    );
    Bun.spawnSync(["git", "add", ...stagePaths], {
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
    const message = `chore(software-teams): update learnings from ${source}\n\nSource: ${prRef} on ${source}\nLearnings accumulated from PR reviews and feedback.`;

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

    consola.success(`Learnings committed to ${externalRepo}/${EXTERNAL_LEARNINGS_PATH}`);
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
    const learningsDir = join(cwd, ".software-teams/rules");

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
