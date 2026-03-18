---
name: create-plan
description: "JDI: Create implementation plan"
---

# /jdi:create-plan

Create an implementation plan using a single planner agent (includes research).

## Flags

- `--worktree` — Create git worktree with full environment before planning (follow `.claude/commands/jdi/worktree.md` steps)
- `--worktree-lightweight` — Same but skip databases/web server (deps + migrate only)

> **Do NOT use the built-in `EnterWorktree` tool.** Always follow `/jdi:worktree` Direct Execution steps.

## Orchestration

1. **Worktree** (if flagged): derive name from task, follow worktree.md steps, `cd` into `.worktrees/<name>`
2. Read codebase context (`.jdi/codebase/SUMMARY.md` if exists)
3. Read scaffolding (.jdi/PROJECT.yaml, REQUIREMENTS.yaml, ROADMAP.yaml) — create from templates if missing
4. Quick Mode Detection — suggest /jdi:quick for trivial tasks
5. Spawn `jdi-planner` agent (subagent_type="general-purpose") — creates PLAN.md with tasks, deps, waves
6. Collect and execute deferred ops
7. **Update state via CLI** — do NOT manually edit state.yaml. Run:
   ```bash
   npx jdi state plan-ready --plan-path ".jdi/plans/{plan-file}" --plan-name "{plan name}"
   ```
8. **Present summary** (name, objective, task table, files) then ask: _"Provide feedback to refine, or say **approved** to finalise."_
9. **Review loop**: Feedback → revise plan in-place, increment revision, re-present summary. Repeat until approved. Approval → run `npx jdi state approved`, then **STOP**.

## HARD STOP — Planning Gate

After the user approves the plan, your work is **DONE**. Output: _"Plan approved and finalised. Run `/jdi:implement-plan` when ready to execute."_ Then **STOP completely**. Do NOT invoke `/jdi:implement-plan`, do NOT spawn implementation agents, do NOT begin writing source code. Planning and implementation are separate human-gated phases.

Agent base (read FIRST for cache): .jdi/framework/components/meta/AgentBase.md | Agent spec: .jdi/framework/agents/jdi-planner.md

Feature to plan: $ARGUMENTS
