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

const setTechStackCommand = defineCommand({
  meta: {
    name: "set-tech-stack",
    description: "Update tech_stack values in project.yaml (only fields you pass are touched)",
  },
  args: {
    backend: {
      type: "string",
      description: 'Backend stack identifier (e.g. "php-laravel", "node-express", or "none")',
    },
    frontend: {
      type: "string",
      description: 'Frontend stack identifier (e.g. "react-typescript", "nextjs", or "none")',
    },
    devops: {
      type: "string",
      description: 'DevOps stack identifier (e.g. "docker-k8s", "serverless", or "none")',
    },
  },
  async run({ args }) {
    if (args.backend == null && args.frontend == null && args.devops == null) {
      consola.error("Pass at least one of --backend, --frontend, --devops");
      process.exit(1);
    }
    const path = softwareTeamsPath("project.yaml");
    const data = await loadYaml(path);
    const techStack = ensureMapping(data, "tech_stack");

    const setField = (key: string, value: string | undefined) => {
      if (value == null) return;
      techStack[key] = value === "none" || value === "null" ? null : value;
    };
    setField("backend", args.backend);
    setField("frontend", args.frontend);
    setField("devops", args.devops);

    if (!("last_updated" in data)) data.last_updated = "";
    await saveYaml(path, data);
    const summary = [
      args.backend != null ? `backend=${args.backend}` : null,
      args.frontend != null ? `frontend=${args.frontend}` : null,
      args.devops != null ? `devops=${args.devops}` : null,
    ]
      .filter((s) => s != null)
      .join(", ");
    consola.success(`project.yaml: tech_stack ${summary}`);
  },
});

const setMetaCommand = defineCommand({
  meta: {
    name: "set-meta",
    description: "Update top-level project metadata (name, summary, core_value, background)",
  },
  args: {
    name: { type: "string", description: "Project name" },
    summary: { type: "string", description: "One-liner description" },
    "core-value": { type: "string", description: "The one thing that must work" },
    background: { type: "string", description: "Why this project exists" },
  },
  async run({ args }) {
    const fields: Array<[string, string | undefined]> = [
      ["name", args.name],
      ["summary", args.summary],
      ["core_value", args["core-value"]],
      ["background", args.background],
    ];
    if (fields.every(([, v]) => v == null)) {
      consola.error("Pass at least one of --name, --summary, --core-value, --background");
      process.exit(1);
    }
    const path = softwareTeamsPath("project.yaml");
    const data = await loadYaml(path);
    const updated: string[] = [];
    for (const [key, value] of fields) {
      if (value == null) continue;
      data[key] = value;
      updated.push(`${key}=${value}`);
    }
    if (!("last_updated" in data)) data.last_updated = "";
    await saveYaml(path, data);
    consola.success(`project.yaml: ${updated.join(", ")}`);
  },
});

export const projectCommand = defineCommand({
  meta: {
    name: "project",
    description: "Manage .software-teams/project.yaml entries (CLI replaces tool-call edits)",
  },
  subCommands: {
    "set-tech-stack": setTechStackCommand,
    "set-meta": setMetaCommand,
  },
});
