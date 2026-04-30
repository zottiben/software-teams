---
plan_id: {phase}-{plan}
task_id: {phase}-{plan}-T{n}
tier: per-agent
spec_link: {slug}.spec.md
orchestration_link: {slug}.orchestration.md

# Task classification (same fields as PLAN-TASK.md)
type: auto
size: M
priority: should
wave: 1
depends_on: []
requires: []
provides: []
affects: []
subsystem: {auth|api|ui|data|infra|docs|test}
tags: []

# Agent routing (written by jdi-planner via AgentRouter — see
# framework/components/meta/AgentRouter.md). implement-plan reads `agent` and
# passes it as `subagent_type` when spawning via the Task tool.
agent: jdi-{role}
agent_rationale: "{Why this specialist was chosen for this slice}"
---

# Task {n}: {Task Name}

**Why this slice:** {one line — what this task contributes to the spec; how it
moves an Acceptance Criterion from unchecked to checked}

**Read first:** {only the spec/orchestration sections this agent needs, e.g.
"SPEC §Acceptance Criteria items 2-3, ORCHESTRATION §Quality Gates →
contract-check"}. Do NOT load the full spec or full orchestration unless
explicitly listed here — keep the slice tight.

**Objective:** {What this task accomplishes — one paragraph}

**Files:**
- `{path/to/file.ts}` - {what changes}
- `{path/to/file2.ts}` - {what changes}

**Implementation:**
1. {Step 1}
2. {Step 2}
3. {Step 3}

**Verification:**
- [ ] {Check 1}
- [ ] {Check 2}

**Done when:**
- {Specific, observable completion criterion — must be checkable by a
  reviewer who only reads this slice plus the linked spec section}
