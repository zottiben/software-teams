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
import { findProjectRoot } from "../utils/find-root";
import { dottedGet, printValue } from "../utils/yaml-edit";

function resolveRootOrExit(): string {
  try {
    return findProjectRoot(process.cwd());
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

// ─────────────────────────────────────────────────────────────────────
// Read-only queries — return slices of state.yaml so agents can avoid
// Read+grep round-trips on the whole file. Output goes to stdout: strings
// are pipe-friendly raw values; YAML/JSON for structures (--json flag).
// ─────────────────────────────────────────────────────────────────────

const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Print one field from state.yaml by dotted path (e.g. position.plan)",
  },
  args: {
    key: {
      type: "positional",
      description: 'Dotted path into state.yaml (e.g. "position.plan", "progress.tasks_completed")',
      required: true,
    },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    const state = (await readState(root)) ?? {};
    await printValue(dottedGet(state, args.key), { json: args.json });
  },
});

const currentTaskCommand = defineCommand({
  meta: {
    name: "current-task",
    description: "Print the active task id, name, path, and parent plan info",
  },
  args: {
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    const state = (await readState(root)) ?? {};
    const tasks = state.current_plan?.tasks ?? [];
    const idx = state.current_plan?.current_task_index ?? null;
    const path = idx != null && idx >= 0 && idx < tasks.length ? tasks[idx] : null;
    const result = {
      id: state.position?.task ?? null,
      name: state.position?.task_name ?? null,
      path,
      plan: state.position?.plan ?? null,
      plan_name: state.position?.plan_name ?? null,
      status: state.position?.status ?? null,
    };
    await printValue(result, { json: args.json });
  },
});

const nextTaskCommand = defineCommand({
  meta: {
    name: "next-task",
    description: "Print the next pending task path (first task in current_plan.tasks not in completed_tasks)",
  },
  args: {
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    const state = (await readState(root)) ?? {};
    const tasks = state.current_plan?.tasks ?? [];
    const completed = new Set(state.current_plan?.completed_tasks ?? []);
    const next = tasks.find((t) => !completed.has(t)) ?? null;
    if (next == null) {
      // No pending task — exit silently with code 1 so scripts can branch.
      process.exit(1);
    }
    await printValue(next, { json: args.json });
  },
});

const progressCommand = defineCommand({
  meta: {
    name: "progress",
    description: "Print just the progress: block from state.yaml",
  },
  args: {
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    const state = (await readState(root)) ?? {};
    await printValue(state.progress ?? null, { json: args.json });
  },
});

const planTasksCommand = defineCommand({
  meta: {
    name: "plan-tasks",
    description: "Print the current_plan.tasks list (one path per line by default)",
  },
  args: {
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const root = resolveRootOrExit();
    const state = (await readState(root)) ?? {};
    const tasks = state.current_plan?.tasks ?? [];
    if (args.json) {
      await printValue(tasks, { json: true });
      return;
    }
    // Default: one task path per line — pipe-friendly for `xargs` etc.
    for (const t of tasks) process.stdout.write(t + "\n");
  },
});

export const stateCommand = defineCommand({
  meta: {
    name: "state",
    description: "Manage Software Teams state transitions and read state slices",
  },
  subCommands: {
    "plan-ready": planReadyCommand,
    approved: approvedCommand,
    executing: executingCommand,
    complete: completeCommand,
    "advance-task": advanceTaskCommand,
    get: getCommand,
    "current-task": currentTaskCommand,
    "next-task": nextTaskCommand,
    progress: progressCommand,
    "plan-tasks": planTasksCommand,
  },
});
