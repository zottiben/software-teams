import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { detectProjectType } from "../utils/detect-project";
import { readAdapter } from "../utils/adapter";

export const quickCommand = defineCommand({
  meta: {
    name: "quick",
    description: "Generate a focused change prompt for Claude Code",
  },
  args: {
    description: {
      type: "positional",
      description: "What to change",
      required: true,
    },
    output: {
      type: "string",
      description: "Write prompt to file instead of stdout",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const projectType = await detectProjectType(cwd);
    const adapter = await readAdapter(cwd);

    const qualityGates = adapter?.quality_gates
      ? Object.entries(adapter.quality_gates)
          .map(([name, cmd]) => `- ${name}: \`${cmd}\``)
          .join("\n")
      : "- Run any existing test suite";

    const prompt = [
      `# Quick Change`,
      ``,
      `## Task`,
      `${args.description}`,
      ``,
      `## Context`,
      `- Working directory: ${cwd}`,
      `- Project type: ${projectType}`,
      ``,
      `## Instructions`,
      `1. Make the minimal change needed to accomplish the task`,
      `2. Keep changes focused — do not refactor surrounding code`,
      `3. Follow existing code patterns and conventions`,
      ``,
      `## Verification`,
      qualityGates,
      ``,
      `## Commit`,
      `When done, create a conventional commit describing the change.`,
    ].join("\n");

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else {
      console.log(prompt);
    }
  },
});
