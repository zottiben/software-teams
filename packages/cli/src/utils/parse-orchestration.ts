import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export interface OrchestrationTask {
  taskId: string;
  name: string;
  agent: string;
  wave: number;
  dependsOn: string[];
  slice: string;
}

export interface ParsedOrchestration {
  planId: string;
  slug: string;
  tier: string;
  specLink?: string;
  tasks: OrchestrationTask[];
  frontmatter: Record<string, unknown>;
}

/**
 * Parse an orchestration.md file: YAML frontmatter + the `## Tasks` markdown table.
 * Throws on missing required frontmatter (`plan_id`, `slug`, `tier`) or a malformed
 * table (header missing required columns).
 */
export async function parseOrchestration(filePath: string): Promise<ParsedOrchestration> {
  const content = await readFile(filePath, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) throw new Error(`No frontmatter in ${filePath}`);
  const fm = (parseYaml(fmMatch[1]) ?? {}) as Record<string, unknown>;
  for (const key of ["plan_id", "slug", "tier"] as const) {
    if (typeof fm[key] !== "string" || !(fm[key] as string).length) {
      throw new Error(`Missing required frontmatter '${key}' in ${filePath}`);
    }
  }

  const body = fmMatch[2] ?? "";
  // Locate the "## Tasks" section and pick the first markdown table inside it.
  const tasksHeader = body.match(/^##\s+Tasks\s*$/m);
  const tasks: OrchestrationTask[] = [];
  if (tasksHeader) {
    const after = body.slice((tasksHeader.index ?? 0) + tasksHeader[0].length);
    // Stop at the next "## " heading.
    const nextHeader = after.search(/^##\s+/m);
    const section = nextHeader >= 0 ? after.slice(0, nextHeader) : after;
    const lines = section.split("\n").filter((l) => /^\s*\|/.test(l));
    if (lines.length > 0) {
      const header = lines[0]!.split("|").map((c) => c.trim().toLowerCase()).filter(Boolean);
      const required = ["id", "name", "agent", "wave", "depends on", "slice"];
      for (const col of required) {
        if (!header.includes(col)) {
          throw new Error(`Malformed Tasks table in ${filePath}: missing column '${col}'`);
        }
      }
      // Skip header (line 0) and separator (line 1: |---|---|...).
      for (const line of lines.slice(2)) {
        const cells = line.split("|").map((c) => c.trim());
        // First and last entries are empty (leading/trailing pipes).
        const trimmed = cells[0] === "" ? cells.slice(1) : cells;
        const row = trimmed[trimmed.length - 1] === "" ? trimmed.slice(0, -1) : trimmed;
        if (row.length < required.length) continue;
        const [id, name, agent, waveStr, depsStr, sliceCell] = row;
        const dependsOn = (depsStr ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s !== "—" && s !== "-");
        const slice = (sliceCell ?? "").replace(/^`|`$/g, "").trim();
        tasks.push({
          taskId: id ?? "",
          name: name ?? "",
          agent: agent ?? "",
          wave: Number.parseInt(waveStr ?? "0", 10) || 0,
          dependsOn,
          slice,
        });
      }
    }
  }

  return {
    planId: fm.plan_id as string,
    slug: fm.slug as string,
    tier: fm.tier as string,
    specLink: fm.spec_link as string | undefined,
    tasks,
    frontmatter: fm,
  };
}
