/**
 * component.ts — `software-teams component` subcommand tree (singular).
 *
 * Subcommands:
 *   get <name> [section]  — resolve and print component body to stdout.
 *   list                  — markdown table of all registered components.
 *   validate              — CI-facing registry validation.
 *
 * The hidden `drift` subcommand was retired in plan 3-02 alongside the
 * markdown component layer.
 *
 * @see docs/typescript-injection-design.md §"CLI surface"
 * @see .software-teams/plans/3-01-component-system-pivot.T7.md
 */

import { defineCommand } from "citty";
import { consola } from "consola";
import { getComponent } from "../components/resolve";
import { validateRegistry } from "../components/validate";
import { registry } from "../components/registry";

// ─── get subcommand ───────────────────────────────────────────────────────────

const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Resolve and print a component's body to stdout",
  },
  args: {
    name: {
      type: "positional",
      description: "Component name (e.g. Verify)",
      required: true,
    },
    section: {
      type: "positional",
      description: "Optional section name (e.g. Task)",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output structured JSON instead of plain text",
      default: false,
    },
  },
  async run({ args }) {
    const name = args.name as string;
    const section = args.section as string | undefined;

    let body: string;
    try {
      body = getComponent(name, section);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      consola.error(message);
      process.exit(1);
    }

    if (args.json) {
      const component = registry[name];
      // Build requires list from each section's requires field.
      const sectionKeys =
        section !== undefined
          ? [section]
          : component.defaultOrder !== undefined
            ? [...component.defaultOrder]
            : Object.keys(component.sections);

      const requiresList: string[] = [];
      for (const sKey of sectionKeys) {
        const sec = component.sections[sKey];
        if (sec?.requires) {
          for (const req of sec.requires) {
            const ref =
              typeof req === "string"
                ? req
                : `${req.component}:${req.section}`;
            if (!requiresList.includes(ref)) requiresList.push(ref);
          }
        }
      }

      const output: Record<string, unknown> = {
        name,
        body,
      };
      if (section !== undefined) output.section = section;
      if (requiresList.length > 0) output.requires = requiresList;

      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Plain text: body goes to stdout so piping works (`... | wc -c`).
    console.log(body);
  },
});

// ─── list subcommand ──────────────────────────────────────────────────────────

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all registered components as a markdown table",
  },
  args: {
    json: {
      type: "boolean",
      description: "Dump the full registry as JSON instead of a table",
      default: false,
    },
  },
  async run({ args }) {
    if (args.json) {
      console.log(JSON.stringify(registry, null, 2));
      return;
    }

    // Markdown table header.
    const header = "| component | category | sections | total bytes |";
    const divider = "|-----------|----------|----------|-------------|";
    consola.log(header);
    consola.log(divider);

    const names = Object.keys(registry).sort();
    for (const name of names) {
      const comp = registry[name];
      const sectionCount = Object.keys(comp.sections).length;
      const totalBytes = Object.values(comp.sections).reduce(
        (acc, sec) => acc + Buffer.byteLength(sec.body, "utf8"),
        0,
      );
      consola.log(
        `| ${name} | ${comp.category} | ${sectionCount} | ${totalBytes} |`,
      );
    }
  },
});

// ─── validate subcommand ─────────────────────────────────────────────────────

/**
 * `software-teams component validate` — CI registry integrity check.
 *
 * CI DEPENDENCY NOTICE
 * ====================
 * This command is called by the CI pipeline (component-drift-check job).
 * Validates the component registry: every section's `requires` list resolves,
 * the dep graph is acyclic, and every @ST: tag in framework markdown has a
 * matching component+section.
 *
 * Drift-check (markdown ↔ TS comparison) was retired in plan 3-02 once the
 * markdown component layer was deleted; the TS registry is the sole source.
 *
 * Exit code:
 *   0 — clean.
 *   1 — one or more errors (details printed to stderr before exit).
 */
const validateCommand = defineCommand({
  meta: {
    name: "validate",
    description: "Validate the component registry (CI use)",
  },
  async run() {
    consola.info("## Registry validation");
    const registryResult = validateRegistry();
    if (registryResult.ok) {
      consola.success("Component registry validated cleanly.");
      return;
    }
    consola.error(
      `Registry validation failed with ${registryResult.errors.length} error(s):`,
    );
    for (const err of registryResult.errors) {
      consola.error(`  ${err}`);
    }
    process.exit(1);
  },
});

// ─── component command ────────────────────────────────────────────────────────

/**
 * `software-teams component` — single-component CLI surface.
 *
 * Three public subcommands: `get`, `list`, `validate`.
 * One hidden CI subcommand: `drift`.
 */
export const componentCommand = defineCommand({
  meta: {
    name: "component",
    description: "Manage and inspect Software Teams components",
  },
  subCommands: {
    get: getCommand,
    list: listCommand,
    validate: validateCommand,
  },
});
