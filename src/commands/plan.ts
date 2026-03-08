import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { detectProjectType } from "../utils/detect-project";
import { readAdapter } from "../utils/adapter";
import { spawnClaude } from "../utils/claude";
import { createStorage } from "../storage";
import { loadPersistedState, savePersistedState } from "../utils/storage-lifecycle";

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
    const agentSpec = resolve(cwd, ".jdi/framework/agents/jdi-planner.md");
    const baseProtocol = resolve(cwd, ".jdi/framework/components/meta/AgentBase.md");

    // Gather project context upfront (saves agent 2-3 discovery tool calls)
    const projectType = await detectProjectType(cwd);
    const adapter = await readAdapter(cwd);
    const techStack = adapter?.tech_stack
      ? Object.entries(adapter.tech_stack).map(([k, v]) => `${k}: ${v}`).join(", ")
      : projectType;
    const qualityGates = adapter?.quality_gates
      ? Object.entries(adapter.quality_gates).map(([name, cmd]) => `${name}: \`${cmd}\``).join(", ")
      : "default";

    // Build spawn prompt (cache-optimised: AgentBase first, then spec, then dynamic)
    const prompt = [
      `Read ${baseProtocol} for the base agent protocol.`,
      `You are jdi-planner. Read ${agentSpec} for your full specification.`,
      ``,
      `## Project Context`,
      `- Type: ${projectType}`,
      `- Tech stack: ${techStack}`,
      `- Quality gates: ${qualityGates}`,
      `- Working directory: ${cwd}`,
      ``,
      `## Task`,
      `Create an implementation plan for: ${args.description}`,
      ``,
      `Follow the planning workflow in your spec. If your spec has \`requires_components\` in frontmatter, batch-read all listed components before starting. Resolve remaining <JDI:*> components on-demand.`,
    ].join("\n");

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else if (args.print) {
      console.log(prompt);
    } else {
      // Load persisted state before spawning agent
      const storage = await createStorage(cwd);
      await loadPersistedState(cwd, storage);

      const { exitCode } = await spawnClaude(prompt, { cwd });

      // Save any updates back to storage
      await savePersistedState(cwd, storage);

      if (exitCode !== 0) {
        consola.error(`Claude exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    }
  },
});
