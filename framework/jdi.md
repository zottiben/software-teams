---
description: Entry Point and Architecture for the JDI framework
model: opus
---

# JDI Framework

**Entry Point** | Componentised prompts, Context-efficient, agent-delegated development framework.

---

## Core Principles

| Principle | Description |
|-----------|-------------|
| **Minimal Context** | Commands are ultra-minimal stubs (~300 tokens). Heavy specs stay out of main context. |
| **Agent Delegation** | Complex operations spawn agents via Task tool. Agents run in isolated context. |
| **External State** | All state in JSON files. No context pollution from state tracking. |
| **On-Demand Reading** | Agents read specs, components, hooks, and rules only when needed. |

---

## Critical Constraints

> **WARNING: Task Tool `subagent_type` Parameter**
>
> The Claude Code Task tool **ONLY accepts `subagent_type="general-purpose"`** as a valid value.
>
> **If you use any other value** (e.g., `"jdi-programmer"`, `"jdi-planner"`, or any custom type),
> the agent will fail with this error:
>
> ```
> classifyHandoffIfNeeded is not defined
> ```

### Correct Pattern

Agent identity is passed via the **prompt parameter**, NOT the `subagent_type` parameter.
**Permission mode** MUST be `"acceptEdits"`. Tool scope comes from the project-scoped `.claude/settings.json` allowlist (Read/Write/Edit/MultiEdit/Glob/Grep/Task plus scoped `Bash(bun:*)`, `Bash(git:*)`, `Bash(gh:*)`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(mkdir:*)`, `Bash(rm:*)`, `Bash(jdi:*)`). The same defaults are mirrored by `src/utils/claude.ts` as the spawn-time `--allowedTools` list. This replaces the previous blanket `bypassPermissions`.

```
Agent(
  prompt="You are jdi-programmer. Read .jdi/framework/agents/jdi-programmer.md for instructions. Execute: {task}",
  subagent_type="general-purpose",  ← MUST be "general-purpose"
  mode="acceptEdits"                ← REQUIRED: scoped allowlist in .claude/settings.json
)
```

### Incorrect Patterns (WILL FAIL)

```
Agent(
  prompt="Execute the plan...",
  subagent_type="jdi-programmer"    ← WRONG: Causes classifyHandoffIfNeeded error
)

Agent(
  prompt="Execute the plan...",
  subagent_type="general-purpose"
  # mode omitted                    ← WRONG: Agent blocked on Write/Edit permissions
)
```

### Why This Matters

- The Task tool validates `subagent_type` against a fixed list
- Only `"general-purpose"` is in that list
- Any other value triggers an internal validation error
- The cryptic `classifyHandoffIfNeeded is not defined` message masks this validation failure

---

## How It Works

```
┌──────────────────────────────────────────────────────┐
│ MAIN CONTEXT                                          │
│                                                       │
│  User: /jdi:create-plan "Add user auth"              │
│         │                                             │
│         ▼                                             │
│  ┌──────────────────────┐                            │
│  │ Command Stub (~300)  │ ← Minimal stub             │
│  └──────────┬───────────┘                            │
│             │ Task tool spawns agent                  │
│             ▼                                         │
└──────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────┐
│ AGENT CONTEXT (Isolated, Fresh)                       │
│                                                       │
│  jdi-planner reads spec, researches, creates plan    │
│  → Returns plan_path to main context                  │
└──────────────────────────────────────────────────────┘
```

**create-plan:** Single planner agent (includes research as Step 0).
**implement-plan:** Complexity-routed — single agent for simple plans, Agent Teams swarm for complex plans.

---

## Available Commands

| Command | Type | Description |
|---------|------|-------------|
| `/jdi:init` | Direct | Initialise JDI in current project |
| `/jdi:create-plan` | Agent | Create implementation plan (single planner agent, includes research) |
| `/jdi:implement-plan` | Agent | Execute plan (single agent for simple, Agent Teams for complex) |
| `/jdi:commit` | Agent | Create conventional commit (spawns jdi-committer) |
| `/jdi:generate-pr` | Agent | Generate and create PR (spawns jdi-pr-generator) |
| `/jdi:pr-review` | Agent | Review PR (spawns reviewer) |
| `/jdi:pr-feedback` | Agent | Address PR review comments (spawns jdi-pr-feedback) |
| `/jdi:quick` | Direct | Quick focused change (no orchestration) |
| `/jdi:map-codebase` | Agent | Analyse codebase architecture and conventions (spawns jdi-codebase-mapper) |
| `/jdi:verify` | Agent | Run verification checks (spawns jdi-verifier) |

**Agent commands:** Spawn a Task agent with isolated context (~300 tokens in main)
**Direct commands:** Execute in main context (kept minimal)

---

## Component System

JDI uses **JSX-like component syntax** for referencing reusable markdown:

```markdown
<JDI:Commit />                    # Full component
<JDI:Commit:Message />            # Specific section
<JDI:Commit scope="task" />       # With parameters
```

**How it works:** When agents encounter component references, they:
1. Read the component file from `components/`
2. Execute the instructions within
3. Return to the calling context

Components are **loaded on-demand** by agents, not pre-embedded in commands.

---

## Component Resolution Protocol

**CRITICAL**: When you encounter a `<JDI:ComponentName />` tag anywhere in a spec,
command, hook, or workflow, you MUST:

1. **Parse** the tag to extract the component name, optional section, and parameters.
   - `<JDI:Commit />` -> Component: Commit, Section: (none), Params: (none)
   - `<JDI:StateUpdate:Progress />` -> Component: StateUpdate, Section: Progress, Params: (none)
   - `<JDI:Commit scope="task" />` -> Component: Commit, Section: (none), Params: scope=task

2. **Locate** the component file by searching these directories in order:
   - `.jdi/framework/components/execution/{ComponentName}.md`
   - `.jdi/framework/components/planning/{ComponentName}.md`
   - `.jdi/framework/components/quality/{ComponentName}.md`
   - `.jdi/framework/components/meta/{ComponentName}.md`

3. **Read** the component file using the Read tool.

4. **Execute** the instructions found in the component (or the specified section).
   Apply any parameters from the tag as contextual constraints.

5. **Return** to the calling context and continue execution.

Component tags are NOT decorative markers. They are lazy-loaded instructions
that MUST be resolved and executed at the point where they appear.

---

## State Management

### JSON State Files

| File | Purpose | Updates |
|------|---------|---------|
| `config/jdi-config.yaml` | Global settings | Manual |
| `config/state.yaml` | Runtime state (phase, plan, task) | Automatic |
| `config/variables.yaml` | Shareable variables | Automatic |

### Project State Files

When initialised in a project (`.jdi/`):

| File | Purpose |
|------|---------|
| `PROJECT.yaml` | Project vision and constraints |
| `REQUIREMENTS.yaml` | Scoped requirements with REQ-IDs |
| `ROADMAP.yaml` | Phase structure |
| `state.yaml` | Runtime state (position, session, decisions, blockers) |

---

## Context Budget

| Scenario | Old Pattern | New Pattern | Savings |
|----------|-------------|-------------|---------|
| Single command | ~6,900 tokens | ~300 tokens | 95% |
| 5-command workflow | ~34,500 tokens | ~1,500 tokens | 96% |

**Target:** Keep main context usage minimal. Let agents do heavy work in isolated context.

### Warning Thresholds

| Usage | Status | Action |
|-------|--------|--------|
| <50% | Green | Normal operation |
| 50-70% | Yellow | Reduce verbosity |
| 70-85% | Orange | Essential only |
| >85% | Red | Complete task and pause |

### No Direct Fallback Rule

Agent commands MUST use agent delegation. If agent spawning fails: report error, set state to "blocked", ask user for guidance. NEVER fall back to direct implementation.

---

## Model Profiles

Three profiles control which model each agent uses. Set in `.jdi/config/jdi-config.yaml` under `models.profile`.

| Profile | When to Use | Opus Agents | Token Impact |
|---------|-------------|-------------|--------------|
| **quality** | Critical/complex work | planner, architect, programmer, debugger | Highest — full Opus power |
| **balanced** | Typical development (default) | planner, architect | ~40% less than quality |
| **budget** | Conserve quota | None | ~60% less than quality |

**Budget mode** routes verifier, researcher, phase_researcher, plan_checker, and quality to Haiku — these are agents where thoroughness matters less than speed. Switch mid-session by editing `models.profile` in `.jdi/config/jdi-config.yaml`.

---

## Quick Start

### New Feature

```
1. /jdi:create-plan "Add user authentication"
   → Spawns single planner agent (researches + plans)
   → Creates .jdi/plans/01-01-PLAN.md

2. /jdi:implement-plan
   → Routes by complexity (single agent or Agent Teams swarm)
   → Commits per task

3. /jdi:generate-pr
   → Creates PR with structured description
```

### Quick Commit

```
1. [Make changes]

2. /jdi:commit
   → Stages files individually
   → Creates conventional commit
```

---

## Bootstrap

To add JDI commands to a project:

```
/jdi:init
```

This creates:
- `.claude/commands/jdi/` — Command stubs
- `.jdi/` — Project state directory

---

## Core Rules

1. **Commands are stubs** — Just spawn instructions, not full specs
2. **Agents read on-demand** — Load what they need in their context
3. **State is external** — YAML files, not context pollution
4. **Components are modular** — Reusable across agents
5. **Atomic commits** — One commit per task, staged individually

---

## Prompt Cache Strategy

Agent spawn prompts MUST follow this load order to maximise Anthropic API prompt cache hits:

```
1. AgentBase (core)        ← ALWAYS first (static, cacheable prefix ~180 tokens)
2. AgentBase sections      ← Sandbox/TeamMode if needed (still static)
3. Agent spec              ← Agent-specific instructions (semi-static)
4. Task context            ← Plan path, working directory, task details (dynamic)
```

**Why**: The API caches prompt prefixes. By loading AgentBase as the first ~180 tokens of every agent prompt, all agents after the first get that prefix cached. Subsequent agents in the same session benefit from reduced input billing.

**Batch component loading**: If an agent's spec has `requires_components` in its frontmatter, read ALL listed components before starting execution. This batches file reads into a single turn rather than discovering components mid-execution (saves ~50-100 tokens of tool overhead per component).

---

## Context Longevity

### When to Start a Fresh Conversation

| Signal | Action |
|--------|--------|
| 3+ agent spawns in one conversation | Consider fresh conversation |
| 50+ turns in conversation | Start fresh — history compounds costs |
| After `/jdi:implement-plan` completes | Fresh conversation for PR/commit (state persisted to YAML) |
| Context budget at Orange/Red | Complete current task, then fresh conversation |

**Why**: Each turn re-sends the full conversation history. Later turns cost progressively more tokens. Since JDI persists all state to YAML files, a fresh conversation loses nothing.

---

## Token Budget Reference

### Per-Artefact Estimates

| Artefact | Tokens |
|----------|--------|
| AgentBase (core) | ~180 |
| AgentBase (core + sandbox) | ~320 |
| Average agent spec | ~180 |
| Component section | ~100-200 |
| Full component | ~400-600 |
| Template section | ~50-100 |
| State read | ~200 |

### Per-Workflow Estimates

| Workflow | Main Context | Agent Context |
|----------|-------------|---------------|
| `/jdi:quick` | ~200 tokens | — (direct) |
| `/jdi:commit` | ~500 tokens | ~400 (haiku) |
| `/jdi:create-plan` | ~800 tokens | ~2,000 |
| `/jdi:implement-plan` (simple) | ~800 tokens | ~3,000 |
| `/jdi:implement-plan` (teams) | ~800 tokens | ~2,000 × N |

**If approaching limits**: Switch to `budget` model profile and use section-specific component loading (`<JDI:Component:Section />`).

---

*JDI aka Jedi - Context-efficient development through agent delegation.*
