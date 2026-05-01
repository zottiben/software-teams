import { mkdir } from "fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * One spawn record. Append-only JSONL — each entry occupies a single line.
 * Captured by the orchestrator (main Claude) immediately before each Task
 * spawn so future plans can compare projected vs realised per-spawn context
 * cost (R-06 follow-up). The TS layer only persists; the markdown skill
 * drives the calls.
 */
export type SpawnEntry = {
  timestamp: string; // ISO-8601
  plan_id?: string; // e.g. "1-01"
  task_id: string; // e.g. "1-01-T1"
  agent: string; // e.g. "software-teams-architect"
  prompt_bytes: number; // wc -c equivalent
  prompt_tokens_approx: number; // bytes / 4
  slice_path?: string; // .software-teams/plans/{slug}.T{n}.md
  spec_sections?: string[]; // ["Acceptance Criteria", "Out of Scope"]
  tier: "three-tier" | "single-tier";
};

/** Aggregated view returned by `summariseLedger`. */
export type LedgerSummary = {
  total_entries: number;
  total_bytes: number;
  total_tokens_approx: number;
  per_agent: Record<string, { entries: number; bytes: number; tokens_approx: number }>;
  per_task: Record<string, { agent: string; bytes: number; tokens_approx: number; tier: SpawnEntry["tier"] }>;
  per_plan: Record<string, { entries: number; bytes: number; tokens_approx: number }>;
  entries: SpawnEntry[];
};

const DEFAULT_LEDGER_PATH = join(".software-teams", "persistence", "spawn-ledger.jsonl");

function resolveLedgerPath(opts?: { ledgerPath?: string }): string {
  return opts?.ledgerPath ?? DEFAULT_LEDGER_PATH;
}

/**
 * Append a single spawn record to the JSONL ledger. Creates the parent
 * directory if it does not exist.
 */
export async function recordSpawn(
  entry: SpawnEntry,
  opts?: { ledgerPath?: string },
): Promise<void> {
  const path = resolveLedgerPath(opts);
  await mkdir(dirname(path), { recursive: true });

  const line = JSON.stringify(entry) + "\n";
  const file = Bun.file(path);
  const existing = existsSync(path) ? await file.text() : "";
  await Bun.write(path, existing + line);
}

/**
 * Read the entire ledger and return parsed entries in append order.
 * Missing file returns an empty array (not an error — a fresh project just
 * has no recorded spawns yet).
 */
export async function readLedger(
  opts?: { ledgerPath?: string },
): Promise<SpawnEntry[]> {
  const path = resolveLedgerPath(opts);
  if (!existsSync(path)) return [];

  const text = await Bun.file(path).text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const out: SpawnEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as SpawnEntry);
    } catch {
      // Skip malformed lines silently — the ledger is best-effort
      // diagnostic data, not a primary source of truth.
    }
  }
  return out;
}

/**
 * Aggregate the ledger by agent, task, and plan. Optionally filter to a
 * single plan_id.
 */
export async function summariseLedger(
  opts?: { ledgerPath?: string; planId?: string },
): Promise<LedgerSummary> {
  const all = await readLedger({ ledgerPath: opts?.ledgerPath });
  const entries = opts?.planId ? all.filter((e) => e.plan_id === opts.planId) : all;

  const summary: LedgerSummary = {
    total_entries: entries.length,
    total_bytes: 0,
    total_tokens_approx: 0,
    per_agent: {},
    per_task: {},
    per_plan: {},
    entries,
  };

  for (const e of entries) {
    summary.total_bytes += e.prompt_bytes;
    summary.total_tokens_approx += e.prompt_tokens_approx;

    const agentKey = e.agent;
    const agentBucket = summary.per_agent[agentKey] ?? {
      entries: 0,
      bytes: 0,
      tokens_approx: 0,
    };
    agentBucket.entries += 1;
    agentBucket.bytes += e.prompt_bytes;
    agentBucket.tokens_approx += e.prompt_tokens_approx;
    summary.per_agent[agentKey] = agentBucket;

    summary.per_task[e.task_id] = {
      agent: e.agent,
      bytes: e.prompt_bytes,
      tokens_approx: e.prompt_tokens_approx,
      tier: e.tier,
    };

    const planKey = e.plan_id ?? "(unspecified)";
    const planBucket = summary.per_plan[planKey] ?? {
      entries: 0,
      bytes: 0,
      tokens_approx: 0,
    };
    planBucket.entries += 1;
    planBucket.bytes += e.prompt_bytes;
    planBucket.tokens_approx += e.prompt_tokens_approx;
    summary.per_plan[planKey] = planBucket;
  }

  return summary;
}

/**
 * Wipe the ledger. With `planId`, only entries matching that plan are
 * removed; without it, the file is fully cleared.
 */
export async function clearLedger(
  opts?: { ledgerPath?: string; planId?: string },
): Promise<void> {
  const path = resolveLedgerPath(opts);
  if (!existsSync(path)) return;

  if (!opts?.planId) {
    await Bun.write(path, "");
    return;
  }

  const remaining = (await readLedger({ ledgerPath: path })).filter(
    (e) => e.plan_id !== opts.planId,
  );
  const text = remaining.map((e) => JSON.stringify(e)).join("\n");
  await Bun.write(path, text.length > 0 ? text + "\n" : "");
}
