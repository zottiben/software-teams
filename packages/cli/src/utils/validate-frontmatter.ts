/**
 * Frontmatter gate: checks every agent spec and command against the real
 * Claude Code surface.
 *
 * Catches the failure mode that produced this module - a tool or model name
 * that is silently ignored by the harness, so it survives typecheck, lint,
 * test, and build, and only shows up as an agent that quietly cannot do its
 * job. See `shared/claude-code-surface.ts`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EFFORT_LEVELS,
  RETIRED_TOOL_REPLACEMENTS,
  SUBAGENT_STRIPPED_TOOLS,
  isValidModel,
  isValidToolName,
  retiredModelReplacement,
} from "../shared/claude-code-surface";

export interface FrontmatterFinding {
  readonly file: string;
  readonly field: string;
  readonly value: string;
  readonly message: string;
}

export interface FrontmatterReport {
  readonly errors: readonly FrontmatterFinding[];
  readonly warnings: readonly FrontmatterFinding[];
  readonly filesChecked: number;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Minimal frontmatter reader.
 *
 * Handles the two shapes Software Teams actually writes: `key: value` scalars
 * and `- item` block sequences. A full YAML parse is deliberately avoided so a
 * malformed body cannot make the gate throw instead of report.
 */
export function parseFrontmatter(source: string): Record<string, string | string[]> {
  const match = FRONTMATTER_RE.exec(source);
  if (!match?.[1]) return {};

  const out: Record<string, string | string[]> = {};
  const lines = match[1].split(/\r?\n/);
  const state = { key: "", list: [] as string[] };


  const flush = (): void => {
    if (state.key && state.list.length > 0) out[state.key] = [...state.list];
    state.list = [];
  };

  for (const line of lines) {
    const item = /^\s+-\s+(.*)$/.exec(line)?.[1];
    if (item !== undefined && state.key) {
      state.list.push(stripQuotes(item.trim()));
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const key = pair?.[1];
    const rawValue = pair?.[2];
    if (key === undefined || rawValue === undefined) continue;

    flush();
    state.key = key;
    const value = rawValue.trim();
    if (value) out[key] = stripQuotes(value);
  }
  flush();

  return out;
}

function stripQuotes(value: string): string {
  return /^(['"])(.*)\1$/.exec(value)?.[2] ?? value;
}

/** `Bash(git:*)` and `mcp__server__tool` are scoped forms; validate the base name. */
function baseToolName(entry: string): string {
  return entry.replace(/\(.*\)$/, "").trim();
}

function checkTools(
  file: string,
  field: string,
  entries: readonly string[],
  isSubagent: boolean,
  errors: FrontmatterFinding[],
  warnings: FrontmatterFinding[],
): void {
  for (const entry of entries) {
    const name = baseToolName(entry);
    if (!name || name.startsWith("mcp__")) continue;

    const replacement = RETIRED_TOOL_REPLACEMENTS[name];
    if (replacement) {
      errors.push({
        file,
        field,
        value: entry,
        message: `"${name}" is not a Claude Code tool any more. Use "${replacement}".`,
      });
      continue;
    }

    if (!isValidToolName(name)) {
      errors.push({
        file,
        field,
        value: entry,
        message: `"${name}" is not a Claude Code tool. Check shared/claude-code-surface.ts for the canonical list.`,
      });
      continue;
    }

    if (isSubagent && field === "tools" && SUBAGENT_STRIPPED_TOOLS.includes(name)) {
      warnings.push({
        file,
        field,
        value: entry,
        message: `"${name}" is stripped from every subagent by the harness, so granting it has no effect.`,
      });
    }
  }
}

async function readMarkdown(dir: string): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
  return Promise.all(
    files.map(async (e) => ({
      file: join(dir, e.name),
      source: await readFile(join(dir, e.name), "utf8"),
    })),
  );
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

/**
 * Validate agent specs and command/skill files under `root`.
 *
 * `agentsDir` files are subagent specs, so they get the extra
 * stripped-tool check. `commandDirs` files run in the main thread and do not.
 */
export async function validateFrontmatter(opts: {
  readonly agentsDir: string;
  readonly commandDirs: readonly string[];
}): Promise<FrontmatterReport> {
  const errors: FrontmatterFinding[] = [];
  const warnings: FrontmatterFinding[] = [];

  const agentFiles = await readMarkdown(opts.agentsDir);
  const commandFiles = (
    await Promise.all(opts.commandDirs.map((d) => readMarkdown(d)))
  ).flat();

  const all = [
    ...agentFiles.map((f) => ({ ...f, isSubagent: true })),
    ...commandFiles.map((f) => ({ ...f, isSubagent: false })),
  ];

  for (const { file, source, isSubagent } of all) {
    const fm = parseFrontmatter(source);

    checkTools(file, "tools", asList(fm["tools"]), isSubagent, errors, warnings);
    checkTools(file, "allowed-tools", asList(fm["allowed-tools"]), isSubagent, errors, warnings);
    checkTools(
      file,
      "disallowed-tools",
      asList(fm["disallowed-tools"]),
      isSubagent,
      errors,
      warnings,
    );
    checkTools(
      file,
      "disallowedTools",
      asList(fm["disallowedTools"]),
      isSubagent,
      errors,
      warnings,
    );

    const model = fm["model"];
    if (typeof model === "string") {
      const finding = checkModel(file, "model", model);
      if (finding) errors.push(finding);
    }

    const effort = fm["effort"];
    if (typeof effort === "string" && !EFFORT_LEVELS.includes(effort)) {
      errors.push({
        file,
        field: "effort",
        value: effort,
        message: `"${effort}" is not an effort level (${EFFORT_LEVELS.join(", ")}).`,
      });
    }
  }

  return { errors, warnings, filesChecked: all.length };
}

/** Validate the `models:` profiles and overrides in a parsed config.yaml. */
export function validateModelConfig(config: unknown): readonly FrontmatterFinding[] {
  const findings: FrontmatterFinding[] = [];
  const models = readRecord(readRecord(config)?.["models"]);
  if (!models) return findings;

  const profiles = readRecord(models["profiles"]) ?? {};
  for (const [profileName, profile] of Object.entries(profiles)) {
    for (const [agent, value] of Object.entries(readRecord(profile) ?? {})) {
      if (typeof value !== "string") continue;
      const finding = checkModel(
        "config/config.yaml",
        `models.profiles.${profileName}.${agent}`,
        value,
      );
      if (finding) findings.push(finding);
    }
  }

  for (const [agent, value] of Object.entries(readRecord(models["overrides"]) ?? {})) {
    if (typeof value !== "string") continue;
    const finding = checkModel("config/config.yaml", `models.overrides.${agent}`, value);
    if (finding) findings.push(finding);
  }

  return findings;
}

/** Reject both unrecognised model strings and well-formed but superseded pins. */
function checkModel(file: string, field: string, value: string): FrontmatterFinding | undefined {
  const replacement = retiredModelReplacement(value);
  if (replacement) {
    return {
      file,
      field,
      value,
      message: `"${value}" is a superseded model. Use the "${replacement}" alias, which tracks the current version.`,
    };
  }

  if (!isValidModel(value)) {
    return {
      file,
      field,
      value,
      message: `"${value}" is not a model alias or a claude-* model ID.`,
    };
  }

  return undefined;
}

/** Config arrives as `unknown` from a YAML parse; narrow before indexing. */
function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
