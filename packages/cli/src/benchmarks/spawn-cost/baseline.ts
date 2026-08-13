import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tracked baseline. Committed deliberately: the previous benchmark keyed its
 * gate off a gitignored JSONL, so the assertion silently skipped on every CI
 * run. A tracked file makes the gate real and puts the delta in the diff.
 */
export const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "spawn-cost-baseline.json",
);

export interface SpawnCostBaseline {
  readonly measuredAt: string;
  readonly specCount: number;
  readonly totalBytes: number;
  readonly weightedPlanBytes: number;
  readonly specs: Readonly<Record<string, number>>;
}

export function readBaseline(): SpawnCostBaseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as SpawnCostBaseline;
}
