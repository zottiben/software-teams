import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { readState, writeState } from "../utils/state";

function parsePlanSummary(content: string): { name: string; objective: string; tasks: string[] } {
  // Extract plan name from first H1
  const nameMatch = content.match(/^# .+?: (.+)$/m);
  const name = nameMatch?.[1] ?? "Unknown";

  // Extract objective paragraph
  const objMatch = content.match(/## Objective\s+\n+([\s\S]+?)(?=\n---|\n##)/);
  const objective = objMatch?.[1]?.trim().split("\n")[0] ?? "";

  // Extract task names
  const taskMatches = [...content.matchAll(/### Task \d+: (.+)/g)];
  const tasks = taskMatches.map((m) => m[1]);

  return { name, objective, tasks };
}

export const planReviewCommand = defineCommand({
  meta: {
    name: "plan-review",
    description: "Review current plan and provide feedback or approve",
  },
  args: {
    plan: {
      type: "positional",
      description: "Path to plan file (defaults to current plan from state)",
      required: false,
    },
    output: {
      type: "string",
      description: "Write refinement prompt to file instead of stdout",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const state = await readState(cwd);

    // Resolve plan path
    let planPath: string;
    if (args.plan) {
      planPath = resolve(cwd, args.plan as string);
    } else if (state?.current_plan?.path) {
      planPath = resolve(cwd, state.current_plan.path as string);
    } else {
      consola.error("No plan found. Run `jdi plan` first.");
      return;
    }

    if (!existsSync(planPath)) {
      consola.error(`Plan not found: ${planPath}`);
      return;
    }

    // Read and parse plan
    const content = await Bun.file(planPath).text();
    const { name, objective, tasks } = parsePlanSummary(content);

    const revision = (state?.review?.revision as number) ?? 0;
    const reviewStatus = (state?.review?.status as string) ?? "none";

    // Display summary
    consola.info(`\nPlan: ${name}`);
    consola.info(`Status: ${reviewStatus} | Revision: ${revision}`);
    consola.info(`Objective: ${objective}`);
    consola.info(`\nTasks (${tasks.length}):`);
    for (let i = 0; i < tasks.length; i++) {
      consola.info(`  ${i + 1}. ${tasks[i]}`);
    }
    consola.info("");

    // Prompt for feedback
    const feedback = await consola.prompt("Feedback (or 'approve'):", {
      type: "text",
    });

    if (typeof feedback !== "string" || !feedback.trim()) {
      consola.info("No feedback provided. Exiting.");
      return;
    }

    const trimmed = feedback.trim().toLowerCase();
    const isApproval = ["approve", "approved", "lgtm", "looks good", "ship it"].includes(trimmed);

    if (!state) {
      consola.error("No JDI state found. Run `jdi init` first.");
      return;
    }

    if (isApproval) {
      // Approve the plan
      const now = new Date().toISOString();
      state.review = {
        ...(state.review as any),
        status: "approved",
        approved_at: now,
      };
      if (state.position) {
        state.position.status = "approved";
      }
      await writeState(cwd, state);
      consola.success(`Plan '${name}' approved (revision ${revision}).`);
      consola.info("Say 'implement this' in Claude Code or run `/jdi:implement-plan` to execute.");
    } else {
      // Record feedback and generate refinement prompt
      const now = new Date().toISOString();
      const newRevision = revision + 1;
      const history = (state.review?.feedback_history as any[]) ?? [];
      history.push({ revision: newRevision, feedback: feedback.trim(), requested_at: now });

      state.review = {
        status: "changes_requested",
        revision: newRevision,
        scope: "plan",
        feedback_history: history,
        approved_at: null,
      };
      await writeState(cwd, state);

      // Generate refinement prompt
      const prompt = [
        `# Plan Refinement Request`,
        ``,
        `## Current Plan`,
        `Read the plan at: ${planPath}`,
        ``,
        `## Feedback`,
        feedback.trim(),
        ``,
        `## Instructions`,
        `1. Read the plan file above`,
        `2. Apply the requested changes — edit the plan in-place`,
        `3. Present the updated plan summary`,
        `4. Ask: "Review the plan above. Provide feedback to refine, or say **approved** to finalise."`,
        ``,
        `Working directory: ${cwd}`,
      ].join("\n");

      if (args.output) {
        await Bun.write(resolve(cwd, args.output), prompt);
        consola.success(`Refinement prompt written to ${args.output}`);
      } else {
        consola.info("\n--- Refinement prompt (paste into Claude Code) ---\n");
        console.log(prompt);
      }
    }
  },
});
