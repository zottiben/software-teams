/**
 * Baseline benchmark for the <JDI:X /> component-tag mechanism.
 *
 * Records, for representative spawn scenarios, what the model actually pays for
 * today and what it would pay under each TS-injection alternative. Output is
 * written to `.software-teams/persistence/component-bench.jsonl` so subsequent
 * runs (after the pivot) can be diffed against this baseline.
 *
 * Run via: `bun run src/benchmarks/component-cost.ts`
 */

import { readFileSync, mkdirSync } from "fs";
import { join, basename } from "path";

const REPO_ROOT = process.cwd();

// Approximate tokens-per-char for English Markdown. Anthropic's tokenizer is
// closer to 1 token per ~3.7 chars; rounded conservatively to 4. The exact
// constant doesn't change relative comparisons.
const CHARS_PER_TOKEN = 4;

// Per-tool-call wrapper overhead (request schema + response wrapper). Rough
// estimate; tune later when we measure against real spawns.
const TOOL_CALL_OVERHEAD_TOKENS = 200;

const COMPONENT_DIRS = [
  "framework/components/meta",
  "framework/components/execution",
  "framework/components/planning",
  "framework/components/quality",
];

interface TagRef {
  name: string;
  section?: string;
  raw: string;
}

interface ComponentResolution {
  tag: TagRef;
  filePath: string;
  exists: boolean;
  fullBytes: number;
  sectionBytes: number; // bytes of just the requested section (or full if no section)
}

interface ScenarioResult {
  name: string;
  hostFile: string;
  hostBytes: number;
  hostTokens: number;
  tagCount: number;
  uniqueTagCount: number;
  resolutions: ComponentResolution[];
  // Status quo: today the Read tool returns the entire file regardless of section.
  tokensToday: number;
  toolCallsToday: number;
  // B3 sync-time inlining: only requested sections, baked into host at sync time.
  // Zero tool calls (host already contains resolved sections).
  tokensInlined: number;
  toolCallsInlined: number;
  // B1/B2 runtime injection: only requested sections, fetched per call.
  tokensRuntimeInjected: number;
  toolCallsRuntimeInjected: number;
  // Best-case projection: assume tags without an explicit section could be
  // re-authored to target the natural average section of their component
  // (parsed from `## Heading` boundaries).
  tokensBestCaseInlined: number;
  tokensBestCaseRuntime: number;
  brokenReferences: string[]; // tags pointing at files/sections that don't exist
}

function tokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

function findComponentFile(name: string): string | null {
  for (const dir of COMPONENT_DIRS) {
    const candidate = join(REPO_ROOT, dir, `${name}.md`);
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      // Not in this dir, try the next.
    }
  }
  return null;
}

function parseTags(host: string): TagRef[] {
  // Match `<JDI:Name />`, `<JDI:Name:Section />`, `<JDI:Name attr="x" />`,
  // `<JDI:Name:Section attr="x" />`. Anything between the name(:section) and
  // the closing `/>` is treated as attributes and discarded for now.
  const re = /<JDI:([A-Za-z]+)(?::([A-Za-z][A-Za-z0-9-]*))?(\s+[^>]*?)?\s*\/?\s*>/g;
  const tags: TagRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(host)) !== null) {
    tags.push({
      name: match[1],
      section: match[2],
      raw: match[0],
    });
  }
  return tags;
}

/**
 * Extract the bytes of a named section from a component file. Two strategies:
 *
 * 1. Explicit `<section name="X">...</section>` block (used by AgentBase).
 * 2. Markdown heading boundary — `## X` until the next `## ` or EOF.
 *
 * If the section is not found, returns null (caller decides whether to count
 * the full file or flag a broken ref).
 */
function extractSection(content: string, sectionName: string): string | null {
  // Strategy 1 — explicit HTML section block, case-insensitive name match.
  const htmlRe = new RegExp(
    `<section\\s+name="${sectionName}"[^>]*>([\\s\\S]*?)</section>`,
    "i",
  );
  const htmlMatch = content.match(htmlRe);
  if (htmlMatch) return htmlMatch[1].trim();

  // Strategy 2 — Markdown heading boundary (## or ###). Section name is a
  // case-insensitive substring of the heading text.
  const lines = content.split("\n");
  let startIdx = -1;
  let startDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
    if (!headingMatch) continue;
    const depth = headingMatch[1].length;
    const text = headingMatch[2].toLowerCase();
    if (text.includes(sectionName.toLowerCase())) {
      startIdx = i;
      startDepth = depth;
      break;
    }
  }
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{2,6})\s+/);
    if (headingMatch && headingMatch[1].length <= startDepth) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

