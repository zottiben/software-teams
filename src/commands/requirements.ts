import { defineCommand } from "citty";
import { consola } from "consola";
import { loadYaml, saveYaml, softwareTeamsPath, printValue, type YamlObject } from "../utils/yaml-edit";

function ensureMapping(parent: YamlObject, key: string): YamlObject {
  const existing = parent[key];
  if (existing != null && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as YamlObject;
  }
  const fresh: YamlObject = {};
  parent[key] = fresh;
  return fresh;
}

function uniquePush<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr : [...arr, value];
}

const addTraceCommand = defineCommand({
  meta: {
    name: "add-trace",
    description: "Map task IDs to a requirement under phases.<phase>.requirements.<REQ-ID>.tasks",
  },
  args: {
    phase: {
      type: "string",
      description: 'Phase id (e.g. "1")',
      required: true,
    },
    req: {
      type: "string",
      description: 'Requirement id (e.g. "REQ-01")',
      required: true,
    },
    task: {
      type: "string",
      description:
        'Comma-separated task IDs to map to this requirement (e.g. "T1,T2,T3"). Existing entries are preserved.',
      required: true,
    },
  },
  async run({ args }) {
    const path = softwareTeamsPath("requirements.yaml");
    const data = await loadYaml(path);

    const phases = ensureMapping(data, "phases");
    const phase = ensureMapping(phases, args.phase);
    const requirements = ensureMapping(phase, "requirements");

    const req = ensureMapping(requirements, args.req);
    const newTasks = args.task
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (newTasks.length === 0) {
      consola.error(`--task must include at least one task id`);
      process.exit(1);
    }

    const existing = Array.isArray(req.tasks) ? (req.tasks as string[]) : [];
    let merged = existing;
    for (const t of newTasks) merged = uniquePush(merged, t);
    req.tasks = merged;

    if (!("last_updated" in data)) data.last_updated = "";
    await saveYaml(path, data);
    consola.success(
      `requirements.yaml: phase ${args.phase} ${args.req} ← tasks [${(merged as string[]).join(", ")}]`,
    );
  },
});

const addRiskCommand = defineCommand({
  meta: {
    name: "add-risk",
    description: "Append a risk entry to the top-level risks: list",
  },
  args: {
    id: {
      type: "string",
      description: 'Risk id (e.g. "R-02")',
      required: true,
    },
    description: {
      type: "string",
      description: "Risk description",
      required: true,
    },
    mitigation: {
      type: "string",
      description: "Mitigation approach",
      required: true,
    },
  },
  async run({ args }) {
    const path = softwareTeamsPath("requirements.yaml");
    const data = await loadYaml(path);

    const risks = Array.isArray(data.risks) ? (data.risks as YamlObject[]) : [];
    const idx = risks.findIndex((r) => (r as YamlObject)?.id === args.id);
    const entry: YamlObject = {
      id: args.id,
      description: args.description,
      mitigation: args.mitigation,
    };
    if (idx === -1) risks.push(entry);
    else risks[idx] = entry;
    data.risks = risks;

    if (!("last_updated" in data)) data.last_updated = "";
    await saveYaml(path, data);
    consola.success(`requirements.yaml: risk ${args.id} ${idx === -1 ? "added" : "updated"}`);
  },
});

// ─────────────────────────────────────────────────────────────────────
// Read-only queries — return slices of requirements.yaml so verifier /
// product-lead agents avoid Read-ing the whole file.
// ─────────────────────────────────────────────────────────────────────

async function loadRequirements(): Promise<YamlObject> {
  return loadYaml(softwareTeamsPath("requirements.yaml"));
}

