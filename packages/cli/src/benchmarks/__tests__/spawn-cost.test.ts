import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { measureSpawnCost } from "../spawn-cost/measure";
import { readBaseline } from "../spawn-cost/baseline";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Drift tolerance. Tight enough that an accidental re-bloat fails, loose enough
 * that a one-line wording fix does not. A deliberate change regenerates the
 * baseline (`bun run bench:spawn-cost --write-baseline`) in the same commit.
 */
const TOLERANCE_PERCENT = 2;

describe("per-spawn specialist context cost", () => {
  test("measures every shipped specialist from the canonical source", () => {
    const report = measureSpawnCost(PACKAGE_ROOT);
    expect(report.specs.length).toBe(34);
    expect(report.weightedPlanBytes).toBeGreaterThan(0);
    for (const spec of report.specs) {
      expect(spec.bytes, spec.name).toBeGreaterThan(0);
    }
  });

  // The predecessor keyed this gate off a gitignored JSONL, so it skipped on
  // every CI run while appearing to pass. The baseline is tracked precisely so
  // this assertion runs from a fresh checkout.
  test("tracked baseline exists and is committed", () => {
    expect(readBaseline()).not.toBeNull();
  });

  test("weighted plan cost stays within tolerance of the tracked baseline", () => {
    const baseline = readBaseline();
    if (!baseline) throw new Error("spawn-cost-baseline.json missing");

    const report = measureSpawnCost(PACKAGE_ROOT);
    const deltaPercent =
      ((report.weightedPlanBytes - baseline.weightedPlanBytes) / baseline.weightedPlanBytes) * 100;

    expect(
      Math.abs(deltaPercent),
      `weighted plan cost moved ${deltaPercent.toFixed(2)}% (${baseline.weightedPlanBytes} → ${report.weightedPlanBytes} bytes). ` +
        "If deliberate, run `bun run bench:spawn-cost --write-baseline` and commit the baseline.",
    ).toBeLessThanOrEqual(TOLERANCE_PERCENT);
  });

  test("baseline covers the same specialist set that ships", () => {
    const baseline = readBaseline();
    if (!baseline) throw new Error("spawn-cost-baseline.json missing");
    const shipped = measureSpawnCost(PACKAGE_ROOT).specs.map((spec) => spec.name).sort();
    expect(Object.keys(baseline.specs).sort()).toEqual(shipped);
  });
});
