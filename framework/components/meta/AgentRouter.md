---
name: AgentRouter
category: meta
description: Enumerate Claude Code agents and route tasks to the best specialist
---

# AgentRouter

Enumerates the Claude Code agents available to the current session and routes
individual plan tasks to the most appropriate specialist. Used by `jdi-planner`
at plan-creation time to pin `agent:` into each task's frontmatter, and by
`implement-plan` (via `ComplexityRouter` and `AgentTeamsOrchestration`) at
execution time to honour those pins when spawning via the Task tool.

The point of this component is simple: **stop defaulting every subagent call to
`general-purpose`**. If the user has installed domain specialists (e.g.
`unity-specialist`, `unity-ui-specialist`, `gameplay-programmer`,
`godot-gdscript-specialist`, `ue-gas-specialist`), JDI plans must surface them
into the plan and implement-plan must use them.

---

## 1. Agent Discovery (at plan time)

The planner MUST perform discovery before task breakdown. JDI specialists live
in the framework itself, not in Claude Code's subagent registry — the
orchestrator reads their specs and injects identity via prompt text when
spawning (see `framework/jedi.md` Critical Constraints).

Merge these roots in order (earlier roots override later ones on name
collision):

1. `.jdi/framework/agents/jdi-*.md` — JDI specialists installed in the project
   (primary source for any project using JDI). When working on the jedi repo
   itself, fall back to `framework/agents/jdi-*.md` in the repo root.
2. `.claude/agents/*.md` — project-local Claude Code subagents (user-added
   specialists, takes precedence over user-global)
3. `~/.claude/agents/*.md` — user-global Claude Code subagents

For each `.md` file, read the YAML frontmatter and extract:

- `name` — identity used in the spawn prompt (JDI agents) or as the
  `subagent_type` value (Claude Code registered subagents)
- `description` — the one-line capability blurb used for routing decisions
- `model` (optional) — preferred model if specified
- `tools` (optional) — tool allowlist if the agent is tool-restricted

Record each entry with a `source:` field so `implement-plan` knows how to spawn
it: `jdi` for JDI framework specialists, `claude-code` for registered
subagents. Agents whose frontmatter is unreadable or missing `name` are skipped.

Discovery commands (reference — the planner uses `Glob` + `Read`):

```bash
ls .jdi/framework/agents/jdi-*.md 2>/dev/null || ls framework/agents/jdi-*.md 2>/dev/null
ls .claude/agents/ 2>/dev/null
ls ~/.claude/agents/ 2>/dev/null
```

The resulting catalogue MUST be written into the plan index frontmatter as
`available_agents:` (see `framework/templates/PLAN.md`) so reviewers and the
implement-plan pass can see exactly which agents were visible at plan time.

```yaml
available_agents:
  - name: jdi-backend
    source: jdi
    description: PHP/Laravel backend specialist — APIs, migrations, contracts
  - name: jdi-frontend
    source: jdi
    description: TS/React frontend specialist — components, types, client code
  - name: jdi-qa-tester
    source: jdi
    description: Post-task verification, a11y, contract checks
  - name: unity-specialist
    source: claude-code
    description: Unity API patterns and optimisation (user-added)
```

If discovery returns zero agents (no JDI install and no `.claude/agents/`),
the planner records `available_agents: []` and falls back to the legacy
tech-stack default (`jdi-backend` / `jdi-frontend` / `general-purpose`) so
the empty state is explicit rather than silent.

---

## 2. Task-to-Agent Matching (at plan time)

For each task in the plan, the planner selects ONE primary agent using this
signal hierarchy (highest to lowest):

| Priority | Signal | Example |
|----------|--------|---------|
| 1 | Explicit user instruction | "use the unity-specialist for this task" |
| 2 | Files touched by the task | `Assets/Scripts/UI/**` → `unity-ui-specialist` |
| 3 | Task type + tech_stack | Unity C# gameplay → `gameplay-programmer` or `unity-specialist` |
| 4 | Task objective keywords | "shader", "VFX", "render pipeline" → `unity-shader-specialist` |
| 5 | Checkpoint type | `checkpoint:human-verify` → `qa-tester` |
| 6 | Tech-stack default | PHP → `jdi-backend`, TS/React → `jdi-frontend`, C#/Unity → `unity-specialist` |
| 7 | Fallback | `general-purpose` (only if no specialists exist) |

### Unity routing cheat sheet (common case for game projects)

