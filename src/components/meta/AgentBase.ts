/**
 * AgentBase component module.
 *
 * Parsing rules applied:
 * - `## Heading` boundaries for most sections.
 * - Explicit `<section name="X">...</section>` blocks for "Sandbox" and "TeamMode".
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 * - Inline `<JDI:` references lifted into `requires` arrays AND kept in body
 *   (intentional per design doc §"Tag syntax in source files").
 */

import type { Component } from "../types";

const AgentBase: Component = {
  name: "AgentBase",
  category: "meta",
  description:
    "Standards inherited by all Software Teams agents via `@ST:AgentBase`. Default loads Core only.",
  sections: {
    Standards: {
      name: "Standards",
      description: "Base standards every agent must follow",
      body: `- Use **Australian English** spelling in all outputs.
- Follow \`CLAUDE.md\` and \`.claude/rules/\` conventions.
- Read \`.software-teams/config/state.yaml\` once at task start for context. Do NOT update state.yaml for status transitions — the framework handles this. Only use state.yaml to record decisions, deviations, or blockers via \`@ST:StateUpdate\`.
- Use the Read tool before editing any file.
- Batch file reads: issue all Read calls in a single turn rather than sequentially.
- Batch git operations: combine related commands into a single Bash call where possible.`,
    },
    BudgetDiscipline: {
      name: "BudgetDiscipline",
      description: "Rules for surviving finite per-invocation budgets",
      body: `You have a finite per-invocation budget (tokens, tool calls, wall time). Long runs can be terminated mid-task before you produce your final report. To survive:

1. **Batch reads in parallel** — one turn with all Read calls, not sequential.
2. **Cap exploration** — read only the files your spawn prompt names. If more are needed, report what you need and stop rather than wandering.
3. **Write fixes before verifying** — Edit calls persist even if you are later truncated. Save the report for last.
4. **Short reports (<400 words)** — terse file list + one sentence per change. Long formal reports are where truncation bites.
5. **One concern per invocation** — address what was asked, do not expand scope.
6. **Don't re-read files you just edited** — the harness tracks state.

If your work exceeds one invocation, complete what you can, return a progress report naming exactly what remains, and let the orchestrator re-spawn you.`,
    },
    ComponentResolution: {
      name: "ComponentResolution",
      description: "How to handle @ST: tags in specs",
      body: `\`@ST:\` tags in your spec are pre-resolved at sync time — the body
content is inlined into your agent spec before you read it. Treat any text
inside the spec as if it were part of the agent definition itself.

If a tag survives unresolved (it should not, but as a fallback):
1. Run \`software-teams component get <Name>\` for the whole component, or
   \`software-teams component get <Name> <Section>\` for a specific section.
2. Use the returned body in place of the tag.

If your spec has a \`requires_components\` frontmatter field, batch-fetch
the listed components via the same CLI before starting execution.

Do NOT skip component tags — they contain essential instructions.`,
    },
    ActivationProtocol: {
      name: "ActivationProtocol",
      description: "Announcement pattern on agent activation",
      body: `On activation, announce and begin immediately:
\`\`\`
You are now active as {agent-name}. {Action verb} as requested.
\`\`\``,
    },
    StructuredReturns: {
      name: "StructuredReturns",
      description: "YAML return block format for all agents",
      body: `Return a YAML block with \`status\`, agent-specific fields, and \`next_action\` after all work is complete.`,
    },
    Boundaries: {
      name: "Boundaries",
      description: "Will Do / Will Not scope declaration",
      body: `- **Will Do**: Actions within agent responsibility. Prioritise these.
- **Will Not**: Actions outside scope. Delegate or escalate, never attempt.`,
    },
    Sandbox: {
      name: "Sandbox",
      description: "File operation rules and structured return format for sandboxed agents",
      body: `## File Operations

You are spawned with \`mode: "acceptEdits"\` and a scoped \`allowedTools\` allowlist (declared in \`.claude/settings.json\` and mirrored in \`src/utils/claude.ts\`). The allowlist covers Read/Write/Edit/MultiEdit/Glob/Grep/Task plus scoped \`Bash(bun:*)\`, \`Bash(git:*)\`, \`Bash(gh:*)\`, \`Bash(npm:*)\`, \`Bash(npx:*)\`, \`Bash(mkdir:*)\`, \`Bash(rm:*)\`, \`Bash(software-teams:*)\`. All standard tools work within that scope:

| Operation | Tool / Method | Notes |
|-----------|--------------|-------|
| Edit existing files | Edit tool | Primary way to modify code |
| Create new files | Write tool | Works — create files directly |
| Delete files | Bash \`rm\` | Destructive — use with care |
| Read files | Read tool | Works reliably |
| Run commands | Bash tool | Output is real; side-effects vary |

**Key Rules:**
1. **Use the Edit tool** to modify existing files (read first).
2. **Use the Write tool** to create new files directly — do NOT defer to the orchestrator.
3. **Do NOT run \`git commit\`** — the orchestrator handles commits after all tasks complete. Report commits needed in \`commits_pending\`.

### Structured Returns

\`\`\`yaml
files_modified:
  - path/to/edited/file1.ts
files_created:
  - path/to/new/file.md
commits_pending:
  - message: |
      feat(01-01-T1): implement feature X
    files:
      - path/to/modified/file1.ts
      - path/to/new/file.md
\`\`\`

### Orchestrator Post-Agent Handling

After an agent completes, the orchestrator:
1. Executes commits from \`commits_pending\` via \`git add\` + \`git commit\`
2. Records real commit hashes in \`.software-teams/config/state.yaml\``,
    },
    TeamMode: {
      name: "TeamMode",
      description: "Communication rules when operating within an Agent Team",
      body: `## Communication (Team Mode)

When operating within an Agent Team (spawned by coordinator):

1. **Claim tasks**: Call TaskList, find tasks assigned to you
2. **Execute**: Read task description, implement using Edit tool
3. **Report**: SendMessage to coordinator with structured return (include \`files_modified\`, \`files_created\`, \`commits_pending\`)
4. **Complete**: TaskUpdate(status: "completed") AFTER sending results
5. **Next**: Check TaskList for more assigned tasks. If none, go idle.

**Team Mode Rules:**
- NEVER write to state.yaml (coordinator handles this)
- ALWAYS SendMessage results to coordinator before TaskUpdate(completed)
- Use **SendMessage** to communicate — plain text is not visible to teammates.`,
    },
  },
  defaultOrder: [
    "Standards",
    "BudgetDiscipline",
    "ComponentResolution",
    "ActivationProtocol",
    "StructuredReturns",
    "Boundaries",
    "Sandbox",
    "TeamMode",
  ],
};

export default AgentBase;
