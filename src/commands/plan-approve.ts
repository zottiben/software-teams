import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve } from "path";
import { existsSync } from "fs";
import { readState, writeState } from "../utils/state";

export const planApproveCommand = defineCommand({
  meta: {
    name: "plan-approve",
    description: "Approve the current plan for implementation",
  },
  args: {
    plan: {
      type: "positional",
      description: "Path to plan file (defaults to current plan from state)",
      required: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const state = await readState(cwd);

    if (!state) {
      consola.error("No JDI state found. Run `jdi init` first.");
      return;
    }

    // Resolve plan path
    let planPath: string;
    if (args.plan) {
      planPath = resolve(cwd, args.plan as string);
    } else if (state.current_plan?.path) {
      planPath = resolve(cwd, state.current_plan.path as string);
    } else {
      consola.error("No plan to approve. Run `jdi plan` first.");
      return;
    }

    if (!existsSync(planPath)) {
      consola.error(`Plan not found: ${planPath}`);
      return;
    }

    // Check if already approved
    if (state.review?.status === "approved" && state.review?.approved_at) {
      consola.info(`Plan already approved at ${state.review.approved_at}.`);
      return;
    }

    // Approve
    const now = new Date().toISOString();
    const revision = (state.review?.revision as number) ?? 1;
    const planName = (state.position?.plan_name as string) ?? "current plan";

    state.review = {
      ...(state.review as any),
      status: "approved",
      approved_at: now,
    };
    if (state.position) {
      state.position.status = "approved";
    }
    await writeState(cwd, state);

    consola.success(`Plan '${planName}' approved (revision ${revision}).`);
    consola.info("Say 'implement this' in Claude Code or run `/jdi:implement-plan` to execute.");
  },
});