| Signal | Preferred agent |
|--------|-----------------|
| `Assets/Scripts/**/UI/**` or TMPro/UGUI/UI Toolkit references | `unity-ui-specialist` |
| `Assets/Scripts/**/DOTS/**` or Jobs/Burst/ECS references | `unity-dots-specialist` |
| Shader Graph, HLSL, VFX Graph, render pipeline | `unity-shader-specialist` |
| Addressables, asset bundles, memory budgets | `unity-addressables-specialist` |
| Gameplay mechanics, combat, movement, abilities | `gameplay-programmer` |
| AI, behaviour trees, pathfinding, perception | `ai-programmer` |
| Core engine/framework, performance-critical systems | `engine-programmer` or `performance-analyst` |
| General Unity API guidance, bootstrapping, subsystem integration | `unity-specialist` |
| Tests, QA checklists, regression scripts | `qa-tester` |
| Any task that edits code — no better specialist available | `gameplay-programmer` (games) or `general-purpose` (non-game) |

### Unreal routing cheat sheet

| Signal | Preferred agent |
|--------|-----------------|
| Blueprints and Blueprint architecture | `ue-blueprint-specialist` |
| UMG / CommonUI widgets | `ue-umg-specialist` |
| Gameplay Ability System, abilities, attribute sets | `ue-gas-specialist` |
| Replication, RPCs, prediction | `ue-replication-specialist` |
| General UE API and subsystem guidance | `unreal-specialist` |

### Godot routing cheat sheet

| Signal | Preferred agent |
|--------|-----------------|
| GDScript code, typed signals, node architecture | `godot-gdscript-specialist` |
| GDExtension / C++ / Rust bindings | `godot-gdextension-specialist` |
| Godot shading language, visual shaders, particles | `godot-shader-specialist` |
| General Godot API and node/scene guidance | `godot-specialist` |

### Non-game defaults

| Signal | Preferred agent |
|--------|-----------------|
| PHP backend | `jdi-backend` |
| TypeScript / React frontend | `jdi-frontend` |
| Full-stack | `jdi-backend` + `jdi-frontend` |
| Orchestration / sprint / risk / scope | `jdi-producer` |
| Performance profiling / budgets / regression | `jdi-perf-analyst` |
| Security review / vuln audit / secrets / privacy | `jdi-security` |
| Test case writing / regression checklist / post-task verify | `jdi-qa-tester` |

### Jedi meta-framework routing

Use these pins when the work being done is on the Jedi framework itself
(editing files under `framework/`, writing plans about JDI, etc.).

| Signal | Preferred agent |
|--------|-----------------|
| Framework design | `jdi-architect` |
| Framework edits | `jdi-programmer` |
| Framework tests | `jdi-quality` |
| Plan creation | `jdi-planner` |
| Sprint / risk / scope | `jdi-producer` |
| Perf profiling | `jdi-perf-analyst` |
| Security audit | `jdi-security` |
| Post-task verify | `jdi-qa-tester` |

> **Note:** `jdi-qa-tester` is automatically invoked by `implement-plan` after
> every code-touching task — it does not need to be explicitly pinned per task.

---

## 3. Output Format (written into plan files)

### Plan index (`{phase}-{plan}-{slug}.plan.md`) frontmatter

```yaml
available_agents:
  - name: unity-specialist
    description: ...
  - name: gameplay-programmer
    description: ...

# Primary agent for single-agent mode (first task's agent, or most common)
primary_agent: unity-specialist
```

### Task file (`{phase}-{plan}-{slug}.T{n}.md`) frontmatter

```yaml
agent: unity-ui-specialist   # REQUIRED when available_agents is non-empty
agent_rationale: "Edits Canvas-based HUD — UI Toolkit expertise needed"
```

`agent_rationale` is a short free-text note explaining WHY the planner picked
this specialist. Reviewers can use it to challenge bad routings.

---

## 4. Execution (at implement-plan time)

`implement-plan` MUST read the task's `agent:` field and the corresponding
`source:` from `available_agents`, then spawn via the Task tool using the
correct pattern for that source.

> **Non-negotiable platform constraint:** Claude Code's Task tool only accepts
> `subagent_type` values that are registered in its subagent list. JDI's
> specialists live in `framework/agents/` — NOT in `.claude/agents/` — so they
> are NOT registered subagent types. Passing `subagent_type="jdi-backend"`
> (or any other JDI agent name) errors with `classifyHandoffIfNeeded is not
> defined`. See `framework/jedi.md` Critical Constraints.
>
> The workaround: spawn `subagent_type="general-purpose"` and inject the JDI
> agent's identity via the prompt text. Registered Claude Code specialists
> (found under `.claude/agents/`) can still be spawned directly by name.

