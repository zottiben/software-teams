#!/usr/bin/env bun
// Measures per-spawn context cost for a Software Teams three-tier plan.
//
// Preferred path: read .software-teams/persistence/spawn-ledger.jsonl
// (populated by `software-teams spawn-log record` during
// `/st:implement-plan`). This gives real per-spawn byte/token figures.
//
// Fallback path: static byte-count analysis of the plan artefacts. Used
// when no ledger entries exist for the plan (e.g. running this script in
// a fresh checkout, or before the plan has been implemented). The output
// is clearly labelled as static-only in this case.
//
// Usage: bun run scripts/measure-spawn-context.ts [plan-id]
// Default plan: 1-01-native-subagents.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { summariseLedger } from "../src/utils/spawn-ledger";

const BYTES_PER_TOKEN = 4; // standard Claude heuristic
const SPEC_SLICE_RATIO = 0.3; // estimate: agent loads ~30% of index narrative
const LEDGER_PATH = join(".software-teams", "persistence", "spawn-ledger.jsonl");

const planSlug = process.argv[2] ?? "1-01-native-subagents";
// The ledger plan_id is conventionally the leading "N-NN" portion of the slug
// (e.g. "1-01-native-subagents" → "1-01"). Fall back to the full slug if the
// pattern does not match.
const planIdMatch = planSlug.match(/^(\d+-\d+)/);
const planId = planIdMatch ? planIdMatch[1]! : planSlug;

const tok = (b: number) => Math.round(b / BYTES_PER_TOKEN);

async function reportFromLedger(): Promise<boolean> {
  if (!existsSync(LEDGER_PATH)) return false;

  const summary = await summariseLedger({ ledgerPath: LEDGER_PATH, planId });
  if (summary.total_entries === 0) return false;

  console.log(`# Per-spawn context cost — ${planSlug} (from runtime ledger)\n`);
  console.log(`Source: ${LEDGER_PATH} (filtered to plan_id=${planId})`);
  console.log(`Total spawns: ${summary.total_entries}`);
  console.log(`Total bytes:  ${summary.total_bytes} (~${summary.total_tokens_approx} tok)\n`);

  console.log("## Per task\n");
  console.log("| Task | Agent | Tier | Bytes | Tokens |");
  console.log("|------|-------|------|-------|--------|");
  for (const [taskId, entry] of Object.entries(summary.per_task)) {
    console.log(`| ${taskId} | ${entry.agent} | ${entry.tier} | ${entry.bytes} | ${entry.tokens_approx} |`);
  }

  console.log("\n## Per agent\n");
  console.log("| Agent | Spawns | Bytes | Tokens |");
  console.log("|-------|--------|-------|--------|");
  for (const [agent, b] of Object.entries(summary.per_agent)) {
    console.log(`| ${agent} | ${b.entries} | ${b.bytes} | ${b.tokens_approx} |`);
  }
  return true;
}

async function reportStatic(): Promise<void> {
  const dir = ".software-teams/plans";
  const indexPath = join(dir, `${planSlug}.plan.md`);

  const indexText = await readFile(indexPath, "utf8");
  const indexBytes = Buffer.byteLength(indexText, "utf8");
  const narrativeBytes = Buffer.byteLength(
    indexText.split(/^---$/m).slice(2).join("---"),
    "utf8",
  );
  const specSliceBytes = Math.round(narrativeBytes * SPEC_SLICE_RATIO);

  const files = (await readdir(dir))
    .filter((f) => f.startsWith(`${planSlug}.T`) && f.endsWith(".md"))
    .sort((a, b) => {
      const na = Number(a.match(/T(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/T(\d+)/)?.[1] ?? 0);
      return na - nb;
    });

  console.log(`# Per-spawn context cost — ${planSlug} (static analysis)\n`);
  console.log(
    `Note: no ledger data found at ${LEDGER_PATH} for plan ${planId}. ` +
      `Falling back to static byte-count analysis. ` +
      `Run \`software-teams spawn-log record ...\` during /st:implement-plan to capture real numbers.\n`,
  );
  console.log(`Index: ${indexBytes} B (${tok(indexBytes)} tok)`);
  console.log(`Index narrative: ${narrativeBytes} B (${tok(narrativeBytes)} tok)`);
  console.log(`Estimated SPEC slice (30% narrative): ${specSliceBytes} B (${tok(specSliceBytes)} tok)\n`);
  console.log("| Task | Bytes | Single-tier (B) | Three-tier (B) | Ratio |");
  console.log("|------|-------|-----------------|----------------|-------|");

  let sumSingle = 0;
  let sumThree = 0;
  for (const f of files) {
    const text = await readFile(join(dir, f), "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const single = indexBytes + bytes;
    const three = specSliceBytes + bytes;
    sumSingle += single;
    sumThree += three;
    const ratio = (three / single).toFixed(2);
    const id = f.match(/T(\d+)/)?.[1] ?? "?";
    console.log(`| T${id} | ${bytes} | ${single} | ${three} | ${ratio} |`);
  }

  const saving = ((1 - sumThree / sumSingle) * 100).toFixed(1);
  console.log(`\nTotal single-tier: ${sumSingle} B (~${tok(sumSingle)} tok)`);
  console.log(`Total three-tier:  ${sumThree} B (~${tok(sumThree)} tok)`);
  console.log(`Saving: ${saving}%`);
}

const usedLedger = await reportFromLedger();
if (!usedLedger) {
  await reportStatic();
}
