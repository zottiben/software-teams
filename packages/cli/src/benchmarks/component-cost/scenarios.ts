import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { ScenarioResult, ProjectionInputs } from "./types";
import {
  REPO_ROOT,
  CHARS_PER_TOKEN,
  TOOL_CALL_OVERHEAD_TOKENS,
  tokens,
  resolveHostPath,
  parseTags,
  resolveTag,
  estimateNaturalSectionSize,
} from "./utils";
import type { ComponentResolution } from "./types";

export function measureScenarioResolved(name: string, sourceRelPath: string): ScenarioResult {
  const hostPath = resolveHostPath(sourceRelPath);
  const host = readFileSync(hostPath, "utf-8");
  const hostBytes = host.length;
  const hostTokens = tokens(host);

  // No tag resolution in resolved mode — content is already inlined.
  return {
    name,
    hostFile: hostPath.replace(REPO_ROOT + "/", ""),
    hostBytes,
    hostTokens,
    tagCount: 0,
    uniqueTagCount: 0,
    resolutions: [],
    tokensToday: hostTokens,     // agent pays for this file only
    toolCallsToday: 1,
    tokensInlined: hostTokens,   // same — tags already inlined
    toolCallsInlined: 1,
    tokensRuntimeInjected: hostTokens,
    toolCallsRuntimeInjected: 1,
    tokensBestCaseInlined: hostTokens,
    tokensBestCaseRuntime: hostTokens,
    brokenReferences: [],
  };
}

export function measureScenario(name: string, hostFile: string): ScenarioResult {
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

export function projectPerPlan({ spawnsPerPlan, scenario }: ProjectionInputs) {
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

export const SCENARIOS: Array<{ name: string; hostFile: string; spawnsPerPlan: number }> = [
  // Skill — orchestrator loads this once at the start of every implement-plan run.
  { name: "implement-plan skill (orchestrator)", hostFile: "framework/commands/implement-plan.md", spawnsPerPlan: 1 },
  // Skill — orchestrator loads this once per /st:create-plan invocation.
  { name: "create-plan skill (orchestrator)", hostFile: "framework/commands/create-plan.md", spawnsPerPlan: 1 },
  // Agent — heaviest tag user. Spawned ~1x per /st:create-plan.
  { name: "software-teams-planner spawn", hostFile: "framework/agents/software-teams-planner.md", spawnsPerPlan: 1 },
  // Agent — typical implementer. ~7-10 spawns per implement-plan run.
  { name: "software-teams-backend spawn", hostFile: "framework/agents/software-teams-backend.md", spawnsPerPlan: 8 },
  // Agent — verifier. Runs once per code-touching task. ~10 spawns per plan.
  { name: "software-teams-qa-tester spawn", hostFile: "framework/agents/software-teams-qa-tester.md", spawnsPerPlan: 10 },
  // Agent — broken-references demo. Note the dead Architect refs.
  { name: "software-teams-architect spawn (broken refs)", hostFile: "framework/agents/software-teams-architect.md", spawnsPerPlan: 1 },
];
