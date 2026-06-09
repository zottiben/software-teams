import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "node:path";
import { spawnClaude } from "../utils/claude";
import { gatherPromptContext, buildQuickPrompt, applyDryRunMode } from "../utils/prompt-builder";

export const quickCommand = defineCommand({
  meta: {
    name: "quick",
    description: "Make a focused change using Claude Code",
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
    print: {
      type: "boolean",
      description: "Print the prompt to stdout instead of executing",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Preview changes without writing files",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = await gatherPromptContext(cwd);

    let prompt = buildQuickPrompt(ctx, args.description);
    if (args["dry-run"]) {
      prompt = applyDryRunMode(prompt);
    }

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else if (args.print) {
      console.log(prompt);
    } else {
      const allowedTools = args["dry-run"] ? ["Read", "Glob", "Grep", "Bash"] : undefined;
      const { exitCode } = await spawnClaude(prompt, { cwd, allowedTools });
      if (exitCode !== 0) {
        consola.error(`Claude exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    }
  },
});
