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
  },
  async run({ args }) {
    const cwd = process.cwd();
    await transitionToPlanReady(cwd, args["plan-path"], args["plan-name"]);
    consola.success(`State → plan-ready (${args["plan-name"]})`);
  },
});

const approvedCommand = defineCommand({
  meta: {
    name: "approved",
    description: "Transition state after plan approval",
  },
  async run() {
    const cwd = process.cwd();
    await transitionToApproved(cwd);
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
    const cwd = process.cwd();
    await transitionToExecuting(cwd, args["task-id"], args["task-name"]);
    consola.success("State → executing");
  },
});

const completeCommand = defineCommand({
  meta: {
    name: "complete",
    description: "Transition state after implementation finishes",
  },
  async run() {
    const cwd = process.cwd();
    await transitionToComplete(cwd);
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
    const cwd = process.cwd();
    await advanceTask(cwd, args["task-id"]);
    const state = await readState(cwd);
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
