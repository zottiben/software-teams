---
name: AgentTeamsOrchestration
category: meta
description: Agent Teams orchestration quick-reference
---

# AgentTeamsOrchestration

## Core Pattern (6 Steps)

1. **Pre-flight** — Read command spec, `<JDI:CodebaseContext />`, read state.yaml, set status to "executing"
2. **Create Team** — `TeamCreate(team_name: "{team-name}")`
3. **Create Tasks** — TaskCreate per work unit, set `addBlockedBy` dependencies
4. **Spawn Teammates** — Task tool with `subagent_type: "general-purpose"`. Include in prompt: agent spec path, team context, task assignments
5. **Coordinate** — Automatic message delivery for results, TaskList to monitor, SendMessage to guide/unblock
6. **Cleanup** — shutdown_request to all → TeamDelete → set status "complete" → report

---

## Task Routing Table

| Task Stack | Agent(s) | Spawn Count |
|-----------|----------|-------------|
| PHP only | jdi-backend | 1 |
| TS/React only | jdi-frontend | 1 |
| Full-stack | jdi-backend + jdi-frontend | 2 |
| Config/docs | jdi-backend (default) | 1 |

---

## Specialist Spawn Prompt Template (~200 tokens)

```
You are {agent-name}. Read .jdi/framework/agents/{spec}.md and .jdi/framework/components/meta/AgentBase.md.

TEAM: {team-name}
PLAN: {plan-path}
TASK_FILE: {task-file-path}
WORKING_DIR: {working-directory}

Read your TASK_FILE for task details (objective, files, steps, verification).
If TASK_FILE is not provided (legacy plan), claim tasks from TaskList and read task details from the PLAN file.

1. Implement using Edit tool
2. SendMessage to coordinator with structured return
3. Mark task completed via TaskUpdate

Report: files_modified, files_to_create, commits_pending.
No git commit (use commits_pending).
```

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
