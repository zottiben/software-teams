---
name: StateUpdate
category: meta
description: Update state.yaml and STATE.md with current progress and position
params:
  - name: phase
    type: string
    required: false
    description: Phase number to set
  - name: plan
    type: string
    required: false
    description: Plan number to set
  - name: task
    type: string
    required: false
    description: Task number to set
  - name: status
    type: string
    required: false
    options: ["idle", "planning", "executing", "verifying", "complete", "blocked", "error"]
    description: Current status to set
  - name: fields
    type: array
    required: false
    description: Specific YAML paths to update (e.g. ["position.status", "session.last_activity"])
---

# StateUpdate

Update JDI state files to track current progress and position.

## Update Pattern (applies to ALL sections)

1. **Read** the target file with the Read tool
2. **Modify** only the specified fields (preserve everything else)
3. **Write** the complete file back with the Write tool

---

## File Paths

| File | Purpose |
|------|---------|
| `.jdi/config/state.yaml` | Runtime state (position, session, decisions, blockers) |
| `.jdi/config/variables.yaml` | Runtime variables (feature metadata, implementation tracking) |

> These are RUNTIME files in `.jdi/`, NOT templates in `.jdi/framework/config/`. If `.jdi/config/` does not exist, create it and copy templates.

---

## Default Behaviour

When invoked as `<JDI:StateUpdate />`: update `session.last_activity` to current ISO timestamp.

---

<section name="Position">

## Position Update

Update fields in `.jdi/config/state.yaml`:

```json
{
  "position": {
    "phase": "{phase}",
    "phase_name": "{from ROADMAP.yaml}",
    "plan": "{plan}",
    "plan_name": "{from PLAN.md}",
    "task": "{task}",
    "task_name": "{from plan}",
    "status": "{status}"
  }
}
```

Names are resolved from ROADMAP.yaml and current plan index file.

### Task Entry Schema

Each task in `current_plan.tasks` supports these fields:

```yaml
- id: "{phase}-{plan}-T{n}"
  name: "{Task Name}"
  type: auto | checkpoint:human-verify | checkpoint:decision | checkpoint:human-action
  wave: 1
  status: pending | in_progress | complete | blocked
  file: ".jdi/plans/{phase}-{plan}-{slug}.T{n}.md"  # optional — present for split plans only
```

The `file:` field points to the individual task file. When present, agents read task details from this file instead of the monolithic plan. When absent (legacy plans), task details are inline in the plan file.

</section>

---

<section name="Decisions">

## Record Decision

Append to `decisions` array in `state.yaml`:

```json
{
  "timestamp": "{ISO}",
  "phase": "{phase}",
  "decision": "{description}",
  "rationale": "{why}",
  "impact": "{what it affects}"
}
```

Also append to STATE.md decisions table: `| {date} | {phase} | {decision} | {rationale} |`

</section>

---

<section name="Blocker">

## Record Blocker

Append to `blockers` array in `state.yaml`:

```json
{
  "timestamp": "{ISO}",
  "type": "technical|external|decision",
  "description": "{what's blocked}",
  "impact": "{what can't proceed}",
  "resolution": null
}
```

STATE.md: Add `- [ ] **{type}**: {description}` with impact and date. When resolved: `- [x]` with resolution.

</section>

---

<section name="Deviation">

## Record Deviation

Append to `deviations` array in `state.yaml`:

```json
{
  "timestamp": "{ISO}",
  "rule": "Rule 1|Rule 2|Rule 3|Rule 4",
  "description": "{what deviated}",
  "reason": "{why}",
  "task": "{task context}",
  "files": ["{affected files}"]
}
```

Deviation rules: 1=Auto-fixed bug, 2=Auto-added critical functionality, 3=Auto-fixed blocking issue, 4=Asked about architectural change.

</section>

---

<section name="QuickUpdate">

## Quick Field Update

For single-field or few-field updates, use targeted access instead of full-file read-modify-write:

1. Read only the relevant YAML block from state.yaml (e.g., `position:` block)
2. Update the specific field(s)
3. Write back only the changed block using Edit tool

Examples:
- `<JDI:StateUpdate fields="position.status" />` — read position block, update status
- `<JDI:StateUpdate fields="session.last_activity" />` — update timestamp only
- `<JDI:StateUpdate fields="progress.tasks_completed,progress.plans_completed" />` — batch update counters

This avoids reading/writing the full state file (~110 lines) for trivial updates.

</section>

---

<section name="Session">

> **Session Management**: Update `session.last_activity` to current ISO timestamp.

</section>
