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

Quality is enforced in two layers — one automated, one judgement-based.

**Layer 1 — automated fast gate (deterministic).** A `SubagentStop` hook
(`.claude/hooks/quality-gate.sh`, wired by `init`) runs the project's fast
quality gates — lint / analyse / typecheck, sourced from `adapter.yaml` —
automatically after every specialist that touched code. It skips clean trees
and the full test suite (that is Layer 2's job), and surfaces any failure
straight back to the agent (exit 2) so it is fixed before the work is accepted.
Nobody has to remember to run it. Trigger it manually any time, or in CI, with
`software-teams verify` (`--gate`/`--skip` select gates; `--json` for tooling).

**Layer 2 — QA-tester gate (judgement).** Every code-touching task must still
pass through `software-teams-qa-tester` post-task verification — acceptance
criteria plus the full test suite — before the orchestrator advances:

```
1. Specialist completes work, reports files_modified.
2. Orchestrator spawns software-teams-qa-tester with the task's acceptance criteria.
3. QA runs the project's test command (e.g. `bun test`) and any task-specific checks.
4. If QA reports pass → advance.
   If QA reports fail → return to specialist with the failure, do NOT advance.
```

Do not skip QA because "it's a small change" — the gate exists precisely so small changes don't accumulate silent regressions.

**Green to advance is non-negotiable.** A red test suite blocks the next task/wave regardless of cause. If a failure is genuinely pre-existing and out of scope (proven via baseline — see Doctrine "Prove 'pre-existing' before you blame it"), escalate it to the user; do NOT advance over red on the strength of an unproven "it was already broken" claim. Set `ST_QUALITY_GATE_TESTS=1` to make the Layer-1 hook run the full suite on every specialist stop, so a broken suite surfaces the moment it breaks rather than at the wave gate.

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
- **Verifies the return against reality before trusting it** — runs `git status --porcelain` and confirms the claimed `files_modified` are actually dirty and no unclaimed source file changed. A mismatch means a truncated, stale, or fabricated return: re-spawn or surface it. Never aggregate a return you have not reconciled with git — a silently-dropped return is how half-finished work slips through.
- Records outputs in `.software-teams/state.yaml` if running under a Software Teams plan.
- Executes `commits_pending` after the task fully completes (specialists do NOT commit).
- Surfaces deviations and blockers to the user — do not silently absorb them.

## Doctrine — applies to orchestrator AND every specialist

These rules exist because of failures that already happened. They are not optional.

### Verify, don't speculate
Distinguish "I confirmed X by reading file:line" from "I theorise X." When you write a diagnosis, tag every line: **Confirmed** (read it, ran it, reproduced it) or **Theorised** (plausible-sounding but not verified). Never act on a theory as if it were verified. Soft language ("likely," "appears to," "may have") is a tell that you are speculating — caveat it explicitly: "Likely cause — not verified." If verification requires running the app or visual inspection, **say so and stop** rather than shipping a fix on a guess.

### Comparative claims require evidence
Any claim that compares the code under review to **other code** — "every other file does X", "this is inconsistent with Y", "the convention here is Z", "all sibling configs use W" — is a **comparative claim**, and is invalid unless you actually read the file(s) you are comparing against **in this session** and can quote the relevant lines. Pattern-matching on a name (e.g. "the file `OrganisationsFilterSidebar.config.ts` exists, so it must do X") is **not reading**. Grep hits are not reading. Memory from training data is not reading. If you cannot cite `path:line` evidence from a file you opened, **delete the finding** — do not hedge it, do not soften the language, drop it. A confidently wrong finding is worse than a missing one because it burns trust and wastes the user's time correcting you.

### Trust but verify upstream agents
Prior agent reports are not ground truth. If a previous agent claimed a pattern works, **read the actual code and verify the claim** before propagating it to another file. Cross-screen confirmation is meaningless if the source pattern is broken. "Three screens use this" can mean "three screens have the same bug."

### UI work cannot rely on typecheck
For layout, positioning, z-index, sticky behaviour, scroll, animation, focus, and visual hierarchy: **typecheck and lint do not validate correctness**. Layout bugs typecheck clean. State explicitly in your report: `visual_verified: false — no rendered confirmation in this task`. Do not write "fix verified" or "type_check: pass" as if those imply visual correctness. If you cannot run the app, say so — do not claim success.

### Stop on regression
If your fix breaks another test, screen, or feature: **STOP**. Report the regression. Do **not** paper over it with a second fix. Two stacked fixes on a broken foundation compound, they don't repair. The right move is to revert and re-diagnose, not to layer.

### Prove "pre-existing" before you blame it
A failing test, lint error, or broken build is **yours to fix by default**. You may label a failure "pre-existing" / "not caused by my change" **only if you prove it**: in this session, run the same check on a clean baseline (`git stash --include-untracked && <the exact check> ; git stash pop`) and paste **both** the baseline output and the post-change output. No baseline transcript → the claim is invalid → treat the failure as caused by your change and fix it. "It was already failing" asserted as free text, with no captured before/after, is the single most common dishonest report — it is never accepted. If you genuinely cannot fix a proven pre-existing failure within scope, say so explicitly and stop; do not silently leave it red and move on.

### Prefer the root-cause fix over the workaround
Band-aids are forbidden: silenced types (`as any`, `@ts-ignore`, `// eslint-disable` to dodge a real error), swallowed exceptions, duplicated logic you could refactor, `// TODO` placeholders, or deleting/skipping a test to make the suite green. If only a workaround fits the task scope, **STOP and escalate** (deviation Rule 4) with the correct fix described — do not ship the shortcut silently. A quick fix that creates tech debt is a worse outcome than an honest escalation.

### Match the surrounding code
Before writing or editing, read 2–3 sibling files in the target directory and match their structure, naming, import order, typing, and error-handling. New code must read like the code around it. The project's standards live in `.claude/CLAUDE.md` and the `.software-teams/rules/*.md` files — follow them. If you are a spawned specialist, your conventions arrive in the `## Coding Standards` block of your prompt; honour it.

### NEVER commit without explicit request
Specialists do **NOT** run `git commit`, `git add`, `git push`, `git reset`, `git rebase`, or any history-modifying operation. Leave changes in the working tree; record the intended commit message in `commits_pending`. The orchestrator commits when the user authorises it, in the user's preferred boundaries. **No exceptions, no narrative justifications.** If you find yourself constructing a story for why this commit is fine, that itself is the warning sign — stop. A commit you make is a regression the user cannot undo invisibly.

### One concern per invocation
A spawn brief should change **one logical concern**. "Sticky tabs + sticky action row" is two concerns even if they live in the same file. "Fix bug A and refactor module B" is two concerns. Bundle unrelated work? Run them as **parallel agents** instead — one concern each. Larger scope = more surface area for unchecked drift, and a truncated agent leaves you with half a fix and no clean rollback.

### Read working examples before propagating a pattern
Before applying a pattern from another file/screen/module: **read 2–3 instances** and verify they actually work in the running app, not just that they exist in the repo. A pattern that compiles is not a pattern that works.

## Anti-Patterns

- **Spawning a specialist to "think about" something** — agents execute scoped work, not open-ended ideation.
- **Stacking multiple unrelated tasks in one spawn** — bounded means one concern per invocation.
- **Skipping QA on "obvious" changes** — the gate is non-negotiable for code paths.
- **Letting an agent commit** — commits happen at the orchestrator level after the task is verified green.
- **Re-asking the agent to do something it already reported done** — read the report, trust it, verify with tools if needed.
- **Treating typecheck-pass as proof of correctness for UI work** — layout bugs typecheck clean.
- **Stacking a second fix on top of a regression** — revert and re-diagnose, don't layer.
- **Constructing a narrative to justify an unauthorised action** — if you need a story for why an action was fine, you shouldn't have taken it.
- **Fabricating cross-file consistency claims** — asserting "the convention is X" or "all other files do Y" without having actually read those files in-session. If you can't cite `path:line`, the finding does not exist.
- **Blaming a failure on "pre-existing" state without a baseline transcript** — "the test was already red" is invalid unless you ran it on a clean baseline (`git stash`) this session and pasted both outputs. Absent proof, the failure is yours to fix.
- **Shipping the quick fix that creates tech debt** — silenced types, swallowed errors, duplicated logic, `// TODO` placeholders, or skipped/deleted tests. Escalate (Rule 4) with the correct fix instead of shipping the shortcut silently.

## See Also

- `AGENTS.md` — catalogue of available specialists with model and one-line description.
- `.claude/agents/<name>.md` — full spec for each agent (auto-generated).
- `framework/agents/<name>.md` — canonical source spec; edit here, then run `software-teams sync-agents`.
