import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { detectProjectType } from "../utils/detect-project";
import { readAdapter } from "../utils/adapter";

export const implementCommand = defineCommand({
  meta: {
    name: "implement",
    description: "Generate an implementation prompt for Claude Code",
  },
  args: {
    plan: {
      type: "positional",
      description: "Path to the PLAN.md file to execute",
      required: true,
    },
    output: {
      type: "string",
      description: "Write prompt to file instead of stdout",
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
  },
  async run({ args }) {
    const cwd = process.cwd();
    const baseProtocol = resolve(cwd, ".jdi/framework/components/meta/AgentBase.md");
    const complexityRouter = resolve(cwd, ".jdi/framework/components/meta/ComplexityRouter.md");
    const orchestration = resolve(cwd, ".jdi/framework/components/meta/AgentTeamsOrchestration.md");

    // Gather project context upfront (saves agent 2-3 discovery tool calls)
    const projectType = await detectProjectType(cwd);
    const adapter = await readAdapter(cwd);
    const techStack = adapter?.tech_stack
      ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
      : projectType;
    const qualityGates = adapter?.quality_gates
      ? Object.entries(adapter.quality_gates).map(([name, cmd]) => `${name}: \`${cmd}\``).join(", ")
      : "default";

    const overrideFlag = args.team ? "\nOverride: --team (force Agent Teams mode)" :
      args.single ? "\nOverride: --single (force single-agent mode)" : "";

    // Build spawn prompt (cache-optimised: AgentBase first, then routing, then dynamic)
    const prompt = [
      `Read ${baseProtocol} for the base agent protocol.`,
      `Read ${complexityRouter} for complexity routing rules.`,
      `Read ${orchestration} for Agent Teams orchestration (if needed).`,
      ``,
      `## Project Context`,
      `- Type: ${projectType}`,
      `- Tech stack: ${techStack}`,
      `- Quality gates: ${qualityGates}`,
      `- Working directory: ${cwd}`,
      ``,
      `## Task`,
      `Execute implementation plan: ${resolve(cwd, args.plan)}${overrideFlag}`,
      ``,
      `Follow the implement-plan orchestration:`,
      `1. Read codebase context (.jdi/codebase/SUMMARY.md if exists)`,
      `2. Read plan file and state.yaml — parse tasks, deps, waves, tech_stack`,
      `3. Apply ComplexityRouter: evaluate plan signals, choose single-agent or Agent Teams mode`,
      `4. Tech routing: detect primary agent from tech stack`,
      `5. Spawn agent(s) with cache-optimised load order (AgentBase first, then agent spec)`,
      `6. Collect and execute deferred ops (files, commits)`,
      `7. Run verification (tests, lint, typecheck)`,
      `8. Update state, present summary, enter review loop`,
    ].join("\n");

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else {
      console.log(prompt);
    }
  },
});
