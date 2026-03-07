import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "fs";
import { join } from "path";
import { exec, gitBranch, gitLog, gitMergeBase } from "../utils/git";
import { readState } from "../utils/state";

async function hasGhCli(): Promise<boolean> {
  const { exitCode } = await exec(["which", "gh"]);
  return exitCode === 0;
}

export const prCommand = defineCommand({
  meta: {
    name: "pr",
    description: "Generate PR title and body, push branch, and create PR via gh",
  },
  args: {
    draft: {
      type: "boolean",
      description: "Create as draft PR",
      default: false,
    },
    base: {
      type: "string",
      description: "Base branch for the PR",
    },
    "no-push": {
      type: "boolean",
      description: "Skip pushing the branch",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Show generated PR content without creating",
      default: false,
    },
  },
  async run({ args }) {
    if (!await hasGhCli()) {
      consola.error("GitHub CLI (gh) is required. Install from https://cli.github.com");
      return;
    }

    const cwd = process.cwd();
    const branch = await gitBranch();
    const base = args.base ?? "main";

    if (branch === base) {
      consola.error(`Already on ${base}. Switch to a feature branch first.`);
      return;
    }

    // Get commit log since divergence
    const mergeBase = await gitMergeBase(base);
    const log = mergeBase ? await gitLog(`${mergeBase.slice(0, 8)}..HEAD`) : await gitLog();

    // Read state for context
    const state = await readState(cwd);
    const planContext = state?.position?.plan_name
      ? `\n\n**Plan:** ${state.position.plan_name}`
      : "";

    // Check for PR template
    let template = "";
    const templatePath = join(cwd, ".github", "pull_request_template.md");
    if (existsSync(templatePath)) {
      template = await Bun.file(templatePath).text();
    }

    // Generate title from branch name
    const title = branch
      .replace(/^(feat|fix|chore|docs|refactor|test|ci)\//, "")
      .replace(/[-_]/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());

    // Generate body
    const commits = log
      .split("\n")
      .filter(Boolean)
      .map((l) => `- ${l}`)
      .join("\n");

    const body = template || [
      `## Summary`,
      ``,
      commits,
      planContext,
      ``,
      `## Test Plan`,
      `- [ ] Verify changes work as expected`,
      `- [ ] Run existing test suite`,
    ].join("\n");

    if (args["dry-run"]) {
      consola.info("Dry run — would create PR:");
      consola.info(`  Title: ${title}`);
      consola.info(`  Base:  ${base}`);
      consola.info(`  Draft: ${args.draft}`);
      consola.info(`\n${body}`);
      return;
    }

    // Push branch
    if (!args["no-push"]) {
      consola.start("Pushing branch...");
      const { exitCode } = await exec(["git", "push", "-u", "origin", branch]);
      if (exitCode !== 0) {
        consola.error("Failed to push branch.");
        return;
      }
    }

    // Create PR
    consola.start("Creating PR...");
    const ghArgs = ["gh", "pr", "create", "--title", title, "--body", body, "--base", base];
    if (args.draft) ghArgs.push("--draft");

    const { stdout, exitCode } = await exec(ghArgs);
    if (exitCode !== 0) {
      consola.error("Failed to create PR.");
      return;
    }

    consola.success(`PR created: ${stdout}`);
  },
});
