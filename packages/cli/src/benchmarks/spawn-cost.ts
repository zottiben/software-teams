#!/usr/bin/env bun
/**
 * `bun run bench:spawn-cost` — measure per-spawn specialist context cost.
 *
 * Prints a per-spec table and the spawn-weighted plan total, then writes the
 * tracked baseline when `--write-baseline` is passed. The baseline is committed
 * so CI can assert against it from a fresh checkout; regenerate it in the same
 * commit as any deliberate spec change and the diff shows the delta.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureSpawnCost } from "./spawn-cost/measure";
import { BASELINE_PATH, readBaseline } from "./spawn-cost/baseline";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const report = measureSpawnCost(packageRoot);

const rows = [...report.specs].sort((a, b) => b.bytes - a.bytes);
const nameWidth = Math.max(...rows.map((row) => row.name.length));
console.log("\n=== Per-spawn specialist context cost ===\n");
console.log(`${"spec".padEnd(nameWidth)}  ${"bytes".padStart(7)}  ${"tokens~".padStart(7)}  spawns/plan`);
for (const row of rows) {
  console.log(
    `${row.name.padEnd(nameWidth)}  ${String(row.bytes).padStart(7)}  ${String(row.tokens).padStart(7)}  ${row.spawnsPerPlan}`,
  );
}

console.log(`\nSpecialists:            ${report.specs.length}`);
console.log(`Total bytes (1x each):  ${report.totalBytes}`);
console.log(`Weighted plan bytes:    ${report.weightedPlanBytes}`);
console.log(`Weighted plan tokens~:  ${report.weightedPlanTokens}`);

const baseline = readBaseline();
if (baseline) {
  const delta = report.weightedPlanBytes - baseline.weightedPlanBytes;
  const pct = (delta / baseline.weightedPlanBytes) * 100;
  console.log(
    `\nvs baseline:            ${delta > 0 ? "+" : ""}${delta} bytes (${pct > 0 ? "+" : ""}${pct.toFixed(2)}%)`,
  );
}

if (process.argv.includes("--write-baseline")) {
  const next = {
    measuredAt: new Date().toISOString(),
    specCount: report.specs.length,
    totalBytes: report.totalBytes,
    weightedPlanBytes: report.weightedPlanBytes,
    specs: Object.fromEntries([...report.specs].map((spec) => [spec.name, spec.bytes])),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nBaseline written → ${BASELINE_PATH}`);
}
