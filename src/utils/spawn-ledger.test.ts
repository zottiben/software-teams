import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  recordSpawn,
  readLedger,
  summariseLedger,
  clearLedger,
  type SpawnEntry,
} from "./spawn-ledger";

function makeEntry(overrides: Partial<SpawnEntry> = {}): SpawnEntry {
  return {
    timestamp: "2026-04-30T10:00:00.000Z",
    plan_id: "1-01",
    task_id: "1-01-T1",
    agent: "software-teams-architect",
    prompt_bytes: 5389,
    prompt_tokens_approx: Math.ceil(5389 / 4),
    slice_path: ".software-teams/plans/1-01-native-subagents.T1.md",
    spec_sections: ["Acceptance Criteria"],
    tier: "three-tier",
    ...overrides,
  };
}

async function withLedger<T>(fn: (ledgerPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "st-spawn-ledger-test-"));
  const ledgerPath = join(dir, "nested", "deep", "spawn-ledger.jsonl");
  try {
    return await fn(ledgerPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("recordSpawn", () => {
  test("creates parent directory and appends JSONL line", async () => {
    await withLedger(async (ledgerPath) => {
      expect(existsSync(ledgerPath)).toBe(false);
      await recordSpawn(makeEntry(), { ledgerPath });
      expect(existsSync(ledgerPath)).toBe(true);

      const text = await Bun.file(ledgerPath).text();
      expect(text.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(text.trim());
      expect(parsed.task_id).toBe("1-01-T1");
      expect(parsed.agent).toBe("software-teams-architect");
    });
  });

  test("appends multiple entries without overwriting", async () => {
    await withLedger(async (ledgerPath) => {
      await recordSpawn(makeEntry({ task_id: "1-01-T1" }), { ledgerPath });
      await recordSpawn(makeEntry({ task_id: "1-01-T2", agent: "software-teams-backend" }), { ledgerPath });

      const text = await Bun.file(ledgerPath).text();
      const lines = text.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
    });
  });
});

describe("readLedger", () => {
  test("returns empty array when file does not exist", async () => {
    await withLedger(async (ledgerPath) => {
      const entries = await readLedger({ ledgerPath });
      expect(entries).toEqual([]);
    });
  });

  test("round-trips records in append order", async () => {
    await withLedger(async (ledgerPath) => {
      const e1 = makeEntry({ task_id: "1-01-T1" });
      const e2 = makeEntry({ task_id: "1-01-T2", agent: "software-teams-backend", prompt_bytes: 4025 });
      await recordSpawn(e1, { ledgerPath });
      await recordSpawn(e2, { ledgerPath });

      const entries = await readLedger({ ledgerPath });
      expect(entries).toHaveLength(2);
      expect(entries[0]?.task_id).toBe("1-01-T1");
      expect(entries[1]?.task_id).toBe("1-01-T2");
      expect(entries[1]?.agent).toBe("software-teams-backend");
    });
  });

  test("skips malformed lines gracefully", async () => {
    await withLedger(async (ledgerPath) => {
      await recordSpawn(makeEntry(), { ledgerPath });
      const existing = await Bun.file(ledgerPath).text();
      // Append a junk line.
      await Bun.write(ledgerPath, existing + "this is not json\n");

      const entries = await readLedger({ ledgerPath });
      expect(entries).toHaveLength(1);
    });
  });
});

describe("summariseLedger", () => {
  test("aggregates per-agent, per-task, per-plan totals", async () => {
    await withLedger(async (ledgerPath) => {
      await recordSpawn(makeEntry({ task_id: "1-01-T1", agent: "software-teams-architect", prompt_bytes: 5000, prompt_tokens_approx: 1250 }), { ledgerPath });
      await recordSpawn(makeEntry({ task_id: "1-01-T2", agent: "software-teams-backend", prompt_bytes: 4000, prompt_tokens_approx: 1000 }), { ledgerPath });
      await recordSpawn(makeEntry({ task_id: "1-01-T3", agent: "software-teams-backend", prompt_bytes: 3000, prompt_tokens_approx: 750 }), { ledgerPath });
      await recordSpawn(makeEntry({ plan_id: "1-02", task_id: "1-02-T1", agent: "software-teams-architect", prompt_bytes: 2000, prompt_tokens_approx: 500 }), { ledgerPath });

      const summary = await summariseLedger({ ledgerPath });

      expect(summary.total_entries).toBe(4);
      expect(summary.total_bytes).toBe(5000 + 4000 + 3000 + 2000);
      expect(summary.total_tokens_approx).toBe(1250 + 1000 + 750 + 500);

      expect(summary.per_agent["software-teams-architect"]?.entries).toBe(2);
      expect(summary.per_agent["software-teams-architect"]?.bytes).toBe(7000);
      expect(summary.per_agent["software-teams-backend"]?.entries).toBe(2);
      expect(summary.per_agent["software-teams-backend"]?.bytes).toBe(7000);

      expect(summary.per_task["1-01-T1"]?.agent).toBe("software-teams-architect");
      expect(summary.per_task["1-01-T2"]?.bytes).toBe(4000);

      expect(summary.per_plan["1-01"]?.entries).toBe(3);
      expect(summary.per_plan["1-01"]?.bytes).toBe(12000);
      expect(summary.per_plan["1-02"]?.entries).toBe(1);
      expect(summary.per_plan["1-02"]?.bytes).toBe(2000);
    });
  });

  test("filters by planId when provided", async () => {
    await withLedger(async (ledgerPath) => {
      await recordSpawn(makeEntry({ plan_id: "1-01", task_id: "1-01-T1", prompt_bytes: 100, prompt_tokens_approx: 25 }), { ledgerPath });
      await recordSpawn(makeEntry({ plan_id: "1-02", task_id: "1-02-T1", prompt_bytes: 200, prompt_tokens_approx: 50 }), { ledgerPath });

      const filtered = await summariseLedger({ ledgerPath, planId: "1-01" });
      expect(filtered.total_entries).toBe(1);
      expect(filtered.total_bytes).toBe(100);
      expect(filtered.per_plan["1-01"]).toBeDefined();
      expect(filtered.per_plan["1-02"]).toBeUndefined();
    });
  });

  test("handles entries with no plan_id under (unspecified) bucket", async () => {
    await withLedger(async (ledgerPath) => {
      const e = makeEntry();
      delete e.plan_id;
      await recordSpawn(e, { ledgerPath });

      const summary = await summariseLedger({ ledgerPath });
      expect(summary.per_plan["(unspecified)"]?.entries).toBe(1);
    });
  });

  test("returns zeroed summary for empty ledger", async () => {
    await withLedger(async (ledgerPath) => {
      const summary = await summariseLedger({ ledgerPath });
      expect(summary.total_entries).toBe(0);
      expect(summary.total_bytes).toBe(0);
      expect(summary.per_agent).toEqual({});
    });
  });
});

describe("clearLedger", () => {
  test("removes all entries when no planId given", async () => {
    await withLedger(async (ledgerPath) => {
      await recordSpawn(makeEntry({ plan_id: "1-01" }), { ledgerPath });
      await recordSpawn(makeEntry({ plan_id: "1-02", task_id: "1-02-T1" }), { ledgerPath });

      await clearLedger({ ledgerPath });

      const entries = await readLedger({ ledgerPath });
      expect(entries).toHaveLength(0);
    });
  });

  test("removes only matching planId entries when filter provided", async () => {
    await withLedger(async (ledgerPath) => {
      await recordSpawn(makeEntry({ plan_id: "1-01", task_id: "1-01-T1" }), { ledgerPath });
      await recordSpawn(makeEntry({ plan_id: "1-01", task_id: "1-01-T2" }), { ledgerPath });
      await recordSpawn(makeEntry({ plan_id: "1-02", task_id: "1-02-T1" }), { ledgerPath });

      await clearLedger({ ledgerPath, planId: "1-01" });

      const remaining = await readLedger({ ledgerPath });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.plan_id).toBe("1-02");
    });
  });

  test("is a no-op when ledger does not exist", async () => {
    await withLedger(async (ledgerPath) => {
      await clearLedger({ ledgerPath });
      expect(existsSync(ledgerPath)).toBe(false);
    });
  });
});
