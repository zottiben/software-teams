import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  mergeRules,
  RULE_CATEGORIES,
  isRuleFile,
  EXTERNAL_RULES_PATH,
} from "./fetch-rules";

function writeGitHubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

export interface SoftwareTeamsInvolvement {
  skip: boolean;
  branch?: string;
  prNumber?: number;
}

/**
 * Check if Software Teams was involved in the PR associated with a commit.
 * Looks for github-actions[bot] comments mentioning software-teams, plus
 * commits authored by software-teams[bot].
 */
export function checkSoftwareTeamsInvolvement(repo: string, sha: string): SoftwareTeamsInvolvement {
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

  const commentsResult = Bun.spawnSync(
    [
      "gh", "api", `repos/${repo}/issues/${prNumber}/comments`, "--paginate",
      "--jq", `[.[] | select(.user.login == "github-actions[bot]" and (.body | test("software.?teams"; "i")))] | length`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stActivity = parseInt(commentsResult.stdout.toString().trim() || "0", 10);

  const commitsResult = Bun.spawnSync(
    [
      "gh", "api", `repos/${repo}/pulls/${prNumber}/commits`, "--paginate",
      "--jq", `[.[] | select(.commit.author.name == "software-teams[bot]")] | length`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stCommits = parseInt(commitsResult.stdout.toString().trim() || "0", 10);

  if (stActivity > 0 || stCommits > 0) {
    // Get the branch name
    const branchResult = Bun.spawnSync(
      ["gh", "api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".head.ref"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const branch = branchResult.stdout.toString().trim();

    consola.info(
      `Software Teams was active on PR #${prNumber} (comments: ${stActivity}, commits: ${stCommits}) — promoting rules`,
    );
    return { skip: false, branch, prNumber };
  }

  consola.info(`No Software Teams activity on PR #${prNumber} — skipping`);
  return { skip: true };
}

/**
 * Check if any RULE_CATEGORIES files in the rules directory have
 * non-header content. Returns false if directory doesn't exist or the
 * rule category files only contain headers/comments/blank lines.
 *
 * Only RULE_CATEGORIES files are considered. Non-rule files
 * (commits.md, deviations.md) sit alongside but are NOT inputs to
 * the rules promotion flow.
 */
export function hasRulesContent(rulesDir: string): boolean {
  if (!existsSync(rulesDir)) {
    return false;
  }

  const files = readdirSync(rulesDir).filter((f) => isRuleFile(f));
  for (const file of files) {
    const content = readFileSync(join(rulesDir, file), "utf-8");
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
 * Commit rules to the same repository on the current branch.
 * Only stages RULE_CATEGORIES files — `commits.md` / `deviations.md`
 * (project-only rules) are kept out of the auto-commit.
 */
export function commitRulesToSameRepo(rulesDir: string, prNumber?: number): boolean {
  const rulePaths = RULE_CATEGORIES.map((c) => join(rulesDir, `${c}.md`)).filter((p) => existsSync(p));
  if (rulePaths.length === 0) {
    consola.info("No rule category files present — nothing to commit");
    return false;
  }
  Bun.spawnSync(["git", "add", ...rulePaths], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Check if there are staged changes
  const diffResult = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (diffResult.exitCode === 0) {
    consola.info("Rules unchanged — nothing to commit");
    return false;
  }

  const message = prNumber
    ? `chore(software-teams): update team rules\n\nAuto-committed by Software Teams after PR #${prNumber} merged.\nThese rules are accumulated from PR reviews and feedback.`
    : `chore(software-teams): update team rules`;

  const commitResult = Bun.spawnSync(["git", "commit", "-m", message], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (commitResult.exitCode !== 0) {
    consola.error("Failed to commit rules:", commitResult.stderr.toString());
    return false;
  }

  const pushResult = Bun.spawnSync(["git", "push"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (pushResult.exitCode !== 0) {
    consola.error("Failed to push rules:", pushResult.stderr.toString());
    return false;
  }

  consola.success("Rules committed and pushed");
  return true;
}

/**
 * Commit rules to an external repository.
 * Clones the repo, merges rules, commits and pushes.
 */
export function commitRulesToExternalRepo(
  rulesDir: string,
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
      consola.warn(`Could not clone rules repo ${externalRepo} — skipping commit`);
      return false;
    }

    const remoteSubdir = join(tmpDir, EXTERNAL_RULES_PATH);
    mkdirSync(remoteSubdir, { recursive: true });

    // Merge rules from local into the external repo.
    mergeRules(rulesDir, remoteSubdir);

    // Configure git in the cloned repo
    Bun.spawnSync(["git", "config", "user.name", "software-teams[bot]"], { cwd: tmpDir });
    Bun.spawnSync(["git", "config", "user.email", "software-teams[bot]@users.noreply.github.com"], { cwd: tmpDir });

    // Stage rule category files only (project-only rules like commits.md /
    // deviations.md must NOT leak into the shared repo).
    const stagePaths = RULE_CATEGORIES.map(
      (c) => `${EXTERNAL_RULES_PATH}/${c}.md`,
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
      consola.info("Rules unchanged in external repo — nothing to commit");
      return false;
    }

    const source = sourceRepo || "unknown";
    const prRef = prNumber ? `PR #${prNumber}` : "merge";
    const message = `chore(software-teams): update rules from ${source}\n\nSource: ${prRef} on ${source}\nRules accumulated from PR reviews and feedback.`;

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

    consola.success(`Rules committed to ${externalRepo}/${EXTERNAL_RULES_PATH}`);
    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export const promoteRulesCommand = defineCommand({
  meta: {
    name: "promote-rules",
    description: "Check Software Teams involvement and promote rules after PR merge",
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
    "rules-repo": {
      type: "string",
      description: "External rules repository",
    },
    "rules-token": {
      type: "string",
      description: "Token for the rules repo",
    },
  },
  run({ args }) {
    const repo = args.repo;
    const sha = args.sha;

    if (args["check-only"]) {
      const involvement = checkSoftwareTeamsInvolvement(repo, sha);
      writeGitHubOutput("skip", String(involvement.skip));
      if (involvement.branch) {
        writeGitHubOutput("branch", involvement.branch);
      }
      if (involvement.prNumber) {
        writeGitHubOutput("pr_number", String(involvement.prNumber));
      }
      return;
    }

    // Promote rules
    const cwd = process.cwd();
    const rulesDir = join(cwd, ".software-teams/rules");

    if (!hasRulesContent(rulesDir)) {
      consola.info("No rules content to commit — skipping");
      return;
    }

    const rulesRepo = args["rules-repo"];
    const token = args["rules-token"] || process.env.RULES_TOKEN || process.env.GH_TOKEN || "";
    const prNumber = args["pr-number"] ? parseInt(args["pr-number"], 10) : undefined;

    if (rulesRepo) {
      commitRulesToExternalRepo(rulesDir, rulesRepo, token, prNumber, repo);
    } else {
      commitRulesToSameRepo(rulesDir, prNumber);
    }
  },
});
