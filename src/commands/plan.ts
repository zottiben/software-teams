import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "node:path";
import { spawnClaude } from "../utils/claude";
import { createStorage } from "../storage";
import { savePersistedState } from "../utils/storage-lifecycle";
import { gatherPromptContext, buildPlanPrompt } from "../utils/prompt-builder";

export const planCommand = defineCommand({
  meta: {
    name: "plan",
    description: "Plan a feature using Claude Code",
  },
  args: {
    description: {
      type: "positional",
      description: "Feature description or ticket reference",
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
    const cwd = process.cwd();
    const ctx = await gatherPromptContext(cwd);
    const prompt = buildPlanPrompt(ctx, args.description);

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else if (args.print) {
      console.log(prompt);
    } else {
      const { exitCode } = await spawnClaude(prompt, { cwd });

      // Save any updates back to storage
      const storage = await createStorage(cwd);
      await savePersistedState(cwd, storage);

      if (exitCode !== 0) {
        consola.error(`Claude exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    }
  },
});
