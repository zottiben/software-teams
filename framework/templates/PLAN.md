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

# Split plan task files (omit for legacy monolithic plans)
task_files:
  - .jdi/plans/{X}-{YY}-{plan-slug}.T1.md
  - .jdi/plans/{X}-{YY}-{plan-slug}.T2.md

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
---

# Phase {X} Plan {YY}: {Plan Name}

---

## Objective

{One paragraph describing what this plan accomplishes. Be specific about the outcome.}

---

## Context

**Read before executing:**
- @{path/to/relevant/file}
- @{path/to/another/file}

**Relevant patterns:**
- {Pattern to follow}

**Previous work:**
- {What's already done that this builds on}

</section>

---

<section name="TaskManifest">

## Tasks

| Task | Name | Type | Wave | File |
|------|------|------|------|------|
| T1 | {Task Name} | auto | 1 | `{X}-{YY}-{plan-slug}.T1.md` |
| T2 | {Task Name} | auto | 1 | `{X}-{YY}-{plan-slug}.T2.md` |
| T3 | {Task Name} | checkpoint:human-verify | 2 | `{X}-{YY}-{plan-slug}.T3.md` |

> Task details are in individual files. See `task_files` in frontmatter.

</section>

---

<section name="Verification">

## Verification

After all tasks complete, verify:

- [ ] {Overall verification 1}
- [ ] {Overall verification 2}
- [ ] Tests pass: `{test command}`
- [ ] Types check: `{type check command}`

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

**SUMMARY location:** `.jdi/plans/{phase}-{plan}-{slug}.summary.md`

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
