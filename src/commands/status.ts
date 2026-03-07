import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { readState } from "../utils/state";

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show current JDI project status",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const state = await readState(cwd);

    if (!state) {
      consola.warn("No JDI state found. Run `jdi init` first.");
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(state, null, 2));
      return;
    }

    consola.info("JDI Status");
    consola.info("\u2500".repeat(40));

    if (state.position) {
      consola.info(`Phase:  ${state.position.phase_name || state.position.phase || "\u2014"}`);
      consola.info(`Plan:   ${state.position.plan_name || state.position.plan || "\u2014"}`);
      consola.info(`Task:   ${state.position.task_name || state.position.task || "\u2014"}`);
      consola.info(`Status: ${state.position.status || "\u2014"}`);
    }

    if (state.progress) {
      consola.info("");
      consola.info(`Progress: ${state.progress.tasks_completed}/${state.progress.tasks_total} tasks`);
    }

    if (state.worktree?.active) {
      consola.info("");
      consola.info(`Worktree: ${state.worktree.path} (${state.worktree.branch})`);
    }
  },
});
