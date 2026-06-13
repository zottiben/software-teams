---
name: compile-workflow
description: "Software Teams: Compile an approved three-tier plan into a deterministic Workflow and optionally run it"
argument-hint: "[plan-slug] [--no-qa]"
context: |
  !ls .software-teams/plans/*.orchestration.md 2>/dev/null | tail -5
  !cat .software-teams/state.yaml 2>/dev/null | head -15
---

# /st:compile-workflow

Compile a three-tier orchestration plan into a deterministic Claude Code
**Workflow** script and (optionally) run it — entirely inside Claude Code, no
separate terminal. This is the opt-in deterministic alternative to
`/st:implement-plan`'s inline wave loop: wave gates become real code barriers,
every task is pinned to its specialist (`agentType`), and each returns a
validated structured result.

## Prerequisites

- A **three-tier** plan (`{slug}.orchestration.md` + per-agent `{slug}.T{n}.md`
  slices). If only a single-tier `{slug}.plan.md` exists, STOP and tell the user
  that compile-workflow needs a three-tier plan — re-run `/st:create-plan`
  without `--single-tier`, or just use `/st:implement-plan`.
- The plan should be **approved**. If it is not, warn the user but allow it
  (they may want to preview the script before approving).

## Direct Execution

### Step 1: Resolve the CLI

Resolve the CLI per `commands/_shared/cli-invocation.md`. If resolution fails,
relay the fail-fast block and STOP. After resolution, `$ST_CLI` is available.

### Step 2: Compile the workflow

Pass `$ARGUMENTS` straight through so the slug and `--no-qa` reach the CLI:

```bash
$ST_CLI compile-workflow $ARGUMENTS
```

- With no slug it auto-detects the most recent `*.orchestration.md`.
- It writes `.software-teams/plans/{slug}.workflow.js` and prints the task/wave
  count and the script path.
- If it exits non-zero (e.g. no three-tier plan found), relay the error and
  STOP — do not fabricate a workflow.

Capture the generated script path (`.software-teams/plans/{slug}.workflow.js`)
from the output.

### Step 3: Offer to run it

Ask via AskUserQuestion:

> Workflow compiled at `{path}`. Run it now?
> - **Run it now** — execute the deterministic workflow via the Workflow tool.
> - **Just the script** — stop here; run it later with `/st:implement-plan --workflow` or by asking to run the workflow.

If the user chose **Just the script**, report the path and STOP.

### Step 4: Run it (only if the user chose "Run it now")

Call the **Workflow tool** with `scriptPath` set to the generated file:

```
Workflow({ scriptPath: ".software-teams/plans/{slug}.workflow.js" })
```

Invoking the Workflow tool from this skill IS a valid opt-in — these skill
instructions explicitly direct you to call it, so you do not need the user to
type `ultracode`. The script runs each wave as a `parallel()` barrier, spawns
each task's pinned specialist, and returns `{ slug, tasks, verification }`.

### Step 5: After the workflow returns

The specialists did NOT commit. Finish exactly as `/st:implement-plan` §3T.11–14:

1. Collect every task's `commits_pending` from the workflow result.
2. Execute the commits (`git add` + `git commit`) per the project's commit
   policy — do NOT commit without the user's authorisation if that is the
   policy.
3. Advance plan state (`$ST_CLI state complete` once gates pass).
4. Present the standard implementation summary (task table, files changed,
   quality gates, deviations) and STOP.

## Notes

- The Workflow tool requires a paid Claude plan. If it is unavailable, fall back
  to `/st:implement-plan` — the inline wave loop produces the same result.
- `$ST_CLI` runs in this Claude Code session; you never need a separate terminal.
