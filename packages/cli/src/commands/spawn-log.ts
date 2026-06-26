import { defineCommand } from "citty";
import { consola } from "consola";
import {
  recordSpawn,
  recordCompletion,
  getActiveSpawns,
  findStaleSpawns,
  summariseLedger,
  clearLedger,
  type SpawnEntry,
  type LedgerSummary,
} from "../utils/spawn-ledger";

const VALID_TIERS = new Set<SpawnEntry["tier"]>(["three-tier", "single-tier"]);

const recordCmd = defineCommand({
  meta: {
    name: "record",
    description: "Append a spawn entry to .software-teams/persistence/spawn-ledger.jsonl",
  },
  args: {
    "task-id": {
      type: "string",
      description: "Task ID (e.g. 1-01-T1)",
      required: true,
    },
    agent: {
      type: "string",
      description: "Agent name (e.g. software-teams-architect)",
      required: true,
    },
    bytes: {
      type: "string",
      description: "Prompt size in bytes (wc -c equivalent)",
      required: true,
    },
    tokens: {
      type: "string",
      description: "Approximate token count (default: ceil(bytes / 4))",
    },
    slice: {
      type: "string",
      description: "Path to the per-agent slice (e.g. .software-teams/plans/{slug}.T{n}.md)",
    },
    "spec-sections": {
      type: "string",
      description: "Comma-separated list of cited SPEC section anchors",
    },
    tier: {
      type: "string",
      description: "Plan tier (three-tier | single-tier)",
      default: "three-tier",
    },
    "plan-id": {
      type: "string",
      description: "Plan identifier (e.g. 1-01)",
    },
    "deadline-min": {
      type: "string",
      description: "Minutes until this spawn is considered stale by `reap` (default: 30)",
    },
    "ledger-path": {
      type: "string",
      description: "Override ledger path (default: .software-teams/persistence/spawn-ledger.jsonl)",
    },
  },
  async run({ args }) {
    const bytes = Number(args.bytes);
    if (!Number.isFinite(bytes) || bytes < 0) {
      consola.error(`--bytes must be a non-negative number (got: ${args.bytes})`);
      process.exit(1);
    }

    const tokens = args.tokens != null ? Number(args.tokens) : Math.ceil(bytes / 4);
    if (!Number.isFinite(tokens) || tokens < 0) {
      consola.error(`--tokens must be a non-negative number (got: ${args.tokens})`);
      process.exit(1);
    }

    const tier = args.tier as SpawnEntry["tier"];
    if (!VALID_TIERS.has(tier)) {
      consola.error(`--tier must be one of: ${Array.from(VALID_TIERS).join(", ")} (got: ${args.tier})`);
      process.exit(1);
    }

    const specSections = args["spec-sections"]
      ? args["spec-sections"].split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined;

    const deadlineMin = args["deadline-min"] != null ? Number(args["deadline-min"]) : 30;
    if (!Number.isFinite(deadlineMin) || deadlineMin <= 0) {
      consola.error(`--deadline-min must be a positive number (got: ${args["deadline-min"]})`);
      process.exit(1);
    }

    const now = new Date();
    const entry: SpawnEntry = {
      timestamp: now.toISOString(),
      event: "spawn",
      status: "running",
      deadline_at: new Date(now.getTime() + deadlineMin * 60_000).toISOString(),
      task_id: args["task-id"],
      agent: args.agent,
      prompt_bytes: bytes,
      prompt_tokens_approx: tokens,
      tier,
    };
    if (args["plan-id"]) entry.plan_id = args["plan-id"];
    if (args.slice) entry.slice_path = args.slice;
    if (specSections && specSections.length > 0) entry.spec_sections = specSections;

    await recordSpawn(entry, { ledgerPath: args["ledger-path"] });
    consola.success(
      `Recorded spawn: ${entry.task_id} (${entry.agent}) — ${bytes} B / ~${tokens} tok — deadline +${deadlineMin}m`,
    );
  },
});

