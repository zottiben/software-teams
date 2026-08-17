import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface AgentFrontmatter {
  name: string;
  description: string;
  model: string;
  tools: string[];
  /**
   * How thorough the agent is, independent of how capable `model` makes it.
   * Optional and usually absent: an agent without it inherits the model's
   * default effort, which is the recommended setting for most work.
   */
  effort?: string;
  /**
   * Persistent memory scope (`user` | `project` | `local`). Set on specialists
   * whose value compounds with codebase familiarity, so findings survive the
   * end of a spawn instead of being rediscovered every run.
   */
  memory?: string;
  /** Runaway circuit breaker: turns before the subagent is stopped. */
  maxTurns?: number;
  // Software Teams-only fields (preserved on input, dropped on output)
  category?: string;
  team?: string;
  requires_components?: string[];
  /** Ingestion boundary: agent YAML may contain arbitrary framework keys; preserve as unknown. */
  [key: string]: unknown;
}

const REQUIRED_FIELDS: readonly string[] = [
  "name",
  "description",
  "model",
  "tools",
];

export const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedAgentFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseAgentFile(content: string, filePath: string): ParsedAgentFile {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(
      `convert-agents: ${filePath} is missing YAML frontmatter (expected leading '---' block)`,
    );
  }
  const frontmatter = (() => {
    try {
      return (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`convert-agents: failed to parse frontmatter in ${filePath}: ${reason}`);
    }
  })();
  return { frontmatter, body: match[2] ?? "" };
}

export function validateAgentFrontmatter(
  frontmatter: Record<string, unknown>,
  filePath: string,
): asserts frontmatter is AgentFrontmatter {
  const missing: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = frontmatter[field];
    if (value === undefined || value === null) {
      missing.push(field);
      continue;
    }
    if (field === "tools") {
      if (!Array.isArray(value) || value.length === 0) {
        missing.push("tools (must be a non-empty array)");
      } else if (!value.every((t) => typeof t === "string")) {
        missing.push("tools (all entries must be strings)");
      }
    } else if (typeof value !== "string" || value.trim() === "") {
      missing.push(`${field} (must be a non-empty string)`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `convert-agents: ${filePath} is missing required frontmatter field(s): ${missing.join(", ")}`,
    );
  }
}

export interface OutputFrontmatter {
  name: string;
  description: string;
  model: string;
  effort?: string;
  memory?: string;
  maxTurns?: number;
  tools: string[];
}

/**
 * Build the Claude Code-facing frontmatter.
 *
 * `effort` is emitted only when set, so a spec that wants the model's default
 * thoroughness stays silent about it rather than pinning a value.
 */
export function buildOutputFrontmatter(fm: AgentFrontmatter): OutputFrontmatter {
  const tools = [...fm.tools].sort((a, b) => a.localeCompare(b));
  return {
    name: fm.name,
    description: fm.description,
    model: fm.model,
    ...(fm.effort ? { effort: fm.effort } : {}),
    ...(fm.memory ? { memory: fm.memory } : {}),
    ...(fm.maxTurns !== undefined ? { maxTurns: fm.maxTurns } : {}),
    tools,
  };
}

export { stringifyYaml };
