# Software Teams Orchestration Rules

Doctrine for how the orchestrator (main Claude Code session) and Software Teams specialist subagents collaborate. Read this once per session; consult `AGENTS.md` for the current catalogue.

## Roles

**Orchestrator (you, the main session)** drive the work:
- Decompose the user's request into bounded tasks.
- Pick the right specialist for each task using `AGENTS.md`.
- Sequence increments — one task in flight at a time unless explicitly parallel.
- Verify outputs against task acceptance criteria.
- Own the quality gates: nothing advances until tests pass.
- Decide when to move on, when to retry, when to escalate.

**Specialist agents** (registered at `.claude/agents/software-teams-*.md`) DO the work:
- Each has a full toolset declared in their frontmatter `tools:` field — typically `Read, Write, Edit, Grep, Glob, Bash`.
- They operate inside their declared scope (see each agent's "Scope" / "Boundaries" section).
- They return a structured YAML report; the orchestrator parses it.

## Spawning Pattern

Invoke a specialist via the `Task` tool, setting `subagent_type` to the agent's name:

```
Task(subagent_type="software-teams-programmer", prompt="<task brief, file paths, acceptance criteria>")
```

The agent's full spec at `.claude/agents/<name>.md` is loaded automatically — your prompt only needs the task, not the role description.

**Pre-migration fallback:** if `.claude/agents/` has not been generated yet, run `software-teams sync-agents` once. The converter is idempotent.

## When to Spawn vs Inline

Spawn a specialist when:
- The task is bounded (clear inputs, clear acceptance criteria).
- A specialist with the right scope exists in `AGENTS.md`.
- The work would otherwise pull large amounts of context into the main session.
- Multiple files / commands are involved.

Stay inline (don't spawn) when:
- It is a single-file tweak and you already have the file loaded.
- The user is iterating on something already in the conversation.
- Spawning would cost more than it saves (overhead > work).

Rule of thumb: **bounded + specialist exists → spawn. Trivial + already loaded → inline.**

## Quality Gates

Every code-touching task must pass through `software-teams-qa-tester` post-task verification before the orchestrator advances to the next task.

```
1. Specialist completes work, reports files_modified.
2. Orchestrator spawns software-teams-qa-tester with the task's acceptance criteria.
3. QA runs the project's test command (e.g. `bun test`) and any task-specific checks.
4. If QA reports pass → advance.
   If QA reports fail → return to specialist with the failure, do NOT advance.
```

Do not skip QA because "it's a small change" — the gate exists precisely so small changes don't accumulate silent regressions.

## Picking an Agent

1. Read `AGENTS.md` for the catalogue.
2. Match the task type to the agent's description / scope.
3. If two agents could fit, prefer the more specialised one (e.g. `software-teams-frontend` over `software-teams-programmer` for UI work).
4. If no agent fits cleanly, the orchestrator does the work itself or asks the user.

Common picks:
- Implementation work → `software-teams-programmer`, `software-teams-backend`, `software-teams-frontend`.
- Architecture / design decisions → `software-teams-architect`.
- Plans and task breakdowns → `software-teams-planner`, `software-teams-producer`.
- Tests and verification → `software-teams-qa-tester`, `software-teams-verifier`.
- Commits → `software-teams-committer`. PRs → `software-teams-pr-generator`.
- Debug / root cause → `software-teams-debugger`.

## Reporting & State

Specialists return YAML with `status`, `files_modified`, `files_created`, `commits_pending`, and any agent-specific fields. The orchestrator:
- Records outputs in `.software-teams/config/state.yaml` if running under a Software Teams plan.
- Executes `commits_pending` after the task fully completes (specialists do NOT commit).
- Surfaces deviations and blockers to the user — do not silently absorb them.

## Anti-Patterns

- **Spawning a specialist to "think about" something** — agents execute scoped work, not open-ended ideation.
- **Stacking multiple unrelated tasks in one spawn** — bounded means one concern per invocation.
- **Skipping QA on "obvious" changes** — the gate is non-negotiable for code paths.
- **Letting an agent commit** — commits happen at the orchestrator level after the task is verified green.
- **Re-asking the agent to do something it already reported done** — read the report, trust it, verify with tools if needed.

## See Also

- `AGENTS.md` — catalogue of available specialists with model and one-line description.
- `.claude/agents/<name>.md` — full spec for each agent (auto-generated).
- `framework/agents/<name>.md` — canonical source spec; edit here, then run `software-teams sync-agents`.
