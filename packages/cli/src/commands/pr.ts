import { defineCommand } from "citty";
import { consola } from "consola";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

    const mergeBase = await gitMergeBase(base);
    const log = mergeBase ? await gitLog(`${mergeBase.slice(0, 8)}..HEAD`) : await gitLog();

    const state = await readState(cwd);

    const planContext = await (async () => {
      const planPath = state?.current_plan?.path;
      if (!planPath) return { context: "", name: state?.position?.plan_name ?? "", checks: [] as string[] };
      const fullPlanPath = join(cwd, planPath);
      if (!existsSync(fullPlanPath)) return { context: "", name: state?.position?.plan_name ?? "", checks: [] as string[] };
      const planContent = await Bun.file(fullPlanPath).text().catch(() => null);
      if (!planContent) return { context: "", name: state?.position?.plan_name ?? "", checks: [] as string[] };

      const nameMatch = planContent.match(/^#\s+(.+)/m);
      const resolvedName = nameMatch ? nameMatch[1] : (state?.position?.plan_name ?? "");

      const taskLines = planContent.split("\n").filter((l) => /^\|\s*T\d+\s*\|/.test(l));
      const ctx = taskLines.length > 0
        ? `\n**Tasks:**\n${taskLines.map((l) => `- ${l.split("|").slice(2, 3).join("").trim()}`).join("\n")}`
        : "";

      const verifySection = planContent.split(/###?\s*Verification/i)[1];
      const checks = verifySection
        ? verifySection.split("\n").filter((l) => /^-\s*\[[ x]\]/.test(l.trim())).map((l) => l.trim())
        : [];

      return { context: ctx, name: resolvedName, checks };
    })();

    const planName = planContext.name;
    const verificationChecks = planContext.checks;

    const template = existsSync(join(cwd, ".github", "pull_request_template.md"))
      ? await Bun.file(join(cwd, ".github", "pull_request_template.md")).text()
      : "";

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
      planName ? `**Plan:** ${planName}` : "",
      ``,
      commits,
      planContext.context,
      ``,
      `## Test Plan`,
      ...(verificationChecks.length > 0
        ? verificationChecks
        : [`- [ ] Verify changes work as expected`, `- [ ] Run existing test suite`]),
    ].filter(Boolean).join("\n");

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
