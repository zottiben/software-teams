import { defineCommand } from "citty";
import { consola } from "consola";
import { loadYaml, saveYaml, softwareTeamsPath, printValue, type YamlObject } from "../utils/yaml-edit";

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

// ─────────────────────────────────────────────────────────────────────
// Read-only queries — return slices of roadmap.yaml so agents avoid
// reading the full file just to find one phase or one plan entry.
// ─────────────────────────────────────────────────────────────────────

async function loadRoadmap(): Promise<YamlObject> {
  return loadYaml(softwareTeamsPath("roadmap.yaml"));
}

function activePhaseId(data: YamlObject): string | null {
  const overview = data.overview as YamlObject | undefined;
  if (overview && Array.isArray(overview.active) && overview.active.length > 0) {
    return String(overview.active[0]);
  }
  // Fall back to the first numeric key under `phases:` whose status is not
  // "complete". Roadmap files written by older versions of Software Teams
  // may not have an `overview:` block.
  const phases = (data.phases ?? {}) as YamlObject;
  for (const k of Object.keys(phases).sort()) {
    const phase = phases[k] as YamlObject | undefined;
    if (phase && phase.status !== "complete") return k;
  }
  return null;
}

const currentPhaseCommand = defineCommand({
  meta: {
    name: "current-phase",
    description: "Print the active phase entry (id, name, goal, plans)",
  },
  args: { json: { type: "boolean", description: "JSON output", default: false } },
  async run({ args }) {
    const data = await loadRoadmap();
    const id = activePhaseId(data);
    if (id == null) process.exit(1);
    const phases = (data.phases ?? {}) as YamlObject;
    const phase = phases[id];
    if (phase == null) process.exit(1);
    await printValue({ id, ...(phase as YamlObject) }, { json: args.json });
  },
});

const getPlanCommand = defineCommand({
  meta: {
    name: "get-plan",
    description: "Print a single plan entry from roadmap.yaml",
  },
  args: {
    phase: { type: "string", description: "Phase id", required: true },
    plan: { type: "string", description: "Plan id", required: true },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const data = await loadRoadmap();
    const phases = (data.phases ?? {}) as YamlObject;
    const phase = phases[args.phase] as YamlObject | undefined;
    const plan = phase?.plans ? (phase.plans as YamlObject)[args.plan] : undefined;
    if (plan == null) process.exit(1);
    await printValue(plan, { json: args.json });
  },
});

const listPlansCommand = defineCommand({
  meta: {
    name: "list-plans",
    description: "List plan entries (id, name, status). Defaults to all phases.",
  },
  args: {
    phase: { type: "string", description: "Filter to one phase id" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const data = await loadRoadmap();
    const phases = (data.phases ?? {}) as YamlObject;
    const out: Array<{ phase: string; plan: string; name: string; status: string }> = [];
    for (const phaseId of Object.keys(phases).sort()) {
      if (args.phase && phaseId !== args.phase) continue;
      const phase = phases[phaseId] as YamlObject | undefined;
      const plans = (phase?.plans ?? {}) as YamlObject;
      for (const planId of Object.keys(plans).sort()) {
        const plan = plans[planId] as YamlObject | undefined;
        out.push({
          phase: phaseId,
          plan: planId,
          name: String(plan?.name ?? ""),
          status: String(plan?.status ?? ""),
        });
      }
    }
    if (args.json) {
      await printValue(out, { json: true });
      return;
    }
    for (const row of out) {
      process.stdout.write(`${row.phase}\t${row.plan}\t${row.status}\t${row.name}\n`);
    }
  },
});

const nextPlanCommand = defineCommand({
  meta: {
    name: "next-plan",
    description: "Print the first pending plan in the active phase",
  },
  args: { json: { type: "boolean", description: "JSON output", default: false } },
  async run({ args }) {
    const data = await loadRoadmap();
    const phaseId = activePhaseId(data);
    if (phaseId == null) process.exit(1);
    const phases = (data.phases ?? {}) as YamlObject;
    const phase = phases[phaseId] as YamlObject | undefined;
    const plans = (phase?.plans ?? {}) as YamlObject;
    for (const planId of Object.keys(plans).sort()) {
      const plan = plans[planId] as YamlObject | undefined;
      if (plan?.status !== "complete") {
        await printValue({ phase: phaseId, plan: planId, ...(plan ?? {}) }, { json: args.json });
        return;
      }
    }
    // No pending plan in the active phase.
    process.exit(1);
  },
});

export const roadmapCommand = defineCommand({
  meta: {
    name: "roadmap",
    description: "Manage and inspect .software-teams/roadmap.yaml",
  },
  subCommands: {
    "add-plan": addPlanCommand,
    "set-status": setStatusCommand,
    "current-phase": currentPhaseCommand,
    "get-plan": getPlanCommand,
    "list-plans": listPlansCommand,
    "next-plan": nextPlanCommand,
  },
});
