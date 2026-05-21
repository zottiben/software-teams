---
name: orchestrator-mode
description: "Software Teams: Toggle Orchestrator-Only Mode on/off or report status. Restricts the main thread to read/plan/delegate; specialists do all mutations."
allowed-tools: Read, Bash
argument-hint: "<on | off | status>"
---

# Orchestrator-Only Mode toggle

Toggle a per-project enforcement layer that restricts the MAIN Claude Code
thread to read / plan / delegate only. Specialists invoked via the Task
tool are unaffected.

## Usage

- `/st:orchestrator-mode on` — enable. Creates `.claude/orchestrator-mode.md`,
  appends `@.claude/orchestrator-mode.md` to `.claude/CLAUDE.md`, and
  installs a PreToolUse hook in `.claude/settings.json` that blocks Edit,
  Write, NotebookEdit, and mutating Bash with exit 2.
- `/st:orchestrator-mode off` — disable. Removes all three artefacts.
- `/st:orchestrator-mode status` — report per-artefact state and detect drift.

## What gets blocked when on

- `Edit`, `Write`, `NotebookEdit` — always blocked.
- Mutating Bash — `git commit`, `git push`, `git reset --hard`,
  `git checkout -- `, `git restore .`, `git clean -f`, `git branch -D`,
  `git rebase`, `rm `, `mv `, `cp `, `tee `, `sed -i`, `> ` redirect to
  real files, `>>`, `npm install`, `npm i`, `bun install`, `bun add`,
  `bun remove`, `pnpm install`, `yarn add`, `make `, `gh pr create`,
  `gh pr edit`, `gh issue create`, `gh issue close`, `gh issue edit`,
  `sudo`. Exact list lives in `.claude/hooks/orchestrator-deny-bash.sh`.
- Read-only Bash (`git log`, `git status`, `git diff`, `cat`, `grep`,
  `find`, `ls`, `wc`, `head`, `tail`) passes through.

## What still works

- `Read`, `Glob`, `Grep`, `Task` — always allowed.
- All specialist agents spawned via Task — their edits run in subagent
  processes and are NOT subject to the main-thread hook.

## Implementation

Validate that `$ARGUMENTS` is one of `on`, `off`, or `status`. If not,
print usage and stop:

> "Usage: `/st:orchestrator-mode <on | off | status>`
> Argument must be one of: on, off, status."

Do NOT shell out with an invalid argument.

Once validated, this skill shells out to `software-teams orchestrator-mode <sub>`
for the actual logic. Run:

    software-teams orchestrator-mode $ARGUMENTS

and pass the exit code back to the caller. Users developing this repo locally
who have not installed the published package can substitute:

    bun run <repo>/src/index.ts orchestrator-mode $ARGUMENTS

The bun subcommand is the source of truth for all state mutations. The skill
does not write any files directly.

## Per-turn override

There is none. To make a direct edit, toggle off first.

## Scope

Per-project only. The skill never writes to `~/.claude/` and never reads
a user-global config. Each project decides its own posture.

---

**Task:** $ARGUMENTS
