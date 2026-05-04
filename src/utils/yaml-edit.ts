import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { findProjectRoot } from "./find-root";

export type YamlValue = unknown;
export type YamlObject = Record<string, YamlValue>;

/**
 * Load a YAML file as a plain object, returning `{}` when the file does not
 * exist. Throws when the file exists but cannot be parsed — callers SHOULD
 * surface the error to the user rather than silently swallow it (the YAML
 * file is project state, not optional cache).
 */
export async function loadYaml(path: string): Promise<YamlObject> {
  if (!existsSync(path)) return {};
  const content = await Bun.file(path).text();
  const parsed = parse(content);
  if (parsed == null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: expected YAML mapping at top level, got ${Array.isArray(parsed) ? "sequence" : typeof parsed}`);
  }
  return parsed as YamlObject;
}

/**
 * Stringify and write a YAML object to disk. Always sets `last_updated` to
 * the current date (YYYY-MM-DD) when the field is present in the input; this
 * mirrors what the planner used to do via Edit/Write tool calls and means
 * downstream readers can rely on `last_updated` being current after every
 * CLI mutation.
 */
export async function saveYaml(path: string, data: YamlObject): Promise<void> {
  if ("last_updated" in data) {
    data.last_updated = new Date().toISOString().slice(0, 10);
  }
  await Bun.write(path, stringify(data));
}

/**
 * Resolve the project root, throwing if the cwd is not inside a Software
 * Teams project. Used as the entry-point guard in CLI run handlers.
 */
export function projectRoot(): string {
  return findProjectRoot(process.cwd());
}

/**
 * Resolve a path inside the consumer-side `.software-teams/` install.
 */
export function softwareTeamsPath(...parts: string[]): string {
  return join(projectRoot(), ".software-teams", ...parts);
}

/**
 * Walk a dotted path (e.g. `"position.plan"`, `"phases.1.name"`) into a
 * parsed YAML object. Returns `undefined` when any segment is missing.
 * Numeric-looking segments hit the same key as their string form — YAML
 * `phases: { 1: { ... } }` round-trips with `1` as a number after parse,
 * so we coerce both sides to strings during lookup.
 */
export function dottedGet(obj: YamlValue, path: string): YamlValue {
  const segments = path.split(".").filter((s) => s.length > 0);
  let cursor: YamlValue = obj;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return undefined;
      cursor = cursor[idx];
      continue;
    }
    const map = cursor as Record<string, YamlValue>;
    if (seg in map) {
      cursor = map[seg];
    } else {
      // Try numeric key form (YAML parses `phases: { 1: ... }` as a numeric
      // key; lookups by `"1"` then need to land on the same slot).
      const numericKey = String(Number(seg));
      if (numericKey === seg && numericKey in map) {
        cursor = map[numericKey];
      } else {
        return undefined;
      }
    }
  }
  return cursor;
}

/**
 * Print a value to stdout for CLI consumption. Strings come out raw
 * (pipe-friendly); objects/arrays come out as YAML by default and JSON
 * when `json` is true. `undefined` exits with code 1 to signal "not
 * found" without writing anything to stdout.
 */
export async function printValue(
  value: YamlValue,
  opts: { json?: boolean } = {},
): Promise<void> {
  if (value === undefined) {
    process.exit(1);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(value + "\n");
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    process.stdout.write(String(value) + "\n");
    return;
  }
  // Lazy-load yaml to keep this helper cheap when callers stream strings.
  const { stringify } = await import("yaml");
  process.stdout.write(stringify(value));
}
