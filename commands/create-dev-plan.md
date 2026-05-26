---
name: create-dev-plan
description: "Software Teams: Generate a human-readable developer guide (single markdown file, no YAML envelopes) that a developer follows step-by-step."
allowed-tools: Read, Glob, Bash, Write, Edit, Task
argument-hint: "<feature to write a guide for>"
---

# /st:create-dev-plan

Generate a single human-readable Markdown developer guide for a feature.
The guide is written for a developer who will read it top-to-bottom and
write the code themselves — NOT for agent orchestration. If you want an
agent-executed plan instead, use `/st:create-plan`.

**This skill follows `@ST:StrictnessProtocol`. Read that component before
executing any step below.**

---

## Orchestration

The steps below are numbered and ordered. Do NOT skip, merge, or reorder
them. Each step ends with a clear state transition — if you cannot
produce that transition, STOP and ask.

### 1. Argument Validation

`$ARGUMENTS` must be a non-empty string describing the feature. If empty,
print: `Usage: /st:create-dev-plan "<feature to write a guide for>"` and
STOP.

### 2. Output Directory

Ensure `.software-teams/human-plans/` exists. Create it via
`mkdir -p .software-teams/human-plans` if absent. Do NOT create any
sibling directory and do NOT touch `.software-teams/plans/`.

### 3. Spawn the dev-planner

Spawn `software-teams-dev-planner` via
`Task(subagent_type="software-teams-dev-planner", description="Write developer guide for <feature>", prompt=...)`.

The spawn prompt MUST include:

- The feature description (`$ARGUMENTS`)
- The instruction: _"Write ONE human-readable markdown file to
  `.software-teams/human-plans/<slug>.md`. NO YAML frontmatter. NO
  three-tier artefacts. Cover the 10 required topics listed in your
  agent spec. Follow the seven-part per-step structure for every
  numbered step. Insert stop-and-check gates at section boundaries.
  STOP when the file is written — do NOT spawn other agents, do NOT
  begin implementation."_
- The current working directory so the agent knows where
  `.software-teams/human-plans/` is.

### 4. Verify the agent's output

Read `.software-teams/human-plans/` and confirm exactly one new file
matches the slug. If the agent wrote zero files, STOP and report failure
(do not retry — the agent's exit was a contract violation). If the agent
wrote multiple files, STOP and report (the agent must produce ONE file
only).

Open the written file and confirm:

- It does NOT begin with `---` (no YAML frontmatter — AC4).
- It contains at least one fenced bash block with a `STOP.` gate (AC6).
- It contains numbered steps (AC5).

If any check fails, STOP and report the gap to the user. Do NOT
advance.

### 5. Present completion message

Output exactly:

    Developer guide written to `.software-teams/human-plans/<slug>.md`.
    Open the file and start at step 1.

Then STOP completely.

- Do NOT invoke `/st:implement-plan`.
- Do NOT spawn implementation agents.
- Do NOT begin writing source code.
- Do NOT advance the state machine. This skill does NOT touch state.yaml.

The dev-plan skill produces an informational artefact and exits.

---

## Edge Cases

Pre-written responses for known deviations. When one applies, follow the
scripted response rather than improvising.

| Situation | Response |
|-----------|----------|
| `$ARGUMENTS` is empty | Print usage and STOP. Do not spawn the agent. |
| `.software-teams/` does not exist | Print "Run `software-teams init` first — this skill needs the `.software-teams/` scaffold to exist." and STOP. |
| The agent's output already exists at the target path | Overwrite is the contract. Inform the user in the completion message: "Overwrote existing guide." |
| The agent wrote zero files | STOP, report the contract violation. Do not retry automatically — the user re-invokes. |
| The agent wrote a file with YAML frontmatter | STOP, report AC4 violation. Tell the user the agent produced the wrong shape; they should re-invoke or open an issue. |
| The user asks for an agent-orchestration plan during this skill | Redirect: "This skill produces a human guide. For an agent-executed plan, run `/st:create-plan \"<feature>\"`." Do not auto-switch. |
| The user asks to implement after the guide is written | Remind them: "This guide is for you to read and execute manually. Open the file and start at step 1." Do NOT auto-implement. |

---

## HARD STOP — Generation Gate

After the guide is written and the completion message is printed, your
work is **DONE**.

- Do NOT invoke `/st:implement-plan`.
- Do NOT spawn implementation agents.
- Do NOT begin writing source code.
- Do NOT suggest follow-up commands beyond the one-line completion
  message.

The human guide is the deliverable. The developer reads it and decides
what to do next. This gate exists because past sessions have drifted
into implementation immediately after generation, producing work the
user did not sanction.

---

## Collaborative Protocol

@ST:StrictnessProtocol

---

**References:** Agent spec: `.claude/agents/software-teams-dev-planner.md` |
Existing planner sibling (do NOT modify): `commands/create-plan.md`

**Feature to write a guide for:** $ARGUMENTS
