---
name: implement-plan
description: "JDI: Execute implementation plan"
---

# /jdi:implement-plan

Execute a PLAN.md with complexity-based routing.

> **Do NOT use the built-in `EnterWorktree` tool.** If `state.yaml` has `worktree.active: true`, just `cd` into `worktree.path`.

## Orchestration

1. Read codebase context (`.jdi/codebase/SUMMARY.md` if exists)
2. Read plan index file and state.yaml — parse frontmatter for tasks, deps, waves, tech_stack
3. **Format detection:** If frontmatter contains `task_files:`, this is a split plan — task details are in separate files. If absent, legacy monolithic plan — all tasks inline.
4. **Complexity routing** (`<JDI:ComplexityRouter />`): Simple (≤3 tasks, single stack/wave) → single agent. Complex → Agent Teams swarm. Override: `--team` / `--single`
5. **Tech routing**: PHP → jdi-backend | TS/React → jdi-frontend | Full-stack → both
6. Execute:
   - **Single agent:** Pass `PLAN: {index-path}`. For split plans, agent reads task files one at a time via `file:` field in state.yaml.
   - **Agent Teams:** For split plans, pass `TASK_FILE: {task-file-path}` in each agent's spawn prompt so they load only their assigned task file(s). For legacy plans, pass `PLAN: {plan-path}` as before.
7. Collect and execute deferred ops (files, commits)
8. Run verification (tests, lint, typecheck)
9. Cleanup → update state
10. Initialise review: `review.status` → `"draft"`, `review.revision` → 1, `review.scope` → `"implementation"`
11. **Present summary** (tasks completed, files changed, verification results, deviations) then ask: _"Provide feedback to adjust, or say **approved** to finalise."_
12. **Review loop**: approval → update state to `"complete"`, suggest commit/PR. Feedback → apply code changes, run tests, increment revision, re-present. Repeat until approved. Natural conversation — no separate command needed.

Agent base (read FIRST for cache): ./components/meta/AgentBase.md | Agent specs: ./agents/jdi-backend.md, ./agents/jdi-frontend.md
Orchestration: ./components/meta/AgentTeamsOrchestration.md | Routing: ./components/meta/ComplexityRouter.md

When spawning agents, detect project type and include a `## Project Context` block (type, tech stack, quality gates, working directory) in the spawn prompt. This saves agents 2-3 discovery tool calls.

Plan to execute: $ARGUMENTS
