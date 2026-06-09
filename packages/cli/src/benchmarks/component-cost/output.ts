import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioResult } from "./types";
import { REPO_ROOT, CHARS_PER_TOKEN, TOOL_CALL_OVERHEAD_TOKENS } from "./utils";
import { measureScenarioResolved, measureScenario, projectPerPlan, SCENARIOS } from "./scenarios";

// Projected best-case inlined ceiling from the baseline benchmark design doc.
// Used for assertion in --from-resolved mode.
const PROJECTED_CEILING_TOKENS = 42009;
const PROJECTED_CEILING_TOOL_CALLS = 19;

// Default and only supported mode post-3-02.
const MODE: "from-resolved" = "from-resolved";

export function formatTable(rows: string[][]) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  const sep = "─".repeat(widths.reduce((s, w) => s + w + 3, 1));
  const out: string[] = [sep];
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((cell, c) => cell.padEnd(widths[c]));
    out.push("│ " + cells.join(" │ ") + " │");
    if (r === 0) out.push(sep);
  }
  out.push(sep);
  return out.join("\n");
}

export function classifyDelta(deltaPercent: number): "pass" | "soft-fail" | "hard-fail" {
  const abs = Math.abs(deltaPercent);
  if (abs <= 2) return "pass";
  if (abs <= 5) return "soft-fail";
  return "hard-fail";
}

export function main() {
  console.log(`\n=== Component-cost benchmark [mode: ${MODE}] ===\n`);
  console.log(`Repo: ${REPO_ROOT}`);
  console.log(`Constants: CHARS_PER_TOKEN=${CHARS_PER_TOKEN}, TOOL_CALL_OVERHEAD_TOKENS=${TOOL_CALL_OVERHEAD_TOKENS}\n`);

  const scenarios: ScenarioResult[] = [];
  const projections: unknown[] = [];

  const summary: string[][] = [
    ["Scenario", "Tags", "Host", "Today (tokens)", "Tool Calls"],
  ];

  for (const cfg of SCENARIOS) {
    const result =
      MODE === "from-resolved"
        ? measureScenarioResolved(cfg.name, cfg.hostFile)
        : measureScenario(cfg.name, cfg.hostFile);

    scenarios.push(result);
    projections.push(projectPerPlan({ spawnsPerPlan: cfg.spawnsPerPlan, scenario: result }));

    summary.push([
      result.name,
      "0 (inlined)",
      `${result.hostTokens}t`,
      `${result.tokensToday}`,
      `${result.toolCallsToday}`,
    ]);

    if (result.brokenReferences.length > 0) {
      console.log(`  [warn] ${result.name}: broken references found:`);
      for (const ref of result.brokenReferences) console.log(`     ${ref}`);
      console.log();
    }
  }

  console.log(formatTable(summary));
  console.log();

  // Projection: typical implement-plan run = 1 skill load + 8 backend spawns + 10 qa-tester spawns.
  const planScenario = scenarios.find((s) => s.name.startsWith("implement-plan"))!;
  const backendScenario = scenarios.find((s) => s.name.startsWith("software-teams-backend"))!;
  const qaScenario = scenarios.find((s) => s.name.startsWith("software-teams-qa-tester"))!;

  const planTotal = {
    tokens:
      planScenario.tokensToday * 1 +
      backendScenario.tokensToday * 8 +
      qaScenario.tokensToday * 10,
    toolCalls:
      planScenario.toolCallsToday * 1 +
      backendScenario.toolCallsToday * 8 +
      qaScenario.toolCallsToday * 10,
  };

  console.log("Projection — typical implement-plan run (1 skill + 8 backend spawns + 10 qa-tester spawns):");
  console.log(`  Total tokens:     ${planTotal.tokens}`);
  console.log(`  Total tool calls: ${planTotal.toolCalls}`);

  let assertionResult: "pass" | "soft-fail" | "hard-fail" | "n/a" = "n/a";
  let tokenDeltaPct = 0;

  if (MODE === "from-resolved") {
    tokenDeltaPct = ((planTotal.tokens - PROJECTED_CEILING_TOKENS) / PROJECTED_CEILING_TOKENS) * 100;
    const callDelta = planTotal.toolCalls - PROJECTED_CEILING_TOOL_CALLS;
    assertionResult = classifyDelta(tokenDeltaPct);

    console.log();
    console.log("--- Assertion vs projected ceiling ---");
    console.log(`  Ceiling:   ${PROJECTED_CEILING_TOKENS} tokens / ${PROJECTED_CEILING_TOOL_CALLS} tool calls`);
    console.log(`  Actual:    ${planTotal.tokens} tokens / ${planTotal.toolCalls} tool calls`);
    console.log(`  Delta:     ${tokenDeltaPct > 0 ? "+" : ""}${tokenDeltaPct.toFixed(2)}% tokens, ${callDelta > 0 ? "+" : ""}${callDelta} tool calls`);
    console.log(`  Result:    ${assertionResult.toUpperCase()}`);

    if (assertionResult === "pass") {
      console.log("  >> PASS: within ±2% of projected ceiling. R-06 closed.");
    } else if (assertionResult === "soft-fail") {
      console.log("  >> SOFT-FAIL: within ±5% but outside ±2%. Record and flag to head-engineering.");
    } else {
      console.log("  >> HARD-FAIL: outside ±5%. Block T17/T18. Escalate to head-engineering.");
      console.log("     Do NOT adjust projection numbers to fit. Investigate authoring divergence.");
    }
    console.log();
  }

  // Persist — APPEND to JSONL, never overwrite.
  const outDir = join(REPO_ROOT, ".software-teams", "persistence");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "component-bench.jsonl");

  const entry = JSON.stringify({
    ranAt: new Date().toISOString(),
    mode: MODE,
    planTotals: planTotal,
    ...(MODE === "from-resolved"
      ? {
          assertion: {
            projectedCeilingTokens: PROJECTED_CEILING_TOKENS,
            projectedCeilingToolCalls: PROJECTED_CEILING_TOOL_CALLS,
            tokenDeltaPct: parseFloat(tokenDeltaPct.toFixed(2)),
            toolCallDelta: planTotal.toolCalls - PROJECTED_CEILING_TOOL_CALLS,
            result: assertionResult,
          },
        }
      : {}),
    scenarios,
    projections,
  });

  appendFileSync(outFile, entry + "\n");
  console.log(`Appended result → ${outFile}\n`);
}