const VALID_COMPLETE_STATUS = new Set(["done", "failed"]);

const completeCmd = defineCommand({
  meta: {
    name: "complete",
    description: "Close a spawn's registry entry when its agent returns (done | failed)",
  },
  args: {
    "task-id": {
      type: "string",
      description: "Task ID whose spawn is completing",
      required: true,
    },
    status: {
      type: "string",
      description: "Completion status (done | failed)",
      default: "done",
    },
    agent: {
      type: "string",
      description: "Agent name (optional, for the record)",
    },
    "plan-id": {
      type: "string",
      description: "Plan identifier (optional)",
    },
    "ledger-path": {
      type: "string",
      description: "Override ledger path",
    },
  },
  async run({ args }) {
    const status = args.status as "done" | "failed";
    if (!VALID_COMPLETE_STATUS.has(status)) {
      consola.error(`--status must be one of: done, failed (got: ${args.status})`);
      process.exit(1);
    }
    await recordCompletion(
      {
        task_id: args["task-id"],
        agent: args.agent,
        plan_id: args["plan-id"],
        status,
      },
      { ledgerPath: args["ledger-path"] },
    );
    consola.success(`Closed spawn: ${args["task-id"]} (${status})`);
  },
});

const activeCmd = defineCommand({
  meta: {
    name: "active",
    description: "List spawns that opened but have not recorded a completion",
  },
  args: {
    "plan-id": {
      type: "string",
      description: "Filter by plan_id",
    },
    format: {
      type: "string",
      description: "Output format (text | json)",
      default: "text",
    },
    "ledger-path": {
      type: "string",
      description: "Override ledger path",
    },
  },
  async run({ args }) {
    const active = await getActiveSpawns({
      ledgerPath: args["ledger-path"],
      planId: args["plan-id"],
    });
    if (args.format === "json") {
      console.log(JSON.stringify(active, null, 2));
      return;
    }
    if (active.length === 0) {
      consola.info("No active spawns.");
      return;
    }
    for (const a of active) {
      console.log(
        `${a.task_id}\t${a.agent}\tspawned ${a.spawned_at}\tdeadline ${a.deadline_at ?? "(none)"}`,
      );
    }
  },
});

const reapCmd = defineCommand({
  meta: {
    name: "reap",
    description:
      "List stalled spawns (past deadline or idle window) for the orchestrator to TaskStop and mark stalled",
  },
  args: {
    "max-idle-min": {
      type: "string",
      description: "Idle minutes before a deadline-less spawn is stale (default: 30)",
    },
    "plan-id": {
      type: "string",
      description: "Filter by plan_id",
    },
    format: {
      type: "string",
      description: "Output format (text | json)",
      default: "text",
    },
    "ledger-path": {
      type: "string",
      description: "Override ledger path",
    },
  },
  async run({ args }) {
    const maxIdleMin = args["max-idle-min"] != null ? Number(args["max-idle-min"]) : 30;
    if (!Number.isFinite(maxIdleMin) || maxIdleMin <= 0) {
      consola.error(`--max-idle-min must be a positive number (got: ${args["max-idle-min"]})`);
      process.exit(1);
    }
    const stale = await findStaleSpawns({
      ledgerPath: args["ledger-path"],
      planId: args["plan-id"],
      maxIdleMs: maxIdleMin * 60_000,
    });
    if (args.format === "json") {
      console.log(JSON.stringify(stale, null, 2));
      return;
    }
    if (stale.length === 0) {
      consola.info("No stalled spawns.");
      return;
    }
    consola.warn(`${stale.length} stalled spawn(s) — TaskStop these and mark them stalled:`);
    for (const s of stale) {
      console.log(
        `${s.task_id}\t${s.agent}\tidle ${Math.round(s.idle_ms / 60000)}m\tspawned ${s.spawned_at}`,
      );
    }
  },
});

const VALID_FORMATS = new Set(["json", "markdown"]);

