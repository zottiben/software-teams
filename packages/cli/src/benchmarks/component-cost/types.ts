export interface TagRef {
  name: string;
  section?: string;
  raw: string;
}

export interface ComponentResolution {
  tag: TagRef;
  filePath: string;
  exists: boolean;
  fullBytes: number;
  sectionBytes: number; // bytes of just the requested section (or full if no section)
}

export interface ScenarioResult {
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

export interface ProjectionInputs {
  spawnsPerPlan: number;
  scenario: ScenarioResult;
}
