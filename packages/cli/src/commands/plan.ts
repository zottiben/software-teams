import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve, basename, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { spawnClaude } from "../utils/claude";
import { createStorage } from "../storage";
import { savePersistedState } from "../utils/storage-lifecycle";
import { gatherPromptContext, buildPlanPrompt } from "../utils/prompt-builder";
import { printValue, projectRoot, softwareTeamsPath } from "../utils/yaml-edit";

// ─────────────────────────────────────────────────────────────────────
// Existing behaviour: spawn the planner Claude session against the
// supplied feature description. Lives at `software-teams plan run` now
// that `plan` is a namespace; the historical `plan <description>` form
// was unused outside test fixtures.
// ─────────────────────────────────────────────────────────────────────

const runCommand = defineCommand({
  meta: {
    name: "run",
    description: "Spawn the planner Claude session for a feature description",
  },
  args: {
    description: {
      type: "positional",
      description: "Feature description or ticket reference",
      required: true,
    },
    output: { type: "string", description: "Write prompt to file instead of executing" },
    print: { type: "boolean", description: "Print the prompt to stdout instead of executing", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = await gatherPromptContext(cwd);
    const prompt = buildPlanPrompt(ctx, args.description);

    if (args.output) {
      await Bun.write(resolve(cwd, args.output), prompt);
      consola.success(`Prompt written to ${args.output}`);
    } else if (args.print) {
      console.log(prompt);
    } else {
      const { exitCode } = await spawnClaude(prompt, { cwd });
      const storage = await createStorage(cwd);
      await savePersistedState(cwd, storage);
      if (exitCode !== 0) {
        consola.error(`Claude exited with code ${exitCode}`);
        process.exit(exitCode);
      }
    }
  },
});

// ─────────────────────────────────────────────────────────────────────
// Read-only queries — return slices of plan files so agents (especially
// per-task spawns) avoid Read+grep over the whole orchestration / spec.
// ─────────────────────────────────────────────────────────────────────

interface PlanFiles {
  slug: string;
  /** Path to {slug}.spec.md if present (three-tier mode). */
  spec: string | null;
  /** Path to {slug}.orchestration.md if present (three-tier mode). */
  orchestration: string | null;
  /** Path to {slug}.plan.md if present (single-tier or legacy three-tier). */
  index: string | null;
  /** Per-task slice paths discovered by glob. */
  tasks: string[];
}

function plansDir(): string {
  return softwareTeamsPath("plans");
}

/**
 * Discover every plan slug currently in `.software-teams/plans/`. A slug is
 * the prefix shared by `{slug}.{spec|orchestration|plan|T{n}}.md` files.
 */
function listPlanSlugs(): string[] {
  const dir = plansDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const slugs = new Set<string>();
  for (const f of files) {
    const m = f.match(/^(.+?)\.(spec|orchestration|plan|T\d+)\.md$/);
    if (m) slugs.add(m[1]);
  }
  return [...slugs].sort();
}

/**
 * Resolve a plan slug into its on-disk files. When `slugOrPath` matches no
 * slug, it's treated as a path (relative to project root) and the slug is
 * derived from the filename.
 */
function resolvePlan(slugOrPath: string): PlanFiles | null {
  const dir = plansDir();
  if (!existsSync(dir)) return null;

  // Derive slug. If caller passed a full path, strip dir + suffix.
  let slug = basename(slugOrPath)
    .replace(/\.orchestration\.md$/i, "")
    .replace(/\.spec\.md$/i, "")
    .replace(/\.plan\.md$/i, "")
    .replace(/\.T\d+\.md$/i, "")
    .replace(/\.md$/i, "");

  const known = listPlanSlugs();
  // Allow short forms — e.g. `1-02` matches `1-02-some-feature`.
  if (!known.includes(slug)) {
    const partial = known.find((s) => s.startsWith(slug + "-") || s === slug);
    if (partial) slug = partial;
    else return null;
  }

  const candidate = (suffix: string) => {
    const p = join(dir, `${slug}${suffix}`);
    return existsSync(p) ? p : null;
  };

  const taskFiles = readdirSync(dir)
    .filter((f) => f.startsWith(slug + ".T") && /\.T\d+\.md$/.test(f))
    .sort()
    .map((f) => join(dir, f));

  return {
    slug,
    spec: candidate(".spec.md"),
    orchestration: candidate(".orchestration.md"),
    index: candidate(".plan.md"),
    tasks: taskFiles,
  };
}

/**
 * Resolve the active plan from state.yaml — used as the default target
 * when the caller doesn't pass a `--plan` flag.
 */
async function resolveActivePlan(): Promise<PlanFiles | null> {
  try {
    const { readState } = await import("../utils/state");
    const state = await readState(projectRoot());
    const planId = state?.position?.plan;
    if (!planId) return null;
    return resolvePlan(String(planId));
  } catch {
    return null;
  }
}

/**
 * Parse a markdown file into an ordered list of `{ heading, body }` blocks
 * where each block starts at a `## Heading` line. Used by `get-spec` /
 * `get-orchestration` to return a single section without forcing the
 * caller to Read the whole file.
 */
function splitMarkdownByH2(content: string): Array<{ heading: string; body: string; slug: string }> {
  // Strip leading frontmatter so it doesn't get treated as a section.
  const stripped = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = stripped.split("\n");
  const sections: Array<{ heading: string; body: string; slug: string }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  const slugify = (h: string) =>
    h.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const flush = () => {
    if (currentHeading != null) {
      sections.push({
        heading: currentHeading,
        body: currentLines.join("\n").trimEnd(),
        slug: slugify(currentHeading),
      });
    }
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentHeading = m[1];
      currentLines = [];
    } else if (currentHeading != null) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all plan slugs in .software-teams/plans/",
  },
  args: {
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const slugs = listPlanSlugs();
    if (args.json) {
      await printValue(slugs, { json: true });
      return;
    }
    for (const s of slugs) process.stdout.write(s + "\n");
  },
});

