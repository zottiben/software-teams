import { defineCommand } from "citty";
import { consola } from "consola";
import { loadYaml, saveYaml, softwareTeamsPath, type YamlObject } from "../utils/yaml-edit";

function parseWaves(input: string | undefined): number[] {
  if (input == null || input.trim() === "") return [1];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
        throw new Error(`Invalid wave number "${s}" — waves must be positive integers (e.g. --waves 1,2)`);
      }
      return n;
    });
}

function ensureMapping(parent: YamlObject, key: string): YamlObject {
  const existing = parent[key];
  if (existing != null && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as YamlObject;
  }
  const fresh: YamlObject = {};
  parent[key] = fresh;
  return fresh;
}

const addPlanCommand = defineCommand({
  meta: {
    name: "add-plan",
    description: "Add or update a plan entry under a phase in roadmap.yaml",
  },
  args: {
    phase: {
      type: "string",
      description: 'Phase id (e.g. "1")',
      required: true,
    },
    plan: {
      type: "string",
      description: 'Plan id within the phase (e.g. "01")',
      required: true,
    },
    name: {
      type: "string",
      description: "Human-readable plan name",
      required: true,
    },
    tasks: {
      type: "string",
      description: "Number of tasks in the plan",
      default: "0",
    },
    waves: {
      type: "string",
      description: 'Comma-separated wave numbers (e.g. "1,2")',
      default: "1",
    },
    status: {
      type: "string",
      description: "Plan status (pending|in_progress|complete)",
      default: "pending",
    },
    "phase-name": {
      type: "string",
      description: "Phase name (used when the phase entry is created)",
    },
    "phase-goal": {
      type: "string",
      description: "Phase goal (used when the phase entry is created)",
    },
  },
  async run({ args }) {
    const path = softwareTeamsPath("roadmap.yaml");
    const data = await loadYaml(path);

    const phases = ensureMapping(data, "phases");
    const phase = ensureMapping(phases, args.phase);
    if (typeof phase.name !== "string" && args["phase-name"]) {
      phase.name = args["phase-name"];
    }
    if (typeof phase.goal !== "string" && args["phase-goal"]) {
      phase.goal = args["phase-goal"];
    }
    if (phase.status == null) phase.status = "pending";

    const plans = ensureMapping(phase, "plans");
    const tasksNum = Number(args.tasks);
    if (!Number.isFinite(tasksNum) || tasksNum < 0) {
      consola.error(`Invalid --tasks value "${args.tasks}" — must be a non-negative integer`);
      process.exit(1);
    }

    plans[args.plan] = {
      name: args.name,
      tasks: tasksNum,
      waves: parseWaves(args.waves),
      status: args.status,
    };

    // Keep `overview.active` in sync — best-effort, only when the field
    // already exists. Don't invent it for users who removed it.
    if (data.overview && typeof data.overview === "object" && !Array.isArray(data.overview)) {
      const overview = data.overview as YamlObject;
      if (Array.isArray(overview.active)) {
        const phaseNum = Number(args.phase);
        if (Number.isFinite(phaseNum) && !overview.active.includes(phaseNum)) {
          overview.active.push(phaseNum);
          (overview.active as number[]).sort((a, b) => a - b);
        }
      }
    }

    if (!("last_updated" in data)) data.last_updated = "";
    await saveYaml(path, data);
    consola.success(`roadmap.yaml: phase ${args.phase} plan ${args.plan} (${args.name}) — ${tasksNum} task(s), waves ${args.waves}`);
  },
});

const setStatusCommand = defineCommand({
  meta: {
    name: "set-status",
    description: "Set a plan or phase status in roadmap.yaml",
  },
  args: {
    phase: {
      type: "string",
      description: 'Phase id (e.g. "1")',
      required: true,
    },
    plan: {
      type: "string",
      description: 'Plan id (omit to set the phase status itself)',
    },
    status: {
      type: "string",
      description: "New status",
      required: true,
    },
  },
  async run({ args }) {
    const path = softwareTeamsPath("roadmap.yaml");
    const data = await loadYaml(path);
    const phases = (data.phases ?? {}) as YamlObject;
    const phase = phases[args.phase];
    if (phase == null || typeof phase !== "object") {
      consola.error(`roadmap.yaml: phase ${args.phase} does not exist`);
      process.exit(1);
    }
    const phaseObj = phase as YamlObject;
    if (args.plan == null) {
      phaseObj.status = args.status;
    } else {
      const plans = (phaseObj.plans ?? {}) as YamlObject;
      const plan = plans[args.plan];
      if (plan == null || typeof plan !== "object") {
        consola.error(`roadmap.yaml: phase ${args.phase} plan ${args.plan} does not exist`);
        process.exit(1);
      }
      (plan as YamlObject).status = args.status;
    }
    if (!("last_updated" in data)) data.last_updated = "";
    await saveYaml(path, data);
    consola.success(
      args.plan == null
        ? `roadmap.yaml: phase ${args.phase} → status=${args.status}`
        : `roadmap.yaml: phase ${args.phase} plan ${args.plan} → status=${args.status}`,
    );
  },
});

export const roadmapCommand = defineCommand({
  meta: {
    name: "roadmap",
    description: "Manage .software-teams/roadmap.yaml entries (CLI replaces tool-call edits)",
  },
  subCommands: {
    "add-plan": addPlanCommand,
    "set-status": setStatusCommand,
  },
});
