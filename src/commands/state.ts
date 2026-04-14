import { defineCommand } from "citty";
import { consola } from "consola";
import {
  transitionToPlanReady,
  transitionToApproved,
  transitionToExecuting,
  transitionToComplete,
  advanceTask,
} from "../utils/state-handlers";
import { readState } from "../utils/state";
import { findJdiRoot } from "../utils/find-root";

function resolveRootOrExit(): string {
  try {
    return findJdiRoot(process.cwd());
  } catch (err) {
    consola.error((err as Error).message);
    process.exit(1);
  }
}

const planReadyCommand = defineCommand({
  meta: {
    name: "plan-ready",
    description: "Transition state after plan creation",
  },
  args: {
    "plan-path": {
      type: "string",
      description: "Path to the plan file",
      required: true,
    },
    "plan-name": {
      type: "string",
      description: "Human-readable plan name",
      required: true,
    },
    force: {
      type: "boolean",
      description: "Force transition even when state is currently executing",
      default: false,
    },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    try {
      await transitionToPlanReady(root, args["plan-path"], args["plan-name"], {
        force: args.force === true,
      });
    } catch (err) {
      consola.error((err as Error).message);
      process.exit(1);
    }
    consola.success(`State → plan-ready (${args["plan-name"]})`);
  },
});

const approvedCommand = defineCommand({
  meta: {
    name: "approved",
    description: "Transition state after plan approval",
  },
  async run() {
    const root = resolveRootOrExit();
    await transitionToApproved(root);
    consola.success("State → approved");
  },
});

const executingCommand = defineCommand({
  meta: {
    name: "executing",
    description: "Transition state when implementation starts",
  },
  args: {
    "task-id": {
      type: "string",
      description: "Current task ID",
      required: false,
    },
    "task-name": {
      type: "string",
      description: "Current task name",
      required: false,
    },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    await transitionToExecuting(root, args["task-id"], args["task-name"]);
    consola.success("State → executing");
  },
});

const completeCommand = defineCommand({
  meta: {
    name: "complete",
    description: "Transition state after implementation finishes",
  },
  async run() {
    const root = resolveRootOrExit();
    await transitionToComplete(root);
    consola.success("State → complete");
  },
});

const advanceTaskCommand = defineCommand({
  meta: {
    name: "advance-task",
    description: "Mark a task as completed and advance to next",
  },
  args: {
    "task-id": {
      type: "positional",
      description: "ID of the completed task",
      required: true,
    },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    await advanceTask(root, args["task-id"]);
    const state = await readState(root);
    const completed = state?.current_plan?.completed_tasks?.length ?? 0;
    const total = state?.current_plan?.tasks?.length ?? 0;
    consola.success(`Task ${args["task-id"]} completed (${completed}/${total})`);
  },
});

export const stateCommand = defineCommand({
  meta: {
    name: "state",
    description: "Manage JDI state transitions",
  },
  subCommands: {
    "plan-ready": planReadyCommand,
    approved: approvedCommand,
    executing: executingCommand,
    complete: completeCommand,
    "advance-task": advanceTaskCommand,
  },
});
