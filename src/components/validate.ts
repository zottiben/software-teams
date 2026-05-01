/**
 * Component registry validator.
 *
 * Checks:
 * 1. Every section's `requires` references resolve without error.
 * 2. The dependency graph is acyclic (DFS three-colour marking).
 * 3. Scans `framework/**\/*.md` for `@ST:` tags and reports every broken
 *    ref (component not found, or section not found).
 *
 * Called at build time and from `software-teams component validate` CLI (T7).
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs";
import type { SectionRef } from "./types";
import { registry } from "./registry";
import { tryResolve } from "./resolve";

// ---------------------------------------------------------------------------
// Markdown scanner — dual regex for migration window
// ---------------------------------------------------------------------------

/**
 * Matches `@ST:Name(:Section)?` source tags. Group 1 = component name;
 * group 2 = section name (optional).
 *
 * The legacy `<JDI:` recognition was dropped in plan 3-02 once the
 * migration window closed.
 */
const TAG_REGEX = /@ST:([A-Za-z][A-Za-z0-9-]*)(?::([A-Za-z][A-Za-z0-9-]*))?/g;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type Colour = "white" | "grey" | "black";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normaliseSectionRef(
  ref: SectionRef,
): { component: string; section: string | undefined } {
  if (typeof ref === "string") {
    return { component: ref, section: undefined };
  }
  return { component: ref.component, section: ref.section };
}

/**
 * DFS cycle detection over the registry graph.
 *
 * @param componentName - Starting component name.
 * @param sectionName - Starting section name (undefined = all sections).
 * @param colours - Three-colour DFS state map (keyed `${name}:${section ?? ""}`).
 * @param path - Current traversal path for error messages.
 * @param errors - Accumulator for validation errors.
 */
function dfsCheck(
  componentName: string,
  sectionName: string | undefined,
  colours: Map<string, Colour>,
  path: string[],
  errors: string[],
): void {
  const component = registry[componentName];
  if (component === undefined) {
    errors.push(`Unknown component '${componentName}' (referenced in dep graph)`);
    return;
  }

  const sectionKeys =
    sectionName !== undefined
      ? [sectionName]
      : component.defaultOrder !== undefined
        ? [...component.defaultOrder]
        : Object.keys(component.sections);

  for (const sKey of sectionKeys) {
    const nodeKey = `${componentName}:${sKey}`;

    if (colours.get(nodeKey) === "black") continue;

    if (colours.get(nodeKey) === "grey") {
      const cycleStart = path.indexOf(nodeKey);
      const cycle = [...path.slice(cycleStart), nodeKey].join(" → ");
      errors.push(`Circular dependency detected: ${cycle}`);
      continue;
    }

    const sec = component.sections[sKey];
    if (sec === undefined) {
      errors.push(
        `Section '${sKey}' not found in component '${componentName}'`,
      );
      continue;
    }

    colours.set(nodeKey, "grey");
    path.push(nodeKey);

    for (const req of sec.requires ?? []) {
      const { component: depComp, section: depSec } = normaliseSectionRef(req);
      const depComponent = registry[depComp];

      if (depComponent === undefined) {
        errors.push(
          `Component '${componentName}' section '${sKey}' requires unknown component '${depComp}'`,
        );
        continue;
      }

      if (depSec !== undefined && !(depSec in depComponent.sections)) {
        errors.push(
          `Component '${componentName}' section '${sKey}' requires unknown section '${depComp}:${depSec}'`,
        );
        continue;
      }

      dfsCheck(depComp, depSec, colours, path, errors);
    }

    path.pop();
    colours.set(nodeKey, "black");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the entire component registry.
 *
 * Performs two passes:
 *
 * **Pass 1 — registry graph.**
 * Walks every component and section's `requires` list. Confirms each ref
 * resolves. Runs DFS three-colour cycle detection across the full graph.
 *
 * **Pass 2 — markdown source scan.**
 * Scans all `*.md` files under `framework/` (via `Bun.Glob`) for
 * `@ST:Name(:Section)?` tags. Reports broken refs with file path and
 * line number (one error per broken tag).
 *
 * @returns `{ ok: true }` when the registry and all markdown refs are valid,
 *   or `{ ok: false; errors: string[] }` listing every problem found.
 *
 * @example
 * const result = validateRegistry();
 * if (!result.ok) {
 *   for (const err of result.errors) console.error(err);
 *   process.exit(1);
 * }
 */
export function validateRegistry():
  | { ok: true }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];

  // ------------------------------------------------------------------
  // Pass 1: registry graph — requires resolution + cycle detection
  // ------------------------------------------------------------------
  const colours = new Map<string, Colour>();
  const path: string[] = [];

  for (const componentName of Object.keys(registry)) {
    const component = registry[componentName];
    const sectionKeys =
      component.defaultOrder !== undefined
        ? [...component.defaultOrder]
        : Object.keys(component.sections);

    for (const sKey of sectionKeys) {
      dfsCheck(componentName, sKey, colours, path, errors);
    }
  }

  // Also verify every ref resolves via the public resolver (catches any
  // mismatch between DFS logic and actual resolution).
  for (const componentName of Object.keys(registry)) {
    const component = registry[componentName];
    for (const sKey of Object.keys(component.sections)) {
      const sec = component.sections[sKey];
      for (const req of sec.requires ?? []) {
        const ref = normaliseSectionRef(req);
        const result = tryResolve(req);
        if (result === null) {
          const tag =
            ref.section !== undefined
              ? `${ref.component}:${ref.section}`
              : ref.component;
          errors.push(
            `Component '${componentName}' section '${sKey}' has unresolvable requires: '${tag}'`,
          );
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Pass 2: markdown source scan
  //
  // Resolution order:
  //   1. $COMPONENT_VALIDATE_FRAMEWORK_DIR (test override, set by T3 fixtures)
  //   2. <cwd>/framework (works for both `bun run src/index.ts` and
  //      `bun run dist/index.js` invocations — the CLI is always run from
  //      a project root that has framework/ alongside it)
  //   3. <module-relative>/../../framework (source-tree fallback for
  //      compiled bundles invoked from non-project locations)
  // ------------------------------------------------------------------
  const envOverride = process.env.COMPONENT_VALIDATE_FRAMEWORK_DIR;
  const cwdPath = `${process.cwd()}/framework`;
  const moduleRelative = new URL("../../../framework", import.meta.url).pathname;

  const frameworkPath =
    envOverride !== undefined && existsSync(envOverride)
      ? envOverride
      : existsSync(cwdPath)
        ? cwdPath
        : moduleRelative;

  if (existsSync(frameworkPath)) {
    const g = new Bun.Glob("**/*.md");
    for (const filePath of g.scanSync({ cwd: frameworkPath, absolute: true })) {
      let content: string;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        errors.push(`Could not read file: ${filePath}`);
        continue;
      }

      const lines = content.split("\n");
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        TAG_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = TAG_REGEX.exec(line)) !== null) {
          const compName = match[1];
          const secName = match[2] as string | undefined;

          const component = registry[compName];
          if (component === undefined) {
            const tag =
              secName !== undefined
                ? `${compName}:${secName}`
                : compName;
            errors.push(
              `${filePath}:${lineIdx + 1}: broken ref '@ST:${tag}' — component '${compName}' not found`,
            );
            continue;
          }

          if (secName !== undefined && !(secName in component.sections)) {
            errors.push(
              `${filePath}:${lineIdx + 1}: broken ref '@ST:${compName}:${secName}' — section '${secName}' not found in '${compName}'`,
            );
          }
        }
      }
    }
  }

  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}