/**
 * Estimate the natural average section size of a component file by splitting on
 * `## Heading` boundaries (depth 2). Returns bytes-per-section averaged across
 * sections; falls back to full file size if no headings are present.
 */
function estimateNaturalSectionSize(content: string): number {
  const lines = content.split("\n");
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) boundaries.push(i);
  }
  if (boundaries.length === 0) return content.length;
  boundaries.push(lines.length);
  let totalSectionBytes = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const slice = lines.slice(boundaries[i], boundaries[i + 1]).join("\n");
    totalSectionBytes += slice.length;
  }
  return Math.ceil(totalSectionBytes / (boundaries.length - 1));
}

function resolveTag(tag: TagRef): ComponentResolution {
  const filePath = findComponentFile(tag.name);
  if (!filePath) {
    return {
      tag,
      filePath: `<missing>:${tag.name}`,
      exists: false,
      fullBytes: 0,
      sectionBytes: 0,
    };
  }

  const content = readFileSync(filePath, "utf-8");
  const fullBytes = content.length;

  let sectionBytes = fullBytes;
  if (tag.section) {
    const section = extractSection(content, tag.section);
    sectionBytes = section ? section.length : 0; // 0 = section not found (broken ref)
  }

  return {
    tag,
    filePath,
    exists: true,
    fullBytes,
    sectionBytes,
  };
}

function measureScenario(name: string, hostFile: string): ScenarioResult {
  const hostPath = join(REPO_ROOT, hostFile);
  const host = readFileSync(hostPath, "utf-8");
  const hostBytes = host.length;
  const hostTokens = tokens(host);

  const tags = parseTags(host);
  const uniqueTagKeys = new Set(tags.map((t) => `${t.name}:${t.section ?? ""}`));

  const resolutions = tags.map(resolveTag);
  const brokenReferences: string[] = [];
  for (const r of resolutions) {
    if (!r.exists) {
      brokenReferences.push(`${r.tag.raw} → component file not found`);
      continue;
    }
    if (r.tag.section && r.sectionBytes === 0) {
      brokenReferences.push(`${r.tag.raw} → section "${r.tag.section}" not found in ${basename(r.filePath)}`);
    }
  }

  // Status quo cost: host + each tag triggers Read of the full file.
  const tokensTodayProper =
    hostTokens +
    resolutions
      .filter((r) => r.exists)
      .reduce((sum, r) => sum + Math.ceil(r.fullBytes / CHARS_PER_TOKEN), 0);
  const toolCallsToday = 1 + resolutions.filter((r) => r.exists).length;

  // B3 — sync-time inlined sections, no tool calls beyond host load.
  const tokensInlined =
    hostTokens +
    resolutions
      .filter((r) => r.exists && r.sectionBytes > 0)
      .reduce((sum, r) => sum + Math.ceil(r.sectionBytes / CHARS_PER_TOKEN), 0);
  const toolCallsInlined = 1;

  // B1/B2 — runtime injection, one call per tag, only section content + overhead.
  const validResolutions = resolutions.filter((r) => r.exists && r.sectionBytes > 0);
  const tokensRuntimeInjected =
    hostTokens +
    validResolutions.reduce(
      (sum, r) => sum + Math.ceil(r.sectionBytes / CHARS_PER_TOKEN) + TOOL_CALL_OVERHEAD_TOKENS,
      0,
    );
  const toolCallsRuntimeInjected = 1 + validResolutions.length;

  // Best-case projection: every tag without an explicit section could be
  // re-authored to target the natural average section of its component.
  const bestCaseSectionBytes = (r: ComponentResolution) => {
    if (!r.exists) return 0;
    if (r.tag.section) return r.sectionBytes; // explicit section already
    const fileContent = readFileSync(r.filePath, "utf-8");
    return estimateNaturalSectionSize(fileContent);
  };
  const tokensBestCaseInlined =
    hostTokens +
    resolutions
      .filter((r) => r.exists)
      .reduce((sum, r) => sum + Math.ceil(bestCaseSectionBytes(r) / CHARS_PER_TOKEN), 0);
  const tokensBestCaseRuntime =
    hostTokens +
    resolutions
      .filter((r) => r.exists)
      .reduce(
        (sum, r) =>
          sum + Math.ceil(bestCaseSectionBytes(r) / CHARS_PER_TOKEN) + TOOL_CALL_OVERHEAD_TOKENS,
        0,
      );

  return {
    name,
    hostFile,
    hostBytes,
    hostTokens,
    tagCount: tags.length,
    uniqueTagCount: uniqueTagKeys.size,
    resolutions,
    tokensToday: tokensTodayProper,
    toolCallsToday,
    tokensInlined,
    toolCallsInlined,
    tokensRuntimeInjected,
    toolCallsRuntimeInjected,
    tokensBestCaseInlined,
    tokensBestCaseRuntime,
    brokenReferences,
  };
}