function renderMarkdown(summary: LedgerSummary, planId?: string): string {
  const lines: string[] = [];
  const scope = planId ? `plan ${planId}` : "all plans";
  lines.push(`# Spawn ledger report — ${scope}`);
  lines.push("");
  lines.push(`Total spawns: **${summary.total_entries}**`);
  lines.push(`Total bytes: **${summary.total_bytes}**`);
  lines.push(`Total tokens (approx): **${summary.total_tokens_approx}**`);
  lines.push("");

  if (Object.keys(summary.per_plan).length > 0 && !planId) {
    lines.push("## Per plan");
    lines.push("");
    lines.push("| Plan | Spawns | Bytes | Tokens |");
    lines.push("|------|--------|-------|--------|");
    for (const [plan, b] of Object.entries(summary.per_plan)) {
      lines.push(`| ${plan} | ${b.entries} | ${b.bytes} | ${b.tokens_approx} |`);
    }
    lines.push("");
  }

  if (Object.keys(summary.per_agent).length > 0) {
    lines.push("## Per agent");
    lines.push("");
    lines.push("| Agent | Spawns | Bytes | Tokens |");
    lines.push("|-------|--------|-------|--------|");
    for (const [agent, b] of Object.entries(summary.per_agent)) {
      lines.push(`| ${agent} | ${b.entries} | ${b.bytes} | ${b.tokens_approx} |`);
    }
    lines.push("");
  }

  if (Object.keys(summary.per_task).length > 0) {
    lines.push("## Per task");
    lines.push("");
    lines.push("| Task | Agent | Tier | Bytes | Tokens |");
    lines.push("|------|-------|------|-------|--------|");
    for (const [taskId, b] of Object.entries(summary.per_task)) {
      lines.push(`| ${taskId} | ${b.agent} | ${b.tier} | ${b.bytes} | ${b.tokens_approx} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const reportCmd = defineCommand({
  meta: {
    name: "report",
    description: "Summarise the spawn ledger (per-agent, per-task, per-plan totals)",
  },
  args: {
    "plan-id": {
      type: "string",
      description: "Filter by plan_id",
    },
    format: {
      type: "string",
      description: "Output format (json | markdown)",
      default: "markdown",
    },
    "ledger-path": {
      type: "string",
      description: "Override ledger path",
    },
  },
  async run({ args }) {
    if (!VALID_FORMATS.has(args.format)) {
      consola.error(`--format must be one of: ${Array.from(VALID_FORMATS).join(", ")} (got: ${args.format})`);
      process.exit(1);
    }

    const summary = await summariseLedger({
      ledgerPath: args["ledger-path"],
      planId: args["plan-id"],
    });

    if (summary.total_entries === 0) {
      consola.warn(
        args["plan-id"]
          ? `No ledger entries for plan ${args["plan-id"]}.`
          : "No ledger entries recorded yet.",
      );
      return;
    }

    if (args.format === "json") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(renderMarkdown(summary, args["plan-id"]));
    }
  },
});

const clearCmd = defineCommand({
  meta: {
    name: "clear",
    description: "Wipe the ledger (or filter by --plan-id)",
  },
  args: {
    "plan-id": {
      type: "string",
      description: "Only remove entries for this plan_id",
    },
    "ledger-path": {
      type: "string",
      description: "Override ledger path",
    },
  },
  async run({ args }) {
    await clearLedger({
      ledgerPath: args["ledger-path"],
      planId: args["plan-id"],
    });
    consola.success(
      args["plan-id"]
        ? `Cleared ledger entries for plan ${args["plan-id"]}.`
        : "Cleared ledger.",
    );
  },
});

export const spawnLogCommand = defineCommand({
  meta: {
    name: "spawn-log",
    description:
      "Spawn ledger + lifecycle registry (record, complete, active, reap, report, clear)",
  },
  subCommands: {
    record: recordCmd,
    complete: completeCmd,
    active: activeCmd,
    reap: reapCmd,
    report: reportCmd,
    clear: clearCmd,
  },
});
