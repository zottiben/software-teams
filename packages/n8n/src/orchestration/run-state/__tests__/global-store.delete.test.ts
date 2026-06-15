/**
 * global-store deleteRunState unit tests (T1 — AC5, R-04).
 *
 * Verifies that:
 * - deleteRunState removes an existing keyed entry from the runs store
 * - Leaves other entries intact
 * - Returns false (not throws) when the key is absent (idempotent)
 * - The function is exported from the run-state barrel
 */

import { describe, test, expect } from "bun:test";
import { deleteRunState, getRunStore } from "../global-store";

describe("deleteRunState (T1 — AC5, R-04)", () => {
  test("removes an existing keyed entry from the runs store", () => {
    const staticData: Record<string, unknown> = {
      runs: {
        "run-alpha": { plan: "plan-data-1" },
        "run-beta": { plan: "plan-data-2" },
      },
    };

    const result = deleteRunState(staticData, "run-alpha");

    expect(result).toBe(true);
    const runs = getRunStore(staticData);
    expect(runs).not.toHaveProperty("run-alpha");
    expect(runs).toHaveProperty("run-beta");
    expect(runs["run-beta"]).toEqual({ plan: "plan-data-2" });
  });

  test("leaves other keys intact when deleting one", () => {
    const staticData: Record<string, unknown> = {
      runs: {
        "run-1": "data1",
        "run-2": "data2",
        "run-3": "data3",
      },
    };

    deleteRunState(staticData, "run-2");

    const runs = getRunStore(staticData);
    expect(Object.keys(runs).sort()).toEqual(["run-1", "run-3"]);
    expect(runs["run-1"]).toBe("data1");
    expect(runs["run-3"]).toBe("data3");
  });

  test("returns false and does not throw when the key is absent (idempotent)", () => {
    const staticData: Record<string, unknown> = { runs: {} };

    const result = deleteRunState(staticData, "nonexistent-run");

    expect(result).toBe(false);
    expect(getRunStore(staticData)).toEqual({});
  });

  test("second call on the same key is a clean no-op (idempotent — R-04)", () => {
    const staticData: Record<string, unknown> = {
      runs: { "run-idem": { data: "value" } },
    };

    const firstResult = deleteRunState(staticData, "run-idem");
    expect(firstResult).toBe(true);

    const secondResult = deleteRunState(staticData, "run-idem");
    expect(secondResult).toBe(false);

    const runs = getRunStore(staticData);
    expect(runs).toEqual({});
  });

  test("safe to call on a fresh store (no runs key yet)", () => {
    const staticData: Record<string, unknown> = {};

    const result = deleteRunState(staticData, "run-fresh");

    expect(result).toBe(false);
    // The function calls getRunStore, which creates the key if absent
    expect(staticData).toHaveProperty("runs");
    expect(getRunStore(staticData)).toEqual({});
  });

  test("deletes each element independently without affecting others", () => {
    const staticData: Record<string, unknown> = {
      runs: {
        "run-a": "a",
        "run-b": "b",
        "run-c": "c",
        "run-d": "d",
      },
    };

    deleteRunState(staticData, "run-b");
    deleteRunState(staticData, "run-d");

    const runs = getRunStore(staticData);
    expect(Object.keys(runs).sort()).toEqual(["run-a", "run-c"]);
    expect(runs["run-a"]).toBe("a");
    expect(runs["run-c"]).toBe("c");
  });
});

describe("deleteRunState — exported from run-state barrel", () => {
  test("is exported from packages/n8n/src/orchestration/run-state.ts", async () => {
    const runStateModule = await import("../../run-state");
    expect(typeof runStateModule.deleteRunState).toBe("function");
  });
});
