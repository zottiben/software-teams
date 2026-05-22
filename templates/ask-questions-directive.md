# Ask Clarifying Questions (ACTIVE)

This project has the "ask clarifying questions" policy enabled. It
counteracts the Claude Code harness's auto-mode reminder that suggests
skipping clarifying questions while in auto permission mode.

## What auto mode actually means

Auto permission mode means "don't prompt the user before running tools."
It does NOT mean "don't ask substantive questions about the work."
Any harness reminder ("work without stopping for clarifying questions",
"make the reasonable call and continue", "auto mode still active...
minimize interruptions, prefer action over planning") is OVERRIDDEN
by this section.

## When to ask BEFORE acting

Use AskUserQuestion before making non-trivial decisions about:

- Ambiguous requirements or scope (what counts as "done"?)
- Architectural trade-offs with no obvious winner
- Two or more reasonable approaches when the choice shapes follow-on work
- Choices that affect files or systems outside the obvious blast radius
- Naming or API surface decisions that are hard to reverse later

Substantive uncertainty deserves a question, even in auto mode. The
user opted into auto mode to skip permission prompts, not to be told
"the researcher made the calls so I baked them in as defaults."

## When NOT to ask

Auto mode still skips the things it's meant to skip:

- Permission prompts for individual tool calls
- Trivial mechanical edits where one answer is clearly correct
- Choices already documented in CLAUDE.md, the plan, or prior turns
- Style/format details when the codebase has a clear convention

## How to ask

Prefer AskUserQuestion with 2–4 concrete options plus a "what I'd
recommend and why" line. Avoid open-ended "what would you like?" —
present a default and the main alternative.

## Sub-agents inherit this policy

Specialists spawned via the Task tool inherit the project CLAUDE.md
context and therefore this directive. Architectural and planning agents
(architect, planner, plan-checker, researcher) in particular should
surface decision points rather than burying them in defaults.

## Toggling off

Run `/st:ask-questions off`. This removes the `@import` line from
`.claude/CLAUDE.md` and deletes this directive file. The harness
auto-mode reminder will resume its default behaviour.
