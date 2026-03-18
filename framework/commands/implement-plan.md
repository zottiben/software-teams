---
name: implement-plan
description: "JDI: Execute implementation plan"
---

# /jdi:implement-plan

Execute a PLAN.md with complexity-based routing.

**Flags:** `--team` (force Agent Teams) | `--single` (force single agent) | `--dry-run` (preview without writing)

> **Do NOT use the built-in `EnterWorktree` tool.** If `state.yaml` has `worktree.active: true`, just `cd` into `worktree.path`.

## Orchestration

1. Read codebase context (`.jdi/codebase/SUMMARY.md` if exists)
2. Read plan index file and state.yaml — parse frontmatter for tasks, deps, waves, tech_stack
3. **Read learnings:** Always read `.jdi/framework/learnings/general.md`. Then read domain-specific learnings based on tech_stack from plan frontmatter: PHP → `backend.md`, TS/React → `frontend.md`. Follow any conventions found — learnings override defaults.
4. **Format detection:** If frontmatter contains `task_files:`, this is a split plan — task details are in separate files. If absent, legacy monolithic plan — all tasks inline.
5. **Complexity routing** (`<JDI:ComplexityRouter />`): Simple (≤3 tasks, single stack/wave) → single agent. Complex → Agent Teams swarm. Override: `--team` / `--single`
6. **Tech routing**: PHP → jdi-backend | TS/React → jdi-frontend | Full-stack → both
7. Execute:
   - **Single agent:** Pass `PLAN: {index-path}`. For split plans, agent reads task files one at a time via `file:` field in state.yaml.
   - **Agent Teams:** For split plans, pass `TASK_FILE: {task-file-path}` in each agent's spawn prompt so they load only their assigned task file(s). For legacy plans, pass `PLAN: {plan-path}` as before.
8. Collect and execute deferred ops (files, commits)
9. Run verification (tests, lint, typecheck)
10. **Update state via CLI** — do NOT manually edit state.yaml. Run `npx jdi state executing` before execution and `npx jdi state complete` after. Use `npx jdi state advance-task {task-id}` after each task completes.
11. **Present summary** (tasks completed, files changed, verification results, deviations) then ask: _"Provide feedback to adjust, or say **approved** to finalise."_
12. **Review loop**: Feedback → apply code changes, run tests, increment revision, re-present. Approval → suggest commit/PR. Natural conversation — no separate command needed.

Agent base (read FIRST for cache): .jdi/framework/components/meta/AgentBase.md | Agent specs: .jdi/framework/agents/jdi-backend.md, .jdi/framework/agents/jdi-frontend.md
Orchestration: .jdi/framework/components/meta/AgentTeamsOrchestration.md | Routing: .jdi/framework/components/meta/ComplexityRouter.md

When spawning agents, detect project type and include a `## Project Context` block (type, tech stack, quality gates, working directory) in the spawn prompt. This saves agents 2-3 discovery tool calls.

Plan to execute: $ARGUMENTS
