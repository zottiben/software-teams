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
