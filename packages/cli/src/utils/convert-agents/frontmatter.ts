import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface AgentFrontmatter {
  name: string;
  description: string;
  model: string;
  tools: string[];
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

export function buildOutputFrontmatter(fm: AgentFrontmatter): {
  name: string;
  description: string;
  model: string;
  tools: string[];
} {
  return {
    name: fm.name,
    description: fm.description,
    model: fm.model,
    tools: [...fm.tools].sort((a, b) => a.localeCompare(b)),
  };
}

export { stringifyYaml };
