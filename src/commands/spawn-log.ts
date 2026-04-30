import { defineCommand } from "citty";
import { consola } from "consola";
import {
  recordSpawn,
  summariseLedger,
  clearLedger,
  type SpawnEntry,
  type LedgerSummary,
} from "../utils/spawn-ledger";

const VALID_TIERS = new Set<SpawnEntry["tier"]>(["three-tier", "single-tier"]);

const recordCmd = defineCommand({
  meta: {
    name: "record",
    description: "Append a spawn entry to .jdi/persistence/spawn-ledger.jsonl",
  },
  args: {
    "task-id": {
      type: "string",
      description: "Task ID (e.g. 1-01-T1)",
      required: true,
    },
    agent: {
      type: "string",
      description: "Agent name (e.g. jdi-architect)",
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
      description: "Path to the per-agent slice (e.g. .jdi/plans/{slug}.T{n}.md)",
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
    "ledger-path": {
      type: "string",
      description: "Override ledger path (default: .jdi/persistence/spawn-ledger.jsonl)",
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

    const entry: SpawnEntry = {
      timestamp: new Date().toISOString(),
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
      `Recorded spawn: ${entry.task_id} (${entry.agent}) — ${bytes} B / ~${tokens} tok`,
    );
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
    description: "Manage the per-spawn token ledger (record, report, clear)",
  },
  subCommands: {
    record: recordCmd,
    report: reportCmd,
    clear: clearCmd,
  },
});
