/**
 * Component resolver — synchronous, cached, transitive-dep-aware.
 *
 * Public API declared in `docs/typescript-injection-design.md` §"Resolver API".
 * Downstream consumers (convert-agents.ts / T10, CLI / T7) import exclusively
 * from this file or the barrel at `src/components/index.ts`.
 *
 * @module
 */

import type { Component, SectionRef } from "./types";
import { registry } from "./registry";
import { closestMatch } from "./levenshtein";

// ---------------------------------------------------------------------------
// Module-level cache — safe because the registry is immutable.
// Key: "${name}:${section}" where section is "" for whole-component resolution.
// ---------------------------------------------------------------------------
const _cache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Throw a descriptive error when a component name is not found in the
 * registry, offering a Levenshtein-nearest suggestion.
 */
function throwUnknownComponent(name: string): never {
  const keys = Object.keys(registry);
  const suggestion = closestMatch(name, keys);
  const hint =
    suggestion !== undefined ? ` Did you mean '${suggestion}'?` : "";
  throw new Error(`Unknown component: '${name}'.${hint}`);
}

/**
 * Throw a descriptive error when a section name is not found within a
 * component, offering a Levenshtein-nearest suggestion.
 */
function throwUnknownSection(
  component: Component,
  section: string,
): never {
  const keys = Object.keys(component.sections);
  const suggestion = closestMatch(section, keys);
  const hint =
    suggestion !== undefined ? ` Did you mean '${suggestion}'?` : "";
  throw new Error(
    `Unknown section: '${section}' in component '${component.name}'.${hint}`,
  );
}

// Three-colour DFS marking for cycle detection.
type Colour = "white" | "grey" | "black";

/**
 * Resolve a single `SectionRef` to a `{ component, section | undefined }`
 * shape for uniform handling.
 */
function normaliseSectionRef(
  ref: SectionRef,
): { component: string; section: string | undefined } {
  if (typeof ref === "string") {
    return { component: ref, section: undefined };
  }
  return { component: ref.component, section: ref.section };
}

/**
 * Collect the ordered, deduplicated list of `(name, section)` pairs that must
 * be injected before the requested section. Uses DFS with three-colour marking
 * for cycle detection.
 *
 * @param name - Component name to start from.
 * @param section - Section name, or undefined for whole-component resolution.
 * @param visited - Dedup set (keyed `${name}:${section ?? ""}`).
 * @param colours - DFS colour map (keyed `${name}:${section ?? ""}`).
 * @param path - Current DFS traversal path for cycle error messages.
 * @returns Ordered array of `(name, section | undefined)` pairs,
 *          deps-first (i.e. the requested item is LAST).
 */
