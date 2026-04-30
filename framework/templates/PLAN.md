<!--
  Single-tier plan template (legacy / quick path).

  As of plan 1-01 (native subagents) the default for non-trivial plans is the
  three-tier spec-kit-style flow:
    - SPEC.md             — the WHAT (acceptance criteria, out-of-scope)
    - ORCHESTRATION.md    — the HOW (task graph, agent routing, gates)
    - PLAN-TASK-AGENT.md  — per-agent slice (one file per task)

  Use three-tier when: >3 implementation tasks, cross-team work, or any plan
  whose orchestration would crowd out the spec.

  Use single-tier (this PLAN.md + PLAN-TASK.md per task) for: `/st:quick`
  flows, hotfixes, and plans with 1-3 tasks where a separate SPEC tier adds
  more ceremony than clarity.

  See framework/templates/README.md for the full decision matrix.
-->

<section name="Frontmatter">

---
phase: {X}
plan: {YY}
name: {Plan Name}
slug: {plan-slug}
type: implementation
autonomous: true
wave: 1
gap_closure: false
sprint_goal: ""
carryover: []

# Split plan task files (omit for legacy monolithic plans)
task_files:
  - .software-teams/plans/{X}-{YY}-{plan-slug}.T1.md
  - .software-teams/plans/{X}-{YY}-{plan-slug}.T2.md

# Dependency Graph (enables context assembly and parallel execution)
requires:
  - phase: {N}
    provides: [dependency1, dependency2]
provides: [deliverable1, deliverable2]
affects: [{future-phase-1}, {future-phase-2}]

# Semantic Indexing (enables fast scanning and context selection)
subsystem: {auth|api|ui|data|infra|docs|test}
tags: [tag1, tag2, tag3]

# Tech Tracking
tech_stack:
  added: []
  patterns: []

# Agent Routing (populated by software-teams-planner via AgentRouter)
# available_agents is the catalogue discovered from .claude/agents/ at plan time.
# primary_agent is used by single-agent mode in implement-plan.
# Per-task agents live in each {slug}.T{n}.md file under `agent:`.
available_agents: []
primary_agent: general-purpose
---

# Phase {X} Plan {YY}: {Plan Name}

---

## Objective

{One paragraph describing what this plan accomplishes. Be specific about the outcome.}

---

## Sprint Goal

{One sentence describing what this plan achieves toward the active milestone.}

---

## Context

**Read before executing:**
- @{path/to/relevant/file}
- @{path/to/another/file}

**Relevant patterns:**
- {Pattern to follow}

**Previous work:**
- {What's already done that this builds on}

### Carryover

| Task | Source Plan | Reason | New Estimate |
|------|-------------|--------|--------------|

### Risks

Risks should be pulled from the `risks` block in `.software-teams/REQUIREMENTS.yaml`. List the relevant ones here for execution-time reference.

</section>

---

<section name="TaskManifest">

## Tasks

| Task | Name | Size | Type | Wave | File |
|------|------|------|------|------|------|
| T1 | {Task Name} | S | auto | 1 | `{X}-{YY}-{plan-slug}.T1.md` |
| T2 | {Task Name} | M | auto | 1 | `{X}-{YY}-{plan-slug}.T2.md` |
| T3 | {Task Name} | S | checkpoint:human-verify | 2 | `{X}-{YY}-{plan-slug}.T3.md` |
| T4 | Tests for wave 1: {impl task names} | M | test | 2 | `{X}-{YY}-{plan-slug}.T4.md` |

> Task details are in individual files. See `task_files` in frontmatter.
>
> Test tasks (type: test) are auto-generated when a test suite is detected or `--with-tests` is used. They are placed in wave N+1 and depend on all implementation tasks in wave N.

</section>

---

<section name="Verification">

## Verification

After all tasks complete, verify:

- [ ] {Overall verification 1}
- [ ] {Overall verification 2}
- [ ] Tests pass: `{test command}`
- [ ] Types check: `{type check command}`

## Definition of Done

- [ ] All Must Have tasks complete
- [ ] All tasks pass acceptance criteria
- [ ] No S1/S2 bugs (per software-teams-quality taxonomy)
- [ ] REQUIREMENTS.yaml updated for deviations

## Success Criteria

This plan is complete when:

1. {Observable outcome 1}
2. {Observable outcome 2}
3. All tasks have commits
4. Verification checks pass

## Output

**Creates:**
- `{path/to/new/file}` - {purpose}

**Modifies:**
- `{path/to/existing/file}` - {what changes}

**SUMMARY location:** `.software-teams/plans/{phase}-{plan}-{slug}.summary.md`

## Notes

{Any additional context, warnings, or guidance for execution}

</section>

---

<section name="DeviationRules">

## Deviation Rules Reference

During execution, apply automatically:
- **Rule 1**: Auto-fix bugs
- **Rule 2**: Auto-add critical functionality
- **Rule 3**: Auto-fix blocking issues
- **Rule 4**: Ask about architectural changes

Document all deviations in SUMMARY.md.

</section>
