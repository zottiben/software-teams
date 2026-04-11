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
2. Read plan index file and state.yaml — parse frontmatter for tasks, deps, waves, tech_stack, `available_agents`, and `primary_agent`
3. **Read learnings:** Always read `.jdi/framework/learnings/general.md`. Then read domain-specific learnings based on tech_stack from plan frontmatter: PHP → `backend.md`, TS/React → `frontend.md`. Follow any conventions found — learnings override defaults.
4. **Format detection:** If frontmatter contains `task_files:`, this is a split plan — task details are in separate files. If absent, legacy monolithic plan — all tasks inline.
5. **Read per-task agents (MANDATORY for split plans)** — for every task file listed in `task_files`, read its frontmatter and record the `agent:` field. This is the `subagent_type` you will pass to the Task tool when spawning. Missing `agent:` → fall back to `primary_agent` → fall back to tech-stack default (`jdi-backend` / `jdi-frontend` / `general-purpose`). NEVER default everything to `general-purpose` silently. See `.jdi/framework/components/meta/AgentRouter.md`.
6. **Agent existence check** — for each pinned agent, confirm it is actually installed (`.claude/agents/{name}.md` project-local, or `~/.claude/agents/{name}.md` user-global). If it is NOT installed, downgrade to `general-purpose` and record a `agent_downgrade:` entry to surface in the summary. Never silently change the pin.
7. **Complexity routing** (`<JDI:ComplexityRouter />`): Simple (≤3 tasks, single stack/wave) → single agent. Complex → Agent Teams swarm. Override: `--team` / `--single`
8. **Tech routing (fallback only when no pins exist)**: PHP → jdi-backend | TS/React → jdi-frontend | Full-stack → both. Pins ALWAYS override this fallback.
9. Execute:
   - **Single agent:** Spawn with `subagent_type: {plan.primary_agent}` (NOT `general-purpose`). Pass `PLAN: {index-path}`. For split plans, the agent reads task files one at a time via `file:` field in state.yaml.
   - **Agent Teams:** For split plans, spawn ONE Task tool call per task with `subagent_type: {task.agent}` (the pin from the task file frontmatter), passing `TASK_FILE: {task-file-path}` so it loads only its assigned task. For legacy plans, pass `PLAN: {plan-path}` and use `primary_agent`.
   - **Prompt scoping** — one task = one spawn. Never bundle multiple tasks into one prompt. Give exact file paths, cap exploration ("read only your TASK_FILE + its named targets"), and request short reports (<400 words). Agents can be truncated mid-task; scoped prompts survive the budget ceiling.
10. Collect and execute deferred ops (files, commits)
11. Run verification (tests, lint, typecheck)
12. **Update state via CLI** — do NOT manually edit state.yaml. Run `npx jdi state executing` before execution and `npx jdi state complete` after. Use `npx jdi state advance-task {task-id}` after each task completes.
13. **Present summary** (tasks completed, files changed, verification results, **which specialist ran which task**, any `agent_downgrade` events, deviations) then ask: _"Provide feedback to adjust, or say **approved** to finalise."_
14. **Review loop**: Feedback → apply code changes, run tests, increment revision, re-present. Approval → suggest commit/PR. Natural conversation — no separate command needed.

Agent base (read FIRST for cache): .jdi/framework/components/meta/AgentBase.md | Agent specs: .jdi/framework/agents/jdi-backend.md, .jdi/framework/agents/jdi-frontend.md
Orchestration: .jdi/framework/components/meta/AgentTeamsOrchestration.md | Routing: .jdi/framework/components/meta/ComplexityRouter.md | Agent routing: .jdi/framework/components/meta/AgentRouter.md

When spawning agents, detect project type and include a `## Project Context` block (type, tech stack, quality gates, working directory) in the spawn prompt. This saves agents 2-3 discovery tool calls.

Plan to execute: $ARGUMENTS
