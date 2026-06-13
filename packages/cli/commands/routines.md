---
name: routines
description: "Software Teams: Recommended recurring routines (/loop, /schedule) + handy Claude Code commands"
allowed-tools: Read, Bash
argument-hint: "[recipe]"
---

# /st:routines

Set up recurring Software Teams tasks from inside Claude Code. Three mechanisms,
pick by where you want them to run:

| Mechanism | Runs | Survives machine off? | Use for |
|-----------|------|-----------------------|---------|
| **`/loop <interval> <cmd>`** | locally, in this session | no | polling during a run (e.g. watch CI), short-lived loops |
| **`/schedule`** (cloud routines) | Anthropic cloud cron | yes | nightly/periodic ST tasks without a server |
| **n8n nodes** | your self-hosted n8n | yes | full server-side orchestration, Slack HITL, GitHub triggers |

For heavy server-side automation, prefer the **n8n** integration (it already
drives ST end-to-end). `/loop` and `/schedule` are the no-server options.

## Recommended recipes

- **Poll CI during a long implement** (local, this session):
  `/loop 90s check the latest CI run for this branch and report pass/fail`
- **Nightly: fold merged-PR learnings into the rules** (cloud):
  `/schedule` → run `/st:pr-feedback <recently-merged-pr>` so `software-teams-feedback-learner` promotes new rules into `.software-teams/rules/`.
- **Babysit open PRs** (cloud or local): periodically run `/st:pr-review <pr>` on your open PRs.
- **Refresh the codebase map** (cloud): periodically regenerate `.software-teams/codebase/summary.md`.

## Direct Execution

### Step 1: Resolve the CLI (only if a recipe runs an ST command)

Resolve the CLI per `commands/_shared/cli-invocation.md` when a chosen recipe
invokes `$ST_CLI`. (Pure `/loop` // `/schedule` recipes that call other skills
do not need it.)

### Step 2: Set up the chosen routine

- If the user named a recipe, set it up via the matching mechanism: invoke the
  `loop` skill for local loops, or the `schedule` skill for cloud routines, with
  the recipe's command. Confirm the interval with the user first.
- If no recipe was named, present the table + recipes above and ask which to set
  up. Do NOT create a routine without the user confirming the command + cadence.

### Step 3: Confirm

Report what was scheduled (mechanism, command, cadence) and how to cancel it
(`/schedule` to manage cloud routines; stop the `/loop` to end a local one).

## Handy Claude Code commands (not routines)

- **`/goal "<condition>"`** — drive an unattended run until a condition holds
  (e.g. "all tasks implemented and quality gates pass"). Pairs with
  `/st:implement-plan` — see its "Unattended & background runs" section.
- **`/btw <question>`** — ask a quick side question that does NOT clutter the
  orchestration history (it sees context but takes no tools and is dropped from
  the transcript). Handy mid-run without derailing the plan.
