---
plan_id: {phase}-{plan}
slug: {plan-slug}
tier: orchestration
spec_link: {slug}.spec.md
available_agents: []
primary_agent: general-purpose
---

# {Feature Name} — Orchestration

> **Tier 2 of 3** (the HOW). The orchestrator's playbook for executing the
> spec at `{slug}.spec.md`. Per-agent slices live in `{slug}.T{n}.md` files.
> Keep this file scoped to sequencing, agent routing, and gates — no
> implementation steps (those live in the per-agent slices).

## Task Graph

```mermaid
graph TD
  T1[T1: {short name}] --> T3
  T2[T2: {short name}] --> T3
  T3[T3: {short name}] --> T4
  T4[T4: {short name}]
```

## Tasks

| ID | Name | Agent | Wave | Depends On | Slice |
|----|------|-------|------|------------|-------|
| T1 | {Task name} | software-teams-{role} | 1 | — | `{slug}.T1.md` |
| T2 | {Task name} | software-teams-{role} | 1 | — | `{slug}.T2.md` |
| T3 | {Task name} | software-teams-{role} | 2 | T1, T2 | `{slug}.T3.md` |
| T4 | {Task name} | software-teams-qa-tester | 3 | T3 | `{slug}.T4.md` |

## Sequencing Rules

Wave gates and parallel-safety rules. The orchestrator uses these to decide
what may run concurrently and where to checkpoint.

- **Wave gates:** all tasks in wave N must complete before any task in wave
  N+1 starts. {note any exception}.
- **Parallel-safe groups:** {list groups of task IDs that may run in parallel
  within a single wave because they touch disjoint files / subsystems}.
- **Serial-only:** {list task IDs that must run alone — e.g. migrations,
  shared-config edits, anything mutating state.yaml}.
- **Checkpoints:** {tasks of `type: checkpoint:*` that pause for human/QA
  approval before the next wave proceeds}.

## Quality Gates

Triggered by the implement-plan skill at well-known points. Configure per
plan; defaults shown.

- **post-task-verify** — after every code-touching task: spawn
  `software-teams-qa-tester` (mode: `task-verify`) to confirm the task's `done_when`
  criteria hold. Failure → rework before next task.
- **contract-check** — after any task that modifies an API surface, types,
  or shared schema: run `bun run build` + the contract suite. Failure
  blocks the wave.
- **a11y-check** — after any task that touches user-facing UI: spawn
  `software-teams-frontend` (mode: `a11y-audit`). Failure → ticket and continue or
  block per task `priority`.
- **post-wave-integration** — after each wave: run the full test suite
  (`bun test`) plus a smoke pass over the `provides:` deliverables.

## When to Move On

Explicit done-criteria the orchestrator uses to decide a task is finished
and the next task may start. Prevents the loop from stalling on subjective
judgement.

- A task is **done** when its `done_when:` block is satisfied AND its
  `Verification:` checklist passes AND any quality gate above triggered by
  this task passes.
- A task is **blocked** when {explicit blocker condition — e.g. an upstream
  `provides` is missing, an external dependency is unreachable}. Escalate to
  the user; do not skip silently.
- A wave is **done** when all its tasks are done and the
  `post-wave-integration` gate passes. Only then start wave N+1.

## Risks

Pull from the `risks` block in `.software-teams/requirements.yaml`. List the entries
relevant to this plan so the orchestrator can re-check them at each gate.

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R-{n} | {short description} | low/med/high | low/med/high | {action} |