interface ProjectionInputs {
  spawnsPerPlan: number;
  scenario: ScenarioResult;
}

function projectPerPlan({ spawnsPerPlan, scenario }: ProjectionInputs) {
  return {
    scenario: scenario.name,
    spawnsPerPlan,
    today: {
      tokens: scenario.tokensToday * spawnsPerPlan,
      toolCalls: scenario.toolCallsToday * spawnsPerPlan,
    },
    inlined: {
      tokens: scenario.tokensInlined * spawnsPerPlan,
      toolCalls: scenario.toolCallsInlined * spawnsPerPlan,
    },
    runtimeInjected: {
      tokens: scenario.tokensRuntimeInjected * spawnsPerPlan,
      toolCalls: scenario.toolCallsRuntimeInjected * spawnsPerPlan,
    },
  };
}

const SCENARIOS: Array<{ name: string; hostFile: string; spawnsPerPlan: number }> = [
  // Skill — orchestrator loads this once at the start of every implement-plan run.
  { name: "implement-plan skill (orchestrator)", hostFile: "framework/commands/implement-plan.md", spawnsPerPlan: 1 },
  // Skill — orchestrator loads this once per /st:create-plan invocation.
  { name: "create-plan skill (orchestrator)", hostFile: "framework/commands/create-plan.md", spawnsPerPlan: 1 },
  // Agent — heaviest tag user. Spawned ~1× per /st:create-plan.
  { name: "software-teams-planner spawn", hostFile: "framework/agents/software-teams-planner.md", spawnsPerPlan: 1 },
  // Agent — typical implementer. ~7-10 spawns per implement-plan run.
  { name: "software-teams-backend spawn", hostFile: "framework/agents/software-teams-backend.md", spawnsPerPlan: 8 },
  // Agent — verifier. Runs once per code-touching task. ~10 spawns per plan.
  { name: "software-teams-qa-tester spawn", hostFile: "framework/agents/software-teams-qa-tester.md", spawnsPerPlan: 10 },
  // Agent — broken-references demo. Note the dead <JDI:Architect:*/> refs.
  { name: "software-teams-architect spawn (broken refs)", hostFile: "framework/agents/software-teams-architect.md", spawnsPerPlan: 1 },
];

