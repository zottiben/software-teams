import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "node:path";
import { spawnClaude } from "../utils/claude";
import { readState } from "../utils/state";
import { createStorage } from "../storage";
import { savePersistedState } from "../utils/storage-lifecycle";
import { gatherPromptContext, buildImplementPrompt, applyDryRunMode } from "../utils/prompt-builder";
import { transitionToExecuting, transitionToComplete } from "../utils/state-handlers";
import { runQualityGates } from "../utils/verify";

export const implementCommand = defineCommand({
  meta: {
    name: "implement",
    description: "Execute an implementation plan using Claude Code",
  },
  args: {
    plan: {
      type: "positional",
      description: "Path to the plan.md file (auto-detected from state if omitted)",
      required: false,
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
    team: {
      type: "boolean",
      description: "Force Agent Teams mode",
      default: false,
    },
    single: {
      type: "boolean",
      description: "Force single-agent mode",
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

    // Auto-discover plan from state if not provided
    let planPath: string | undefined = args.plan;
    if (!planPath) {
      const state = await readState(cwd);
      planPath = state?.current_plan?.path ?? undefined;
      if (!planPath) {
        consola.error("No plan specified and no current plan found in state. Run `software-teams plan` first or provide a plan path.");
        process.exit(1);
      }
      consola.info(`Using current plan: ${planPath}`);
    }

    const ctx = await gatherPromptContext(cwd);
    const overrideFlag = args.team ? "--team (force Agent Teams mode)" :
      args.single ? "--single (force single-agent mode)" : undefined;

    let prompt = buildImplementPrompt(ctx, planPath, overrideFlag);
    if (args["dry-run"]) {
      prompt = applyDryRunMode(prompt);
    }

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else if (args.print) {
      console.log(prompt);
    } else {
      await transitionToExecuting(cwd);

      const allowedTools = args["dry-run"] ? ["Read", "Glob", "Grep", "Bash"] : undefined;
      const { exitCode } = await spawnClaude(prompt, { cwd, allowedTools });

      await transitionToComplete(cwd);

      // Run quality gates after implementation
      if (!args["dry-run"]) {
        const verification = await runQualityGates(cwd);
        if (verification.gates.length > 0) {
          consola.info("\nQuality Gates:");
          for (const gate of verification.gates) {
            const icon = gate.passed ? "✅" : "❌";
            consola.info(`  ${icon} ${gate.name}`);
          }
        }
      }

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
