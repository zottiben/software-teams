---
name: ask-questions
description: "Software Teams: Toggle the Ask Clarifying Questions policy on/off or report status. Overrides the harness auto-mode reminder that suppresses clarifying questions."
allowed-tools: Read, Bash
argument-hint: "<on | off | status>"
---

# Ask Clarifying Questions toggle

Toggle a per-project prompt-layer policy that tells Claude to ask
substantive clarifying questions about ambiguous work, even when the
Claude Code harness is in auto permission mode.

## Why this exists

When `permissions.defaultMode` is `"auto"` in `~/.claude/settings.json`
(or any other auto-mode trigger), the Claude Code binary injects a
hard-coded reminder that says:

> "The user has asked you to work without stopping for clarifying
> questions. When you'd normally pause to check, make the reasonable
> call and continue; they'll redirect if needed."

This conflates two unrelated things: *permission* autonomy (skip tool
prompts) and *content* autonomy (skip thinking-clarifying-questions
about the task). The reminder is intended for the former but reads as
"don't ask anything." Sub-agents and the main thread then silently bake
in their own defaults instead of surfacing decision points.

This skill installs an explicit override at the project layer. CLAUDE.md
content is documented to OVERRIDE harness defaults, so the policy wins.

## Usage

- `/st:ask-questions on` — enable. Creates `.claude/ask-questions.md`
  and appends `@.claude/ask-questions.md` to `.claude/CLAUDE.md`.
- `/st:ask-questions off` — disable. Removes the `@import` line and
  deletes the directive file.
- `/st:ask-questions status` — report per-artefact state and detect
  drift.

## What it does NOT change

- Permission mode. Auto stays auto; tool calls still don't prompt.
- Hooks, settings, or any enforcement layer. This is purely
  prompt-layer policy — no exit-2 blocking.
- Sub-agent definitions. Specialists pick up the policy via the
  inherited project CLAUDE.md context.

## Implementation

Validate that `$ARGUMENTS` is one of `on`, `off`, or `status`. If not,
print usage and stop:

> "Usage: `/st:ask-questions <on | off | status>`
> Argument must be one of: on, off, status."

Do NOT shell out with an invalid argument.

Once validated, this skill shells out to `software-teams ask-questions <sub>`
for the actual logic. Run:

    software-teams ask-questions $ARGUMENTS

and pass the exit code back to the caller. Users developing this repo
locally who have not installed the published package can substitute:

    bun run <repo>/src/index.ts ask-questions $ARGUMENTS

The bun subcommand is the source of truth for all state mutations. The
skill does not write any files directly.

## Scope

Per-project only. The skill never writes to `~/.claude/` and never reads
a user-global config. Each project decides its own posture.

---

**Task:** $ARGUMENTS