function collectDeps(
  name: string,
  section: string | undefined,
  visited: Set<string>,
  colours: Map<string, Colour>,
  path: string[],
): Array<{ name: string; section: string | undefined }> {
  const key = `${name}:${section ?? ""}`;

  // Already fully processed — skip (dedup).
  if (colours.get(key) === "black") return [];

  // Grey means we're currently processing this node — cycle detected.
  if (colours.get(key) === "grey") {
    const cycleStart = path.indexOf(key);
    const cycle = [...path.slice(cycleStart), key].join(" → ");
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  colours.set(key, "grey");
  path.push(key);

  const component = registry[name];
  if (component === undefined) throwUnknownComponent(name);

  // Determine which sections to process.
  let sectionKeys: string[];
  if (section !== undefined) {
    if (!(section in component.sections)) {
      throwUnknownSection(component, section);
    }
    sectionKeys = [section];
  } else {
    sectionKeys =
      component.defaultOrder !== undefined
        ? [...component.defaultOrder]
        : Object.keys(component.sections);
  }

  const result: Array<{ name: string; section: string | undefined }> = [];

  for (const sKey of sectionKeys) {
    const sectionObj = component.sections[sKey];
    if (sectionObj === undefined) {
      throwUnknownSection(component, sKey);
    }

    // Recurse into `requires` first (deps before body).
    for (const req of sectionObj.requires ?? []) {
      const { component: depName, section: depSection } =
        normaliseSectionRef(req);
      const depKey = `${depName}:${depSection ?? ""}`;
      if (!visited.has(depKey)) {
        const depResults = collectDeps(
          depName,
          depSection,
          visited,
          colours,
          path,
        );
        for (const item of depResults) {
          const itemKey = `${item.name}:${item.section ?? ""}`;
          if (!visited.has(itemKey)) {
            visited.add(itemKey);
            result.push(item);
          }
        }
      }
    }

    // Now push this section itself.
    const thisKey = `${name}:${sKey}`;
    if (!visited.has(thisKey)) {
      visited.add(thisKey);
      result.push({ name, section: sKey });
    }
  }

  path.pop();
  colours.set(key, "black");

  return result;
}

/**
 * Materialise a collected dep entry to its body string.
 */
function bodyOf(name: string, section: string): string {
  const component = registry[name];
  if (component === undefined) throwUnknownComponent(name);
  const sec = component.sections[section];
  if (sec === undefined) throwUnknownSection(component, section);
  return sec.body;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a component reference to injectable text.
 *
 * - `name` only: returns concatenated body of all sections in `defaultOrder`
 *   (or `Object.keys(component.sections)` order when `defaultOrder` is absent).
 * - `name + section`: returns just that section's body, preceded by the
 *   bodies of any transitive `requires`, all joined by `\n\n`.
 * - Transitive deps are resolved recursively and deduplicated by
 *   `${component}:${section}` key, injected in declaration order before the
 *   requested section.
 * - Cycles throw with the offending path included in the message.
 * - Results are cached per `(name, section)` for the lifetime of the process.
 *
 * @param name - The registered component name, e.g. `"AgentBase"`.
 * @param section - Optional section name, e.g. `"Sandbox"`.
 * @returns Resolved text ready for injection.
 *
 * @throws {Error} When `name` or `section` is not found (with suggestion).
 * @throws {Error} When a circular dependency is detected.
 *
 * @example
 * getComponent("AgentBase")              // all sections, in defaultOrder
 * getComponent("AgentBase", "Sandbox")   // just Sandbox + its transitive deps
 */
export function getComponent(name: string, section?: string): string {
  const cacheKey = `${name}:${section ?? ""}`;
  const cached = _cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Validate name early so errors are clear before dep traversal.
  if (!(name in registry)) throwUnknownComponent(name);
  const component = registry[name];
  if (section !== undefined && !(section in component.sections)) {
    throwUnknownSection(component, section);
  }

  const visited = new Set<string>();
  const colours = new Map<string, Colour>();
  const path: string[] = [];

  const pairs = collectDeps(name, section, visited, colours, path);

  const bodies = pairs.map((p) => bodyOf(p.name, p.section!));
  const resolved = bodies.join("\n\n");

  _cache.set(cacheKey, resolved);
  return resolved;
}

/**
 * Metadata-only lookup for tooling (`component list`, `component info`).
 *
 * Does not trigger resolution or caching — returns the raw `Component` object.
 *
 * @param name - The registered component name.
 * @returns The `Component` record.
 *
 * @throws {Error} When `name` is not found (with Levenshtein suggestion).
 *
 * @example
 * const info = getComponentInfo("Verify");
 * console.log(info.params); // declarative param metadata
 */
export function getComponentInfo(name: string): Component {
  const component = registry[name];
  if (component === undefined) throwUnknownComponent(name);
  return component;
}

/**
 * Returns `null` when the ref is bad. Callers can decide to throw or skip.
 *
 * Accepts the `SectionRef` shorthand (`string` for default section) or a full
 * `{ component, section }` object.
 *
 * @param ref - A `SectionRef` value.
 * @returns Resolved text, or `null` if the ref does not resolve.
 *
 * @example
 * const text = tryResolve("AgentBase");       // string or null
 * const text = tryResolve({ component: "AgentBase", section: "Sandbox" }); // string or null
 * const text = tryResolve("DoesNotExist");    // null
 */
export function tryResolve(ref: SectionRef): string | null {
  try {
    const { component, section } = normaliseSectionRef(ref);
    return getComponent(component, section);
  } catch {
    return null;
  }
}

/**
 * Expose the internal cache for testing purposes only.
 * @internal
 */
export function _resetCache(): void {
  _cache.clear();
}
