import { mkdir } from "node:fs/promises";
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
  // ── Lifecycle (registry) fields ──────────────────────────────────────────
  // The ledger doubles as a spawn REGISTRY so the orchestrator can detect and
  // reap stalled/dormant agents. A "spawn" event opens an entry; a later
  // "complete" event for the same task_id closes it. Entries with no event
  // (pre-registry rows) are treated as spawns. Completion events are excluded
  // from cost aggregation (prompt_bytes is 0 on them).
  event?: "spawn" | "complete"; // default "spawn"
  status?: "running" | "done" | "failed" | "stalled";
  deadline_at?: string; // ISO-8601 — running past this without a completion = stale
  ended_at?: string; // ISO-8601 — set on completion
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

/** A spawn that opened but has not yet recorded a completion event. */
export type ActiveSpawn = {
  task_id: string;
  agent: string;
  plan_id?: string;
  spawned_at: string; // ISO-8601 (the spawn event's timestamp)
  deadline_at?: string;
};

/** An active spawn whose deadline (or idle window) has elapsed. */
export type StaleSpawn = ActiveSpawn & { idle_ms: number };

/** Default idle window before an entry with no explicit deadline is stale. */
const DEFAULT_MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes

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
  // Completion events are lifecycle markers, not spawns — never count them.
  const spawns = all.filter((e) => e.event !== "complete");
  const entries = opts?.planId ? spawns.filter((e) => e.plan_id === opts.planId) : spawns;

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

/**
 * Append a completion event for a previously-recorded spawn. This closes the
 * registry entry for `task_id` so it no longer counts as active/stale.
 * Completion events carry zero prompt cost (they are excluded from
 * `summariseLedger`).
 */
export async function recordCompletion(
  opts: {
    task_id: string;
    agent?: string;
    plan_id?: string;
    status?: "done" | "failed";
    timestamp?: string;
  },
  fileOpts?: { ledgerPath?: string },
): Promise<void> {
  const ts = opts.timestamp ?? new Date().toISOString();
  const entry: SpawnEntry = {
    timestamp: ts,
    event: "complete",
    task_id: opts.task_id,
    agent: opts.agent ?? "",
    prompt_bytes: 0,
    prompt_tokens_approx: 0,
    tier: "single-tier",
    status: opts.status ?? "done",
    ended_at: ts,
  };
  if (opts.plan_id) entry.plan_id = opts.plan_id;
  await recordSpawn(entry, fileOpts);
}

/**
 * Fold the event log by `task_id` and return the spawns that opened but never
 * recorded a completion. A re-spawn of the same `task_id` re-opens it (a retry
 * is active again until it too completes).
 */
export async function getActiveSpawns(
  opts?: { ledgerPath?: string; planId?: string },
): Promise<ActiveSpawn[]> {
  const all = await readLedger({ ledgerPath: opts?.ledgerPath });
  const entries = opts?.planId ? all.filter((e) => e.plan_id === opts.planId) : all;

  // task_id → latest open spawn, or null once a completion closes it.
  const open = new Map<string, ActiveSpawn | null>();
  for (const e of entries) {
    if (e.event === "complete") {
      open.set(e.task_id, null);
      continue;
    }
    open.set(e.task_id, {
      task_id: e.task_id,
      agent: e.agent,
      plan_id: e.plan_id,
      spawned_at: e.timestamp,
      deadline_at: e.deadline_at,
    });
  }

  const active: ActiveSpawn[] = [];
  for (const v of open.values()) {
    if (v) active.push(v);
  }
  return active;
}

/**
 * Active spawns whose deadline has passed (or, absent an explicit deadline,
 * that have been idle longer than `maxIdleMs`). These are the dormant agents
 * the orchestrator should `TaskStop`/`shutdown_request` and mark stalled.
 */
export async function findStaleSpawns(
  opts?: { ledgerPath?: string; planId?: string; now?: Date; maxIdleMs?: number },
): Promise<StaleSpawn[]> {
  const active = await getActiveSpawns({ ledgerPath: opts?.ledgerPath, planId: opts?.planId });
  const nowMs = (opts?.now ?? new Date()).getTime();
  const maxIdleMs = opts?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;

  const stale: StaleSpawn[] = [];
  for (const a of active) {
    const spawnedMs = Date.parse(a.spawned_at);
    const idleMs = Number.isFinite(spawnedMs) ? nowMs - spawnedMs : 0;
    const deadlineMs = a.deadline_at ? Date.parse(a.deadline_at) : NaN;
    const overDeadline = Number.isFinite(deadlineMs) && nowMs >= deadlineMs;
    const overIdle = !a.deadline_at && idleMs > maxIdleMs;
    if (overDeadline || overIdle) {
      stale.push({ ...a, idle_ms: idleMs });
    }
  }
  return stale;
}
