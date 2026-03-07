import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { exec } from "../utils/git";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Fetch PR diff and generate a structured review prompt",
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

    const prompt = [
      `# Code Review: PR #${prNum}`,
      ``,
      meta,
      ``,
      `## Diff`,
      "```diff",
      diffResult.stdout,
      "```",
      ``,
      `## Review Checklist`,
      `Evaluate this PR against the following criteria:`,
      ``,
      `### Correctness`,
      `- Does the code do what it claims to do?`,
      `- Are there edge cases not handled?`,
      `- Are error paths handled properly?`,
      ``,
      `### Patterns & Conventions`,
      `- Does it follow the project's existing patterns?`,
      `- Are naming conventions consistent?`,
      `- Is the code well-organised?`,
      ``,
      `### Security`,
      `- Any injection risks (SQL, XSS, command)?`,
      `- Are secrets or credentials exposed?`,
      `- Is user input validated at boundaries?`,
      ``,
      `### Performance`,
      `- Any N+1 queries or unnecessary loops?`,
      `- Are there missing indexes or inefficient operations?`,
      ``,
      `## Output Format`,
      `For each finding, provide:`,
      `- **File & line**: where the issue is`,
      `- **Severity**: critical / warning / suggestion / nitpick`,
      `- **Issue**: what's wrong`,
      `- **Suggestion**: how to fix it`,
    ].join("\n");

    if (args.output) {
      await Bun.write(resolve(process.cwd(), args.output), prompt);
      consola.success(`Review prompt written to ${args.output}`);
    } else {
      console.log(prompt);
    }
  },
});
