/**
 * component.ts — `software-teams component` subcommand tree (singular).
 *
 * Subcommands:
 *   get <name> [section]  — resolve and print component body to stdout.
 *   list                  — markdown table of all registered components.
 *   validate              — CI-facing registry + drift check (see validate JSDoc).
 *
 * The hidden `drift` subcommand (T5) is preserved unchanged.
 *
 * @see docs/typescript-injection-design.md §"CLI surface"
 * @see .software-teams/plans/3-01-component-system-pivot.T7.md
 */

import { defineCommand } from "citty";
import { consola } from "consola";
import { getComponent } from "../components/resolve";
import { validateRegistry } from "../components/validate";
import { registry } from "../components/registry";
import { checkComponentDrift } from "../utils/component-drift";

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
 * It performs two independent checks and reports each under its own heading:
 *
 *   1. Registry graph validation (`validateRegistry`) — checks that every
 *      section's `requires` list resolves, the dep graph is acyclic, and every
 *      @ST:/<JDI: tag in framework markdown has a matching component+section.
 *
 *   2. Markdown ↔ TS drift check (`checkComponentDrift`) — verifies that the
 *      markdown source files and TS modules have not diverged.
 *
 * Exit code:
 *   0 — both checks passed.
 *   1 — one or more errors found (details printed to stderr before exit).
 *
 * DO NOT change the exit-code contract or remove either check without updating
 * the CI job that depends on this command. If you find yourself wanting to
 * simplify this, read the comment above first.
 */
const validateCommand = defineCommand({
  meta: {
    name: "validate",
    description:
      "Validate the component registry and check for markdown ↔ TS drift (CI use)",
  },
  args: {
    "framework-dir": {
      type: "string",
      description:
        "Absolute path to the framework/ directory (default: <cwd>/framework)",
    },
  },
  async run({ args }) {
    let failed = false;

    // ── Check 1: Registry validation ─────────────────────────────────────────
    consola.info("## Registry validation");
    const registryResult = validateRegistry();
    if (registryResult.ok) {
      consola.success("Component registry validated cleanly.");
    } else {
      failed = true;
      consola.error(
        `Registry validation failed with ${registryResult.errors.length} error(s):`,
      );
      for (const err of registryResult.errors) {
        consola.error(`  ${err}`);
      }
    }

    // ── Check 2: Markdown ↔ TS drift ─────────────────────────────────────────
    consola.info("## Markdown ↔ TS drift check");
    const frameworkDir = args["framework-dir"] as string | undefined;
    const driftResult = await checkComponentDrift(
      frameworkDir ? { frameworkDir } : {},
    );
    if (driftResult.ok) {
      consola.success(
        "Component drift: clean — all markdown sections match TS source.",
      );
    } else {
      failed = true;
      consola.error(
        `Drift check failed: ${driftResult.diffs.length} section(s) drifted:`,
      );
      for (const diff of driftResult.diffs) {
        consola.error(`  ${diff.component}:${diff.section}`);
      }
    }

    if (failed) {
      process.exit(1);
    }
  },
});

// ─── drift subcommand ─────────────────────────────────────────────────────────

/**
 * Hidden CI subcommand: fails (exit 1) when any markdown component has drifted
 * from its TS counterpart. Exits 0 on a clean tree.
 *
 * Hidden because it is a CI concern, not a user-facing feature. T7 may
 * surface it as a public flag later if useful.
 */
const driftCommand = defineCommand({
  meta: {
    name: "drift",
    description: "Check for Markdown ↔ TS component drift (CI use only)",
    // Hidden from help output — not a user-facing command.
  },
  args: {
    "framework-dir": {
      type: "string",
      description:
        "Absolute path to the framework/ directory (default: <cwd>/framework)",
    },
  },
  async run({ args }) {
    const frameworkDir = args["framework-dir"] as string | undefined;
    const result = await checkComponentDrift(
      frameworkDir ? { frameworkDir } : {},
    );

    if (result.ok) {
      console.log("component drift: clean — all markdown sections match TS source");
      process.exit(0);
    }

    console.error(
      `component drift: ${result.diffs.length} section(s) drifted:\n`,
    );
    for (const diff of result.diffs) {
      console.error(`--- ${diff.component}:${diff.section} (markdown / actual)`);
      console.error(`+++ ${diff.component}:${diff.section} (TS module / expected)`);
      console.error("");
      console.error("  ACTUAL (markdown):");
      for (const line of diff.actual.split("\n").slice(0, 10)) {
        console.error(`    ${line}`);
      }
      if (diff.actual.split("\n").length > 10) {
        console.error("    ... (truncated)");
      }
      console.error("");
      console.error("  EXPECTED (TS):");
      for (const line of diff.expected.split("\n").slice(0, 10)) {
        console.error(`    ${line}`);
      }
      if (diff.expected.split("\n").length > 10) {
        console.error("    ... (truncated)");
      }
      console.error("");
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
    drift: driftCommand,
    get: getCommand,
    list: listCommand,
    validate: validateCommand,
  },
});