### Source-aware spawn pattern

| `source` in catalogue | `subagent_type` | Identity mechanism |
|----------------------|-----------------|--------------------|
| `jdi` | `"general-purpose"` | Prompt text: `"You are {task.agent}. Read .jdi/framework/agents/{task.agent}.md for instructions."` |
| `claude-code` | `"{task.agent}"` | Native — Claude Code loads the agent spec from `.claude/agents/` |

### Single-agent mode

```
# source: jdi (JDI framework specialist)
Task(
  subagent_type: "general-purpose",
  name: "{plan.primary_agent}",
  prompt: "You are {plan.primary_agent}. Read .jdi/framework/agents/{plan.primary_agent}.md
  for your full role and instructions. Also read .jdi/framework/components/meta/AgentBase.md
  for the JDI base protocol.

  <standard single-agent spawn prompt from ComplexityRouter>"
)

# source: claude-code (user-added registered specialist)
Task(
  subagent_type: "{plan.primary_agent}",   # e.g. unity-specialist
  name: "{plan.primary_agent}",
  prompt: "<standard single-agent spawn prompt from ComplexityRouter>"
)
```

If `plan.primary_agent` is missing (legacy plan or empty `available_agents`),
fall back to `subagent_type="general-purpose"` with a `jdi-backend` /
`jdi-frontend` spec load in the prompt.

### Agent-teams mode

For each task, read its `agent:` frontmatter field and the matching `source:`
from the plan's `available_agents` catalogue. Spawn ONE Task tool call per task
using the pattern that matches its source (see table above).

```
# JDI specialist (source: jdi)
Task(
  subagent_type: "general-purpose",
  name: "{task.agent}-{task_id}",
  prompt: "You are {task.agent}. Read .jdi/framework/agents/{task.agent}.md for instructions.
  <spawn prompt from AgentTeamsOrchestration with TASK_FILE: {task file}>"
)

# Claude Code registered specialist (source: claude-code)
Task(
  subagent_type: "{task.agent}",
  name: "{task.agent}-{task_id}",
  prompt: "<spawn prompt from AgentTeamsOrchestration with TASK_FILE: {task file}>"
)
```

Tasks with no `agent:` field fall back to the tech-stack default
(`jdi-backend` / `jdi-frontend`) spawned via the `source: jdi` pattern.

### Mixed fallbacks

- If a pinned `source: jdi` agent's spec file is not found at
  `.jdi/framework/agents/{name}.md` (or `framework/agents/{name}.md` in the
  self-hosting repo), downgrade to `general-purpose` with a `jdi-backend` /
  `jdi-frontend` spec load. Record `agent_downgrade: {planned} → general-purpose
  (spec not found)` in the summary.
- If a pinned `source: claude-code` agent is not registered in the current
  session (e.g. plan was created on a different machine), downgrade the same
  way. Record `agent_downgrade: {planned} → general-purpose (not installed)`.
- Never silently change the pin; always surface downgrades in the summary.

---

## 5. Validation Rules

The planner MUST NOT:

1. Invent agent names that are not in `available_agents`.
2. Route a task to an agent whose description clearly does not match the task
   (e.g. `narrative-director` for a shader task).
3. Leave `agent:` blank when `available_agents` is non-empty.

The implement-plan pass MUST:

1. Read `agent:` from every task file before spawning.
2. Read the matching `source:` from the plan's `available_agents` catalogue to
   pick the correct spawn pattern (see §4).
3. Surface any downgrade in the summary.
4. Prefer `.jdi/framework/agents/` (or `framework/agents/` in the jedi repo)
   over `.claude/agents/` over `~/.claude/agents/` on name collision.

---

## Usage

```
<JDI:AgentRouter mode="discover" />     # at plan time — enumerate + match
<JDI:AgentRouter mode="spawn" />        # at implement time — honour pins
```

Referenced by:
- `framework/agents/jdi-planner.md` (discover + match)
- `framework/components/meta/ComplexityRouter.md` (spawn)
- `framework/components/meta/AgentTeamsOrchestration.md` (spawn)
- `framework/commands/create-plan.md` (discover)
- `framework/commands/implement-plan.md` (spawn)
