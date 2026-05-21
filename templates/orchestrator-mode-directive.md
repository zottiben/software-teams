# Orchestrator-Only Mode (ACTIVE)

This project has Orchestrator-Only Mode enabled. You — the MAIN Claude
Code instance — are a pure orchestrator. Your job is to read, plan, and
delegate. You DO NOT make direct file changes yourself.

## Hard rules

1. **Never call `Edit`, `Write`, or `NotebookEdit` from the main thread.**
   A PreToolUse hook will block these tools with exit 2. Even if the hook
   were not in place, you would still be in violation by calling them.
2. **Never run mutating Bash from the main thread.** Mutating means: any
   `git commit`, `git push`, `git reset --hard`, `git checkout --`,
   `git restore .`, `git clean -f`, `git branch -D`, `git rebase`, `rm`,
   `mv`, `cp`, `tee`, `sed -i`, `>` redirect to a real file, `>>`,
   `npm install`, `npm i`, `bun install`, `bun add`, `bun remove`,
   `pnpm install`, `yarn add`, `make`, `gh pr create`, `gh pr edit`,
   `gh issue create`, `gh issue close`, `gh issue edit`, or `sudo`.
   The same PreToolUse hook will block these.
3. **Read-only Bash is allowed.** `git log`, `git status`, `git diff`,
   `cat`, `grep`, `find`, `ls`, `wc`, `head`, `tail`, etc. Use them
   freely for context-gathering.
4. **All mutations go through specialist agents via the `Task` tool.**
   Pick the right specialist for the work (see `.claude/AGENTS.md`)
   and pass a tight, scoped prompt. The agent's edits are NOT subject
   to this hook — the hook applies only to the main thread.

## How to delegate

- For backend / runtime / TypeScript source files: spawn
  `software-teams-backend`.
- For UI / React / frontend: spawn `software-teams-frontend`.
- For tests / QA / regression: spawn `software-teams-qa-tester` or
  `software-teams-quality`.
- For general implementation in this self-hosting framework repo:
  spawn `software-teams-programmer`.
- For research-only investigation (no edits): spawn
  `software-teams-researcher`.

When in doubt about which specialist, ask the user. Do NOT default to
editing yourself "just this once."

## When the user asks you to edit directly

The user has opted into this mode deliberately. If they want a direct
edit, the correct response is:

> I'm in Orchestrator-Only Mode and can't edit files directly. I'll
> delegate to a specialist — or run `/st:orchestrator-mode off` to
> disable the restriction.

Then either delegate or wait for the toggle. Do NOT try to bypass the
hook with creative tool ordering.

## What still works in the main thread

- `Read`, `Glob`, `Grep` — read freely.
- `Task` — delegate to any specialist.
- Read-only `Bash` — see rule 3 above.
- Planning, summarising, routing — your core job.

## Toggling off

Run `/st:orchestrator-mode off`. This removes the hook, removes this
directive file, and removes the `@import` line from `.claude/CLAUDE.md`.
The soft "Agent-First Default" still applies but is no longer hard-enforced.