const getReqCommand = defineCommand({
  meta: {
    name: "get",
    description: "Print one requirement entry by id (searches across phases)",
  },
  args: {
    "req-id": {
      type: "positional",
      description: 'Requirement id (e.g. "REQ-01")',
      required: true,
    },
    phase: { type: "string", description: "Restrict search to one phase" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const data = await loadRequirements();
    const phases = (data.phases ?? {}) as YamlObject;
    for (const phaseId of Object.keys(phases)) {
      if (args.phase && phaseId !== args.phase) continue;
      const phase = phases[phaseId] as YamlObject | undefined;
      const reqs = (phase?.requirements ?? {}) as YamlObject;
      if (args["req-id"] in reqs) {
        const req = reqs[args["req-id"]];
        await printValue({ phase: phaseId, id: args["req-id"], ...(req as YamlObject) }, { json: args.json });
        return;
      }
    }
    process.exit(1);
  },
});

const listReqsCommand = defineCommand({
  meta: {
    name: "list",
    description: "List requirement ids + descriptions (one per line by default)",
  },
  args: {
    phase: { type: "string", description: "Filter to one phase" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const data = await loadRequirements();
    const phases = (data.phases ?? {}) as YamlObject;
    const out: Array<{ phase: string; id: string; description: string; priority: string; status: string }> = [];
    for (const phaseId of Object.keys(phases).sort()) {
      if (args.phase && phaseId !== args.phase) continue;
      const phase = phases[phaseId] as YamlObject | undefined;
      const reqs = (phase?.requirements ?? {}) as YamlObject;
      for (const reqId of Object.keys(reqs).sort()) {
        const req = reqs[reqId] as YamlObject | undefined;
        out.push({
          phase: phaseId,
          id: reqId,
          description: String(req?.description ?? ""),
          priority: String(req?.priority ?? ""),
          status: String(req?.status ?? ""),
        });
      }
    }
    if (args.json) {
      await printValue(out, { json: true });
      return;
    }
    for (const row of out) {
      process.stdout.write(`${row.phase}\t${row.id}\t${row.priority}\t${row.status}\t${row.description}\n`);
    }
  },
});

const forTaskCommand = defineCommand({
  meta: {
    name: "for-task",
    description: "Reverse traceability — list requirement ids that name this task in their tasks: list",
  },
  args: {
    "task-id": {
      type: "positional",
      description: 'Task id (e.g. "T1")',
      required: true,
    },
    phase: { type: "string", description: "Restrict to one phase" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const data = await loadRequirements();
    const phases = (data.phases ?? {}) as YamlObject;
    const matches: Array<{ phase: string; id: string }> = [];
    for (const phaseId of Object.keys(phases)) {
      if (args.phase && phaseId !== args.phase) continue;
      const phase = phases[phaseId] as YamlObject | undefined;
      const reqs = (phase?.requirements ?? {}) as YamlObject;
      for (const reqId of Object.keys(reqs)) {
        const req = reqs[reqId] as YamlObject | undefined;
        const tasks = (req?.tasks ?? []) as unknown[];
        if (Array.isArray(tasks) && tasks.includes(args["task-id"])) {
          matches.push({ phase: phaseId, id: reqId });
        }
      }
    }
    if (args.json) {
      await printValue(matches, { json: true });
      return;
    }
    for (const m of matches) process.stdout.write(`${m.phase}\t${m.id}\n`);
    if (matches.length === 0) process.exit(1);
  },
});

const risksCommand = defineCommand({
  meta: {
    name: "risks",
    description: "Print just the risks: array",
  },
  args: { json: { type: "boolean", description: "JSON output", default: false } },
  async run({ args }) {
    const data = await loadRequirements();
    await printValue(data.risks ?? [], { json: args.json });
  },
});

export const requirementsCommand = defineCommand({
  meta: {
    name: "requirements",
    description: "Manage and inspect .software-teams/requirements.yaml",
  },
  subCommands: {
    "add-trace": addTraceCommand,
    "add-risk": addRiskCommand,
    get: getReqCommand,
    list: listReqsCommand,
    "for-task": forTaskCommand,
    risks: risksCommand,
  },
});
