import { defineCommand } from "citty";
import { consola } from "consola";
import { loadYaml, saveYaml, softwareTeamsPath, type YamlObject } from "../utils/yaml-edit";

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

export const requirementsCommand = defineCommand({
  meta: {
    name: "requirements",
    description: "Manage .software-teams/requirements.yaml entries (CLI replaces tool-call edits)",
  },
  subCommands: {
    "add-trace": addTraceCommand,
    "add-risk": addRiskCommand,
  },
});