function formatTable(rows: string[][]) {
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

function pct(after: number, before: number): string {
  if (before === 0) return "—";
  const delta = ((after - before) / before) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function main() {
  const out: { ranAt: string; scenarios: ScenarioResult[]; projections: unknown[] } = {
    ranAt: new Date().toISOString(),
    scenarios: [],
    projections: [],
  };

  console.log("\n=== Component-cost baseline benchmark ===\n");
  console.log(`Repo: ${REPO_ROOT}`);
  console.log(`Constants: CHARS_PER_TOKEN=${CHARS_PER_TOKEN}, TOOL_CALL_OVERHEAD_TOKENS=${TOOL_CALL_OVERHEAD_TOKENS}\n`);

  const summary: string[][] = [
    ["Scenario", "Tags", "Host", "Today", "Inlined", "Runtime", "BestInline", "BestRuntime"],
  ];

  for (const cfg of SCENARIOS) {
    const result = measureScenario(cfg.name, cfg.hostFile);
    out.scenarios.push(result);
    out.projections.push(projectPerPlan({ spawnsPerPlan: cfg.spawnsPerPlan, scenario: result }));

    summary.push([
      result.name,
      `${result.tagCount}`,
      `${result.hostTokens}t`,
      `${result.tokensToday}`,
      `${result.tokensInlined} (${pct(result.tokensInlined, result.tokensToday)})`,
      `${result.tokensRuntimeInjected} (${pct(result.tokensRuntimeInjected, result.tokensToday)})`,
      `${result.tokensBestCaseInlined} (${pct(result.tokensBestCaseInlined, result.tokensToday)})`,
      `${result.tokensBestCaseRuntime} (${pct(result.tokensBestCaseRuntime, result.tokensToday)})`,
    ]);

    if (result.brokenReferences.length > 0) {
      console.log(`⚠  ${result.name}: broken references found:`);
      for (const ref of result.brokenReferences) console.log(`     ${ref}`);
      console.log();
    }
  }

  console.log("Per-scenario cost (single invocation):");
  console.log("  Today        = whole component file loaded per tag (status quo)");
  console.log("  Inlined      = sync-time inline of explicit sections (B3)");
  console.log("  Runtime      = runtime injection of explicit sections (B1/B2)");
  console.log("  BestInline   = sync-time inline if every tag were section-specific (natural avg)");
  console.log("  BestRuntime  = runtime injection if every tag were section-specific (natural avg)");
  console.log();
  console.log(formatTable(summary));
  console.log();

  // Projection: a typical implement-plan run = 1 orchestrator load + 8 backend spawns + 10 qa-tester spawns.
  const planScenario = out.scenarios.find((s) => s.name.startsWith("implement-plan"))!;
  const backendScenario = out.scenarios.find((s) => s.name.startsWith("software-teams-backend"))!;
  const qaScenario = out.scenarios.find((s) => s.name.startsWith("software-teams-qa-tester"))!;

  const totals = {
    today:
      planScenario.tokensToday * 1 +
      backendScenario.tokensToday * 8 +
      qaScenario.tokensToday * 10,
    inlined:
      planScenario.tokensInlined * 1 +
      backendScenario.tokensInlined * 8 +
      qaScenario.tokensInlined * 10,
    runtimeInjected:
      planScenario.tokensRuntimeInjected * 1 +
      backendScenario.tokensRuntimeInjected * 8 +
      qaScenario.tokensRuntimeInjected * 10,
    todayCalls:
      planScenario.toolCallsToday * 1 +
      backendScenario.toolCallsToday * 8 +
      qaScenario.toolCallsToday * 10,
    inlinedCalls:
      planScenario.toolCallsInlined * 1 +
      backendScenario.toolCallsInlined * 8 +
      qaScenario.toolCallsInlined * 10,
    runtimeCalls:
      planScenario.toolCallsRuntimeInjected * 1 +
      backendScenario.toolCallsRuntimeInjected * 8 +
      qaScenario.toolCallsRuntimeInjected * 10,
  };

  const bestInlineTotal =
    planScenario.tokensBestCaseInlined * 1 +
    backendScenario.tokensBestCaseInlined * 8 +
    qaScenario.tokensBestCaseInlined * 10;
  const bestRuntimeTotal =
    planScenario.tokensBestCaseRuntime * 1 +
    backendScenario.tokensBestCaseRuntime * 8 +
    qaScenario.tokensBestCaseRuntime * 10;

  console.log("Projection — typical implement-plan run (1 skill load + 8 backend spawns + 10 qa-tester spawns):");
  console.log(`  Today:                       ${totals.today} tokens, ${totals.todayCalls} component-related tool calls`);
  console.log(`  Inlined explicit-only (B3):  ${totals.inlined} tokens (${pct(totals.inlined, totals.today)}), ${totals.inlinedCalls} tool calls`);
  console.log(`  Runtime explicit-only:       ${totals.runtimeInjected} tokens (${pct(totals.runtimeInjected, totals.today)}), ${totals.runtimeCalls} tool calls`);
  console.log(`  Best-case inlined:           ${bestInlineTotal} tokens (${pct(bestInlineTotal, totals.today)}), ${totals.inlinedCalls} tool calls`);
  console.log(`  Best-case runtime:           ${bestRuntimeTotal} tokens (${pct(bestRuntimeTotal, totals.today)}), ${totals.runtimeCalls} tool calls`);
  console.log();

  // Persist to spawn-ledger-style jsonl so future runs are diffable.
  const outDir = join(REPO_ROOT, ".software-teams", "persistence");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "component-bench.jsonl");
  Bun.write(
    outFile,
    Object.entries(out)
      .map(([k, v]) => JSON.stringify({ key: k, value: v }))
      .join("\n") + "\n",
  );
  console.log(`Recorded full result → ${outFile}\n`);
}

main();