const getTaskCommand = defineCommand({
  meta: {
    name: "get-task",
    description: "Print the body of one per-task slice file by task id (e.g. T1)",
  },
  args: {
    "task-id": {
      type: "positional",
      description: 'Task id (e.g. "T1") or full slice path',
      required: true,
    },
    plan: {
      type: "string",
      description: "Plan slug (defaults to the active plan from state.yaml)",
    },
  },
  async run({ args }) {
    const plan = args.plan ? resolvePlan(args.plan) : await resolveActivePlan();
    if (plan == null) {
      consola.error(`Could not resolve plan${args.plan ? ` "${args.plan}"` : " from state.yaml"}.`);
      process.exit(1);
    }
    const taskRef = args["task-id"];
    // Allow the caller to pass either "T1" or the full slice path.
    const match = plan.tasks.find((p) => {
      const fname = basename(p);
      return fname === taskRef || fname.endsWith(`.${taskRef}.md`) || p === taskRef;
    });
    if (match == null) {
      consola.error(
        `No task slice for "${taskRef}" in plan ${plan.slug}. Known tasks: ${plan.tasks.map((p) => basename(p)).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }
    process.stdout.write(await Bun.file(match).text());
  },
});

const listTasksCommand = defineCommand({
  meta: {
    name: "list-tasks",
    description: "List task slice paths for a plan (one per line)",
  },
  args: {
    plan: { type: "string", description: "Plan slug (defaults to active plan)" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const plan = args.plan ? resolvePlan(args.plan) : await resolveActivePlan();
    if (plan == null) process.exit(1);
    if (args.json) {
      await printValue(plan.tasks, { json: true });
      return;
    }
    for (const t of plan.tasks) process.stdout.write(t + "\n");
  },
});

async function printSection(filePath: string, sectionSlug: string | undefined): Promise<void> {
  const content = await Bun.file(filePath).text();
  if (sectionSlug == null) {
    process.stdout.write(content);
    return;
  }
  const sections = splitMarkdownByH2(content);
  const wanted = sections.find((s) => s.slug === sectionSlug.toLowerCase());
  if (wanted == null) {
    consola.error(
      `Section "${sectionSlug}" not found. Known sections: ${sections.map((s) => s.slug).join(", ") || "(none)"}`,
    );
    process.exit(1);
  }
  process.stdout.write(`## ${wanted.heading}\n${wanted.body}\n`);
}

const getSpecCommand = defineCommand({
  meta: {
    name: "get-spec",
    description: "Print {slug}.spec.md, optionally filtered to a single section",
  },
  args: {
    plan: { type: "string", description: "Plan slug (defaults to active plan)" },
    section: {
      type: "string",
      description: 'Section slug (kebab-case of the H2 heading, e.g. "acceptance-criteria")',
    },
  },
  async run({ args }) {
    const plan = args.plan ? resolvePlan(args.plan) : await resolveActivePlan();
    if (plan == null || plan.spec == null) {
      consola.error(`No spec.md for plan ${plan?.slug ?? "(unknown)"}.`);
      process.exit(1);
    }
    await printSection(plan.spec, args.section);
  },
});

const getOrchestrationCommand = defineCommand({
  meta: {
    name: "get-orchestration",
    description: "Print {slug}.orchestration.md, optionally filtered to a single section",
  },
  args: {
    plan: { type: "string", description: "Plan slug (defaults to active plan)" },
    section: {
      type: "string",
      description: 'Section slug (kebab-case of the H2 heading, e.g. "tasks", "quality-gates", "risks")',
    },
  },
  async run({ args }) {
    const plan = args.plan ? resolvePlan(args.plan) : await resolveActivePlan();
    if (plan == null || plan.orchestration == null) {
      consola.error(`No orchestration.md for plan ${plan?.slug ?? "(unknown)"}.`);
      process.exit(1);
    }
    await printSection(plan.orchestration, args.section);
  },
});

const taskDepsCommand = defineCommand({
  meta: {
    name: "task-deps",
    description: "Print just the requires/provides/depends_on/affects fields from a task slice's frontmatter",
  },
  args: {
    "task-id": {
      type: "positional",
      description: 'Task id (e.g. "T1")',
      required: true,
    },
    plan: { type: "string", description: "Plan slug (defaults to active plan)" },
    json: { type: "boolean", description: "JSON output", default: false },
  },
  async run({ args }) {
    const plan = args.plan ? resolvePlan(args.plan) : await resolveActivePlan();
    if (plan == null) process.exit(1);
    const taskRef = args["task-id"];
    const match = plan.tasks.find((p) => basename(p).includes(`.${taskRef}.md`));
    if (match == null) {
      consola.error(`No task slice for "${taskRef}" in plan ${plan.slug}`);
      process.exit(1);
    }
    const content = await Bun.file(match).text();
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      await printValue({}, { json: args.json });
      return;
    }
    const fm = (parseYaml(fmMatch[1]) ?? {}) as Record<string, unknown>;
    const deps = {
      task_id: fm.task_id ?? args["task-id"],
      requires: fm.requires ?? [],
      provides: fm.provides ?? [],
      depends_on: fm.depends_on ?? [],
      affects: fm.affects ?? [],
      wave: fm.wave ?? null,
      agent: fm.agent ?? null,
    };
    await printValue(deps, { json: args.json });
  },
});

export const planCommand = defineCommand({
  meta: {
    name: "plan",
    description:
      "Inspect plan files in .software-teams/plans/ (or `plan run <description>` to spawn the planner)",
  },
  subCommands: {
    run: runCommand,
    list: listCommand,
    "list-tasks": listTasksCommand,
    "get-task": getTaskCommand,
    "get-spec": getSpecCommand,
    "get-orchestration": getOrchestrationCommand,
    "task-deps": taskDepsCommand,
  },
});
