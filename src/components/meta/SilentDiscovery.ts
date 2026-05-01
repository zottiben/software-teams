/**
 * SilentDiscovery component module.
 *
 * Parsing rules applied:
 * - `## Heading` boundaries delimit sections (no YAML frontmatter).
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 */

import type { Component } from "../types";

const SilentDiscovery: Component = {
  name: "SilentDiscovery",
  category: "meta",
  description:
    "The mandatory state-reading preamble that runs before any user-facing prompt in a Software Teams skill",
  sections: {
    WhatToRead: {
      name: "WhatToRead",
      description: "Files to read and how to handle missing ones",
      body: `Read these files if they exist. If a file is missing, record that in \`DISCOVERED_STATE\` as \`missing: true\` and continue — do not error.

| File | Purpose |
|------|---------|
| \`.software-teams/config/state.yaml\` | Current phase, plan, task, and status. Source of truth for "where are we?" |
| \`.software-teams/project.yaml\` | Tech stack, project name, team configuration |
| \`.software-teams/requirements.yaml\` | Risks, constraints, non-functional requirements |
| \`.software-teams/roadmap.yaml\` | Phase structure, upcoming plans, milestones |
| \`.software-teams/plans/*.plan.md\` (glob) | Existing plan index files — check frontmatter for \`provides\`, \`status\`, completion |
| \`.software-teams/codebase/summary.md\` | Codebase index, if present |
| Test suite files (glob: \`**/*.test.*\`, \`**/*.spec.*\`, \`**/__tests__/**\`) | Detect existing test framework and patterns |
| Test config files (\`vitest.config.*\`, \`jest.config.*\`, \`playwright.config.*\`, \`cypress.config.*\`) | Identify test runner |
| \`package.json\` \`scripts.test\` field | Identify test command |

> **Test file exclusions:** When globbing for test files, skip \`node_modules/\`, \`vendor/\`, \`.git/\`, \`dist/\`, \`build/\`.

Additionally, if the skill is worktree-aware, read:

| File | Purpose |
|------|---------|
| \`.software-teams/config/state.yaml → worktree\` | Active worktree path and status |`,
    },
    WhatToDerive: {
      name: "WhatToDerive",
      description: "Derived fields to compute and store in DISCOVERED_STATE",
      body: `From the raw reads above, compute and store these derived fields in \`DISCOVERED_STATE\`:

- **\`active_phase\`** — current phase number and name (from roadmap.yaml + state.yaml position)
- **\`next_plan_number\`** — next available plan id in the active phase (scan existing plan files)
- **\`tech_stack\`** — from project.yaml
- **\`open_risks\`** — from requirements.yaml \`risks:\` block (empty list if none)
- **\`prior_provides\`** — union of all \`provides:\` fields from completed plans (cross-phase dependency map)
- **\`returning_user\`** — true if any prior plans are completed or the current plan is in a non-initial status
- **\`missing_scaffolding\`** — list of scaffolding files that didn't exist
- **\`test_suite\`** — object describing the project's test infrastructure:
  - \`detected: boolean\` — true if any test files or test config found
  - \`framework: string\` — detected runner (\`bun:test\`, \`vitest\`, \`jest\`, \`playwright\`, \`cypress\`, etc.)
  - \`test_command: string\` — from \`package.json\` \`scripts.test\` or inferred from config
  - \`test_patterns: string[]\` — glob patterns where tests live (e.g. \`["src/**/*.test.ts", "__tests__/**"]\`)
  - \`test_file_count: number\` — count of matched test files
  - \`has_e2e: boolean\` — true if \`playwright.config.*\` or \`cypress.config.*\` found
  - \`has_integration: boolean\` — true if \`__tests__/integration\` or similar directories exist
  - If no test files or config found, set \`detected: false\` and leave other fields empty.`,
    },
    TestSuiteDetection: {
      name: "TestSuiteDetection",
      description: "Priority-order heuristic for detecting the test framework",
      body: `When deriving \`test_suite\`, apply detection in this priority order (first match wins for \`framework\`):

1. **Explicit config file** — \`vitest.config.*\` → vitest, \`jest.config.*\` → jest, \`playwright.config.*\` → playwright, \`cypress.config.*\` → cypress. If multiple configs exist, record the unit-test runner as \`framework\` and set \`has_e2e\` accordingly.
2. **\`package.json\` scripts** — inspect \`scripts.test\` for runner keywords (\`bun test\` → bun:test, \`vitest\` → vitest, \`jest\` → jest). Also sets \`test_command\`.
3. **Glob pattern matching** — if no config or script found, glob for \`**/*.test.*\` and \`**/*.spec.*\` (excluding \`node_modules/\`, \`vendor/\`, \`.git/\`, \`dist/\`, \`build/\`). If matches exist, set \`detected: true\` and infer framework from file contents or import statements if feasible; otherwise leave \`framework\` as \`"unknown"\`.

If none of the above yields results, set \`detected: false\`.`,
    },
    DisciplineRules: {
      name: "DisciplineRules",
      description: "Non-negotiable rules for SilentDiscovery usage",
      body: `These rules are non-negotiable when this component is referenced:

1. **Silent by default.** Never print \`DISCOVERED_STATE\` as a conversation opener. It informs your recommendations; it is not the first thing the user sees.

2. **Never re-ask what's already known.** If a fact is in \`DISCOVERED_STATE\`, treat it as authoritative. Do not ask "what's your tech stack?" if \`DISCOVERED_STATE.tech_stack\` is set.

3. **Missing ≠ empty.** A missing file means "I don't know" — not "the user has no preferences". Record \`missing: true\` and surface it only if a later step needs that file.

4. **Surface selectively.** When routing or recommending, pull the specific field you need and mention it briefly ("I can see you're on phase {n}, plan {id}..."). Do not dump the whole \`DISCOVERED_STATE\` object.

5. **Refresh, don't stale.** If the skill has multiple passes (e.g. \`/st:build\` option D re-runs discovery after user input), re-read the files — do not rely on the first pass's findings for the second pass.`,
    },
    PassThrough: {
      name: "PassThrough",
      description: "How to share discovered state with spawned subagents",
      body: `When a skill that uses SilentDiscovery spawns a subagent (e.g. \`create-plan\` spawns \`software-teams-planner\`), pass \`DISCOVERED_STATE\` into the spawn prompt as a named block:

\`\`\`
Context already discovered: {DISCOVERED_STATE serialised as yaml}
Do NOT re-read these scaffolding files. Surface open questions ONLY for facts you cannot infer from this block.
\`\`\`

This avoids the common failure where the orchestrator reads scaffolding, spawns an agent, and the agent reads the same scaffolding again.`,
    },
    Usage: {
      name: "Usage",
      description: "Tag usage and references",
      body: `\`\`\`
@ST:SilentDiscovery
\`\`\`

Referenced at the top of a skill's numbered workflow, typically as step 1 or 2. Always runs before any user-facing prompt.`,
    },
  },
  defaultOrder: [
    "WhatToRead",
    "WhatToDerive",
    "TestSuiteDetection",
    "DisciplineRules",
    "PassThrough",
    "Usage",
  ],
};

export default SilentDiscovery;
