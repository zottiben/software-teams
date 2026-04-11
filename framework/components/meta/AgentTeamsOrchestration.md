---
name: AgentTeamsOrchestration
category: meta
description: Agent Teams orchestration quick-reference
---

# AgentTeamsOrchestration

## Core Pattern (6 Steps)

1. **Pre-flight** — Read command spec, `<JDI:CodebaseContext />`, read state.yaml, set status to "executing". Read each task file's `agent:` frontmatter field so you know which specialist to spawn per task (see `.jdi/framework/components/meta/AgentRouter.md`).
2. **Create Team** — `TeamCreate(team_name: "{team-name}")`
3. **Create Tasks** — TaskCreate per work unit, set `addBlockedBy` dependencies
4. **Spawn Teammates** — Task tool with `subagent_type: "{task.agent}"` (the pin from the task file frontmatter — e.g. `unity-ui-specialist`, `gameplay-programmer`). Never hardcode `general-purpose` when a pin exists. Verify the pinned agent is installed before spawning; if not, downgrade to `general-purpose` and record `agent_downgrade:` in the summary. Include in prompt: agent spec path, team context, task assignments. **Scope tightly** — one task per spawn, exact file targets, capped exploration, short reports (<400 words). See `AgentBase.md` § Budget Discipline.
5. **Coordinate** — Automatic message delivery for results, TaskList to monitor, SendMessage to guide/unblock
6. **Cleanup** — shutdown_request to all → TeamDelete → set status "complete" → report (include which specialist ran which task and any downgrade events)

---

## Task Routing Table

**Primary source of truth:** each task's `agent:` frontmatter field, assigned
by `jdi-planner` via `AgentRouter` at plan time. The table below is the
**fallback** used only when a task has no pin (legacy plans or empty
`available_agents`).

| Task Stack (fallback) | Agent(s) | Spawn Count |
|-----------|----------|-------------|
| PHP only | jdi-backend | 1 |
| TS/React only | jdi-frontend | 1 |
| Full-stack | jdi-backend + jdi-frontend | 2 |
| Config/docs | jdi-backend (default) | 1 |

**Examples of honouring pins** (real values — not fallbacks):

| Task pin | Subagent type passed to Task tool |
|----------|-----------------------------------|
| `agent: unity-specialist` | `unity-specialist` |
| `agent: unity-ui-specialist` | `unity-ui-specialist` |
| `agent: gameplay-programmer` | `gameplay-programmer` |
| `agent: qa-tester` | `qa-tester` |
| `agent: ue-gas-specialist` | `ue-gas-specialist` |
| `agent: godot-gdscript-specialist` | `godot-gdscript-specialist` |

---

## Specialist Spawn Prompt Template (~200 tokens)

```
You are {task.agent}. Your Claude Code agent definition has already been
loaded from .claude/agents/{task.agent}.md (or ~/.claude/agents/{task.agent}.md)
— follow it. Also read .jdi/framework/components/meta/AgentBase.md for the
JDI base protocol. If your Claude Code agent definition has requires_components
in frontmatter, batch-read them before starting.

TEAM: {team-name}
PLAN: {plan-path}
TASK_FILE: {task-file-path}
WORKING_DIR: {working-directory}

Read your TASK_FILE for task details (objective, files, steps, verification,
and the `agent_rationale` explaining why you were picked for this task).
If TASK_FILE is not provided (legacy plan), claim tasks from TaskList and read
task details from the PLAN file.

1. Implement using Edit tool
2. SendMessage to coordinator with structured return
3. Mark task completed via TaskUpdate

Report: files_modified, files_to_create, commits_pending.
No git commit (use commits_pending).
```

The `subagent_type` passed to the Task tool is the `agent:` pin from the task
file frontmatter — NOT `general-purpose`. See
`.jdi/framework/components/meta/AgentRouter.md` for full rules.

---

## Deferred Operations Checklist

After all specialist tasks complete:

1. **Collect** — Aggregate `files_modified`, `files_to_create`, `commits_pending` from all SendMessage results
2. **Create files** — Write tool for each `files_to_create` entry
3. **Execute commits** — `git add` + `git commit` for each `commits_pending` entry
4. **Record hashes** — Store real commit hashes in state.yaml
5. **Verify** — Confirm all `files_modified` are present in working tree

---

## Team Lifecycle

```
TeamCreate → Spawn agents → Monitor (auto message delivery) →
Collect results → Deferred ops → shutdown_request → TeamDelete
```
