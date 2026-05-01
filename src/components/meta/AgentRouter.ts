/**
 * AgentRouter component module.
 *
 * Parsing rules applied:
 * - YAML frontmatter provides `name`, `category`, `description`.
 * - `## Heading` boundaries delimit sections.
 * - Trailing `(...)` parameter hints stripped from heading text
 *   (e.g. "## 1. Agent Discovery (at plan time)" → "1. Agent Discovery").
 * - Body trim: leading/trailing whitespace only; internal whitespace preserved.
 */

import type { Component } from "../types";

const AgentRouter: Component = {
  name: "AgentRouter",
  category: "meta",
  description:
    "Enumerate Claude Code agents and route tasks to the best specialist",
  sections: {
    Discovery: {
      name: "Discovery",
      description: "Enumerate available agents before task breakdown",
      body: `The planner MUST perform discovery before task breakdown. Software Teams specialists are
authored under \`framework/agents/\` and converted into Claude Code's native
subagent registry by \`software-teams sync-agents\` (see \`src/utils/convert-agents.ts\`),
which writes Claude-compatible specs to \`.claude/agents/\`. Once that has run,
both Software Teams specialists and user-added Claude Code subagents are spawned natively
by name; the legacy identity-injection pattern is documented as a fallback only
(see §4).

Merge these roots in order (earlier roots override later ones on name
collision):

1. \`.software-teams/framework/agents/software-teams-*.md\` — Software Teams specialists installed in the project
   (primary source for any project using Software Teams). When working on the Software Teams repo
   itself, fall back to \`framework/agents/software-teams-*.md\` in the repo root.
2. \`.claude/agents/*.md\` — project-local Claude Code subagents (user-added
   specialists, takes precedence over user-global)
3. \`~/.claude/agents/*.md\` — user-global Claude Code subagents

For each \`.md\` file, read the YAML frontmatter and extract:

- \`name\` — identity used in the spawn prompt (Software Teams agents) or as the
  \`subagent_type\` value (Claude Code registered subagents)
- \`description\` — the one-line capability blurb used for routing decisions
- \`model\` (optional) — preferred model if specified
- \`tools\` (optional) — tool allowlist if the agent is tool-restricted

Record each entry with a \`source:\` field so \`implement-plan\` knows how to spawn
it: \`software-teams\` for Software Teams framework specialists, \`claude-code\` for registered
subagents. Agents whose frontmatter is unreadable or missing \`name\` are skipped.

Discovery commands (reference — the planner uses \`Glob\` + \`Read\`):

\`\`\`bash
ls .software-teams/framework/agents/software-teams-*.md 2>/dev/null || ls framework/agents/software-teams-*.md 2>/dev/null
ls .claude/agents/ 2>/dev/null
ls ~/.claude/agents/ 2>/dev/null
\`\`\`

The resulting catalogue MUST be written into the plan index frontmatter as
\`available_agents:\` (see \`framework/templates/PLAN.md\`) so reviewers and the
implement-plan pass can see exactly which agents were visible at plan time.

\`\`\`yaml
available_agents:
  - name: software-teams-backend
    source: software-teams
    description: PHP/Laravel backend specialist — APIs, migrations, contracts
  - name: software-teams-frontend
    source: software-teams
    description: TS/React frontend specialist — components, types, client code
  - name: software-teams-qa-tester
    source: software-teams
    description: Post-task verification, a11y, contract checks
  - name: unity-specialist
    source: claude-code
    description: Unity API patterns and optimisation (user-added)
\`\`\`

If discovery returns zero agents (no Software Teams install and no \`.claude/agents/\`),
the planner records \`available_agents: []\` and falls back to the domain default (\`software-teams-backend\` / \`software-teams-frontend\` / \`general-purpose\`) so
the empty state is explicit rather than silent.`,
    },
    Matching: {
      name: "Matching",
      description: "Select the best agent for each task in the plan",
      body: `For each task in the plan, the planner selects ONE primary agent using this
signal hierarchy (highest to lowest):

| Priority | Signal | Example |
|----------|--------|---------|
| 1 | Explicit user instruction | "use the unity-specialist for this task" |
| 2 | Files touched by the task | \`Assets/Scripts/UI/**\` → \`unity-ui-specialist\` |
| 3 | Task type + tech_stack | Unity C# gameplay → \`gameplay-programmer\` or \`unity-specialist\` |
| 4 | Task objective keywords | "shader", "VFX", "render pipeline" → \`unity-shader-specialist\` |
| 5 | Checkpoint type | \`checkpoint:human-verify\` → \`qa-tester\` |
| 6 | Domain default | Backend code → \`software-teams-backend\`, frontend code → \`software-teams-frontend\`, C#/Unity → \`unity-specialist\` |
| 7 | Fallback | \`general-purpose\` (only if no specialists exist) |

### Unity routing cheat sheet (common case for game projects)

| Signal | Preferred agent |
|--------|-----------------|
| \`Assets/Scripts/**/UI/**\` or TMPro/UGUI/UI Toolkit references | \`unity-ui-specialist\` |
| \`Assets/Scripts/**/DOTS/**\` or Jobs/Burst/ECS references | \`unity-dots-specialist\` |
| Shader Graph, HLSL, VFX Graph, render pipeline | \`unity-shader-specialist\` |
| Addressables, asset bundles, memory budgets | \`unity-addressables-specialist\` |
| Gameplay mechanics, combat, movement, abilities | \`gameplay-programmer\` |
| AI, behaviour trees, pathfinding, perception | \`ai-programmer\` |
| Core engine/framework, performance-critical systems | \`engine-programmer\` or \`performance-analyst\` |
| General Unity API guidance, bootstrapping, subsystem integration | \`unity-specialist\` |
| Tests, QA checklists, regression scripts | \`qa-tester\` |
| Any task that edits code — no better specialist available | \`gameplay-programmer\` (games) or \`general-purpose\` (non-game) |

### Unreal routing cheat sheet

| Signal | Preferred agent |
|--------|-----------------|
| Blueprints and Blueprint architecture | \`ue-blueprint-specialist\` |
| UMG / CommonUI widgets | \`ue-umg-specialist\` |
| Gameplay Ability System, abilities, attribute sets | \`ue-gas-specialist\` |
| Replication, RPCs, prediction | \`ue-replication-specialist\` |
| General UE API and subsystem guidance | \`unreal-specialist\` |

### Godot routing cheat sheet

| Signal | Preferred agent |
|--------|-----------------|
| GDScript code, typed signals, node architecture | \`godot-gdscript-specialist\` |
| GDExtension / C++ / Rust bindings | \`godot-gdextension-specialist\` |
| Godot shading language, visual shaders, particles | \`godot-shader-specialist\` |
| General Godot API and node/scene guidance | \`godot-specialist\` |

### Non-game defaults

| Signal | Preferred agent |
|--------|-----------------|
| Backend code (server-side logic, APIs, data layer) | \`software-teams-backend\` |
| Frontend code (UI components, client-side logic, styling) | \`software-teams-frontend\` |
| Full-stack (changes span both backend and frontend) | \`software-teams-backend\` + \`software-teams-frontend\` |
| Orchestration / sprint / risk / scope | \`software-teams-producer\` |
| Performance profiling / budgets / regression | \`software-teams-perf-analyst\` |
| Security review / vuln audit / secrets / privacy | \`software-teams-security\` |
| Test case writing / regression checklist / post-task verify | \`software-teams-qa-tester\` |

#### Domain Detection Heuristics

When task files don't clearly indicate domain, use these patterns:

- **Backend signals**: \`server/\`, \`api/\`, \`app/\`, \`src/server/\`, \`controllers/\`, \`models/\`, \`migrations/\`, \`routes/\`, \`handlers/\`, \`services/\`, \`repositories/\`, \`cmd/\`, \`internal/\`, \`pkg/\`
- **Frontend signals**: \`components/\`, \`views/\`, \`pages/\`, \`hooks/\`, \`stores/\`, \`styles/\`, \`public/\`, \`src/client/\`, \`src/app/\` (when alongside components), \`templates/\` (UI), \`layouts/\`
- **DevOps signals**: \`docker/\`, \`.github/\`, \`ci/\`, \`deploy/\`, \`infra/\`, \`terraform/\`, \`helm/\`, \`k8s/\`, \`Dockerfile\`, \`docker-compose*\`, \`nginx/\`, \`scripts/\`
- **Ambiguous**: \`src/\`, \`lib/\`, \`utils/\`, \`helpers/\`, \`shared/\` — check file extensions and imports to determine domain

### Software Teams meta-framework routing

Use these pins when the work being done is on the Software Teams framework itself
(editing files under \`framework/\`, writing plans about Software Teams, etc.).

| Signal | Preferred agent |
|--------|-----------------|
| Framework design | \`software-teams-architect\` |
| Framework edits | \`software-teams-programmer\` |
| Framework tests | \`software-teams-quality\` |
| Plan creation | \`software-teams-planner\` |
| Sprint / risk / scope | \`software-teams-producer\` |
| Perf profiling | \`software-teams-perf-analyst\` |
| Security audit | \`software-teams-security\` |
| Post-task verify | \`software-teams-qa-tester\` |

> **Note:** \`software-teams-qa-tester\` is automatically invoked by \`implement-plan\` after
> every code-touching task — it does not need to be explicitly pinned per task.`,
    },
    OutputFormat: {
      name: "OutputFormat",
      description: "Format for writing agent assignments into plan files",
      body: `### Plan index (\`{phase}-{plan}-{slug}.plan.md\`) frontmatter

\`\`\`yaml
available_agents:
  - name: unity-specialist
    description: ...
  - name: gameplay-programmer
    description: ...

# Primary agent for single-agent mode (first task's agent, or most common)
primary_agent: unity-specialist
\`\`\`

### Task file (\`{phase}-{plan}-{slug}.T{n}.md\`) frontmatter

\`\`\`yaml
agent: unity-ui-specialist   # REQUIRED when available_agents is non-empty
agent_rationale: "Edits Canvas-based HUD — UI Toolkit expertise needed"
\`\`\`

\`agent_rationale\` is a short free-text note explaining WHY the planner picked
this specialist. Reviewers can use it to challenge bad routings.`,
    },
    Execution: {
      name: "Execution",
      description: "How implement-plan honours agent pins when spawning",
      body: `**Native subagents are the default.** \`convertAgents()\` (invoked by \`software-teams sync-agents\` and \`software-teams init\`) populates \`.claude/agents/\` with Claude Code-compatible specs converted from \`framework/agents/software-teams-*.md\`, so every Software Teams specialist is a first-class registered subagent in every Software Teams-installed project. User-added subagents under \`.claude/agents/\` and \`~/.claude/agents/\` are equally first-class.

\`implement-plan\` MUST read the task's \`agent:\` field and the corresponding \`source:\` from \`available_agents\`, then spawn via the Task tool with the agent name as \`subagent_type\`. Claude Code loads the spec from \`.claude/agents/{name}.md\` automatically — no identity preamble in the prompt body.

### Source-aware spawn pattern

All agents MUST be spawned with \`mode: "acceptEdits"\`. Write/Edit/Bash permissions come from the scoped \`allowedTools\` allowlist declared in the project-scoped \`.claude/settings.json\` (mirrored as the default list in \`src/utils/claude.ts\`). Agents run in background and cannot prompt the user, so the allowlist must cover everything they need.

<!-- lint-allow: legacy-injection -->
| \`source\` in catalogue | \`subagent_type\` | \`mode\` | Identity mechanism |
|----------------------|-----------------|--------|--------------------|
| \`software-teams\` (after \`software-teams sync-agents\`) | \`"{task.agent}"\` | \`"acceptEdits"\` | Native — Claude Code loads the spec from \`.claude/agents/{name}.md\` |
| \`claude-code\` | \`"{task.agent}"\` | \`"acceptEdits"\` | Native — Claude Code loads the spec from \`.claude/agents/{name}.md\` |
| \`software-teams\` (fresh clone — \`.claude/agents/\` not yet generated) | \`"general-purpose"\` | \`"acceptEdits"\` | Legacy fallback: prompt-text identity injection (see below) |
<!-- /lint-allow -->

### Single-agent mode

\`\`\`
Agent(
  subagent_type: "{plan.primary_agent}",   # e.g. software-teams-backend, software-teams-frontend, unity-specialist
  mode: "acceptEdits",
  name: "{plan.primary_agent}",
  prompt: "<standard single-agent spawn prompt from ComplexityRouter>"
)
\`\`\`

The prompt contains no \`"You are software-teams-X. Read ..."\` preamble — Claude Code resolves the agent spec from \`.claude/agents/{plan.primary_agent}.md\` when spawned by name. See \`framework/components/meta/ComplexityRouter.md\` for the prompt body and \`.claude/RULES.md\` / \`framework/templates/RULES.md\` for the orchestration doctrine.

If \`plan.primary_agent\` is missing (legacy plan or empty \`available_agents\`), use the legacy fallback below.

### Agent-teams mode

For each task, read its \`agent:\` frontmatter field. Spawn one Agent tool call per task with the agent name as \`subagent_type\`:

\`\`\`
Agent(
  subagent_type: "{task.agent}",
  mode: "acceptEdits",
  name: "{task.agent}-{task_id}",
  prompt: "<spawn prompt from AgentTeamsOrchestration with TASK_FILE: {task file}>"
)
\`\`\`

Tasks with no \`agent:\` field fall back to the domain default (\`software-teams-backend\` / \`software-teams-frontend\`) spawned natively by name.

### Downgrade rules

- If a pinned agent's spec is not present in \`.claude/agents/{name}.md\` (or \`~/.claude/agents/{name}.md\`), downgrade to \`general-purpose\` using the legacy fallback pattern below and record \`agent_downgrade: {planned} → general-purpose (not registered)\` in the summary.
- Never silently change the pin; always surface downgrades.

### Legacy fallback — identity injection (fresh-clone bootstrap)

<!-- lint-allow: legacy-injection -->
> Used **only** when \`.claude/agents/\` has not yet been generated (typical fresh-clone state before \`software-teams init\` / \`software-teams sync-agents\` has run). Claude Code's Task tool validates \`subagent_type\` against its registered list, so unregistered names error with \`classifyHandoffIfNeeded is not defined\`. The fallback spawns \`general-purpose\` and injects the Software Teams agent's identity via prompt text:
>
> \`\`\`
> # source: software-teams — fresh clone, .claude/agents/ not yet generated
> Agent(
>   subagent_type: "general-purpose",
>   mode: "acceptEdits",
>   name: "{plan.primary_agent}",
>   prompt: "You are {plan.primary_agent}. Read .software-teams/framework/agents/{plan.primary_agent}.md
>   for your full role and instructions. Also read .software-teams/framework/components/meta/AgentBase.md
>   for the Software Teams base protocol.
>
>   <standard single-agent spawn prompt from ComplexityRouter>"
> )
>
> # Agent-teams equivalent
> Agent(
>   subagent_type: "general-purpose",
>   mode: "acceptEdits",
>   name: "{task.agent}-{task_id}",
>   prompt: "You are {task.agent}. Read .software-teams/framework/agents/{task.agent}.md for instructions.
>   <spawn prompt from AgentTeamsOrchestration with TASK_FILE: {task file}>"
> )
> \`\`\`
>
> To exit fallback mode, run \`software-teams sync-agents\` (or re-run \`software-teams init\`) so the Software Teams specialists are written to \`.claude/agents/\`. Every subsequent spawn then uses the native default.
>
> The framework-lint test in \`src/framework-lint.test.ts\` allowlists this entire HTML-comment block via \`<!-- lint-allow: legacy-injection -->\` … \`<!-- /lint-allow -->\` and fails on any legacy pattern outside such blocks.
<!-- /lint-allow -->`,
    },
    ValidationRules: {
      name: "ValidationRules",
      description: "Rules the planner and implement-plan pass must follow",
      body: `The planner MUST NOT:

1. Invent agent names that are not in \`available_agents\`.
2. Route a task to an agent whose description clearly does not match the task
   (e.g. \`narrative-director\` for a shader task).
3. Leave \`agent:\` blank when \`available_agents\` is non-empty.

The implement-plan pass MUST:

1. Read \`agent:\` from every task file before spawning.
2. Read the matching \`source:\` from the plan's \`available_agents\` catalogue to
   pick the correct spawn pattern (see §4).
3. Surface any downgrade in the summary.
4. Prefer \`.software-teams/framework/agents/\` (or \`framework/agents/\` in the Software Teams repo)
   over \`.claude/agents/\` over \`~/.claude/agents/\` on name collision.`,
    },
    Usage: {
      name: "Usage",
      description: "Tag usage and references",
      body: `\`\`\`
@ST:AgentRouter:Discovery    # at plan time — enumerate
@ST:AgentRouter:Matching     # at plan time — match tasks to agents
@ST:AgentRouter:Execution    # at implement time — honour pins
\`\`\`

Referenced by:
- \`framework/agents/software-teams-planner.md\` (discover + match)
- \`framework/components/meta/ComplexityRouter.md\` (spawn)
- \`framework/components/meta/AgentTeamsOrchestration.md\` (spawn)
- \`framework/commands/create-plan.md\` (discover)
- \`framework/commands/implement-plan.md\` (spawn)`,
    },
  },
  defaultOrder: [
    "Discovery",
    "Matching",
    "OutputFormat",
    "Execution",
    "ValidationRules",
    "Usage",
  ],
};

export default AgentRouter;
