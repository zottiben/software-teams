import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { exec } from "../utils/git";
import { spawnClaude } from "../utils/claude";
import { buildReviewPrompt, gatherPromptContext } from "../utils/prompt-builder";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Review a PR using Claude Code",
  },
  args: {
    pr: {
      type: "positional",
      description: "PR number",
      required: true,
    },
    output: {
      type: "string",
      description: "Write prompt to file instead of stdout",
    },
    print: {
      type: "boolean",
      description: "Print the prompt to stdout instead of executing",
      default: false,
    },
  },
  async run({ args }) {
    // Check gh CLI
    const { exitCode: ghCheck } = await exec(["which", "gh"]);
    if (ghCheck !== 0) {
      consola.error("GitHub CLI (gh) is required. Install from https://cli.github.com");
      return;
    }

    const prNum = args.pr;

    // Fetch PR diff and metadata in parallel
    const [diffResult, metaResult] = await Promise.all([
      exec(["gh", "pr", "diff", String(prNum)]),
      exec(["gh", "pr", "view", String(prNum), "--json", "title,body,author,baseRefName,headRefName,files"]),
    ]);

    if (diffResult.exitCode !== 0) {
      consola.error(`Failed to fetch PR #${prNum} diff. Is it a valid PR number?`);
      return;
    }

    let meta = "";
    if (metaResult.exitCode === 0) {
      try {
        const data = JSON.parse(metaResult.stdout);
        meta = [
          `**Title:** ${data.title}`,
          `**Author:** ${data.author?.login ?? "unknown"}`,
          `**Base:** ${data.baseRefName} <- ${data.headRefName}`,
          data.body ? `**Description:**\n${data.body}` : "",
        ].filter(Boolean).join("\n");
      } catch {
        meta = metaResult.stdout;
      }
    }

    const ctx = await gatherPromptContext(process.cwd());
    const prompt = buildReviewPrompt(
      ctx,
      String(prNum),
      meta,
      diffResult.stdout,
    );

    if (args.output) {
      await Bun.write(resolve(process.cwd(), args.output), prompt);
      consola.success(`Review prompt written to ${args.output}`);
    } else if (args.print) {
      console.log(prompt);
    } else {
      const { exitCode } = await spawnClaude(prompt, { cwd: process.cwd() });
      if (exitCode !== 0) {
        consola.error(`Claude exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    }
  },
});
