/**
 * Per-spawn context cost of the Software Teams specialist layer.
 *
 * Measures the artefact the harness actually loads when a specialist is
 * spawned: the rendered `.claude/agents/<name>.md`, produced here by the same
 * `renderAgentOutput` the installer uses, so `@ST:` component tags are expanded
 * exactly as they ship. Reading the canonical `agents/` source directly means
 * this runs from a bare checkout with no `.claude/` install — the defect that
 * made the previous component-cost benchmark unrunnable in CI.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgentFile } from "../../utils/convert-agents/frontmatter";
import { renderAgentOutput } from "../../utils/convert-agents/render";

/** Rough proxy: ~4 characters per token. Bytes are the exact, gated figure. */
export const CHARS_PER_TOKEN = 4;

/**
 * Spawns per typical `implement-plan` run. Weights the aggregate so a saving on
 * a heavily-spawned implementer counts for more than one on a single-spawn role.
 * Unlisted specialists count once.
 */
const SPAWNS_PER_PLAN: Readonly<Record<string, number>> = {
  "software-teams-programmer": 8,
  "software-teams-qa-tester": 10,
  "software-teams-backend": 6,
  "software-teams-frontend": 6,
  "software-teams-planner": 1,
  "software-teams-quality": 2,
};

export interface SpecMeasurement {
  readonly name: string;
  readonly bytes: number;
  readonly tokens: number;
  readonly spawnsPerPlan: number;
}

export interface SpawnCostReport {
  readonly specs: readonly SpecMeasurement[];
  /** Sum across every specialist, one spawn each. */
  readonly totalBytes: number;
  /** Spawn-weighted total for one typical implement-plan run. */
  readonly weightedPlanBytes: number;
  readonly weightedPlanTokens: number;
}

export function agentsDir(packageRoot: string): string {
  return join(packageRoot, "agents");
}

/** Render one spec exactly as `sync-agents` would write it. */
export function renderSpec(packageRoot: string, file: string): string {
  const path = join(agentsDir(packageRoot), file);
  const parsed = parseAgentFile(readFileSync(path, "utf8"), path);
  return renderAgentOutput(parsed, `agents/${file}`);
}

export function measureSpawnCost(packageRoot: string): SpawnCostReport {
  const files = readdirSync(agentsDir(packageRoot))
    .filter((file) => /^software-teams-.+\.md$/.test(file))
    .sort();

  const specs = files.map((file) => {
    const rendered = renderSpec(packageRoot, file);
    const name = file.replace(/\.md$/, "");
    return {
      name,
      bytes: rendered.length,
      tokens: Math.ceil(rendered.length / CHARS_PER_TOKEN),
      spawnsPerPlan: SPAWNS_PER_PLAN[name] ?? 1,
    };
  });

  const totalBytes = specs.reduce((sum, spec) => sum + spec.bytes, 0);
  const weightedPlanBytes = specs.reduce(
    (sum, spec) => sum + spec.bytes * spec.spawnsPerPlan,
    0,
  );

  return {
    specs,
    totalBytes,
    weightedPlanBytes,
    weightedPlanTokens: Math.ceil(weightedPlanBytes / CHARS_PER_TOKEN),
  };
}
