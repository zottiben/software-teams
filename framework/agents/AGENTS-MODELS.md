# JDI Agent Model & Tool Mapping (Canonical)

This file is the human-readable aide-memoire for the `model:` and `tools:`
frontmatter pinned on every `framework/agents/jdi-*.md` spec. Pre-plan gate
PAQ-06 made both fields mandatory; the converter (jdi sync-agents) treats
the per-agent frontmatter as the single source of truth and writes
`.claude/agents/{name}.md` mechanically from it.

When you add a new agent or change a role's responsibilities, update both
this table AND the agent's frontmatter in the same commit.

## Model Assignment Policy

| Model  | When to use                                                       |
| ------ | ----------------------------------------------------------------- |
| opus   | High-leverage reasoning: planning, architecture, cross-cutting    |
|        | judgement, oversight that gates downstream work.                  |
| sonnet | Default — implementation, research, review, specialist work.      |
| haiku  | Mechanical / narrow-scope tasks (committer, debugger triage,      |
|        | qa-tester case enumeration, plan checklist validation).           |

Never silently downgrade opus → sonnet on an existing spec; raise it as a
deliberate decision.

## Tool Allowlist Policy (Role Classes)

Tool names match Claude Code's canonical names exactly: `Read`, `Write`,
`Edit`, `Grep`, `Glob`, `Bash`, `WebFetch`, `WebSearch`, `Task`,
`AskUserQuestion`. No aliases, no lowercase.

| Role class           | Tools                                              |
| -------------------- | -------------------------------------------------- |
| Read-only advisor    | `[Read, Grep, Glob, Bash, WebFetch, WebSearch]`    |
| Implementation       | `[Read, Write, Edit, Grep, Glob, Bash]`            |
| Planning / file-writing | `[Read, Write, Edit, Grep, Glob, Bash]`         |
| Researcher (full)    | `[Read, Write, Edit, Grep, Glob, Bash, WebFetch, WebSearch]` |

Read-only advisors review and recommend; they never edit code/specs in
their default flow. Implementation roles modify code/tests in a repo.
Planning and file-writing roles create plan/spec/PR/commit artifacts.
Researcher roles need outbound web access and write research reports.

## Per-Agent Mapping

| Agent                  | Model  | Role class            |
| ---------------------- | ------ | --------------------- |
| jdi-architect          | opus   | planning/file-writing |
| jdi-backend            | sonnet | implementation        |
| jdi-codebase-mapper    | sonnet | planning/file-writing |
| jdi-committer          | haiku  | implementation        |
| jdi-debugger           | haiku  | implementation        |
| jdi-devops             | sonnet | implementation        |
| jdi-feedback-learner   | sonnet | implementation        |
| jdi-frontend           | sonnet | implementation        |
| jdi-head-engineering   | opus   | read-only advisor     |
| jdi-perf-analyst       | sonnet | read-only advisor     |
| jdi-phase-researcher   | sonnet | researcher (full)     |
| jdi-plan-checker       | opus   | read-only advisor     |
| jdi-planner            | opus   | planning/file-writing |
| jdi-pr-feedback        | sonnet | implementation        |
| jdi-pr-generator       | sonnet | planning/file-writing |
| jdi-producer           | opus   | planning/file-writing |
| jdi-product-lead       | opus   | read-only advisor     |
| jdi-programmer         | sonnet | implementation        |
| jdi-qa-tester          | haiku  | implementation        |
| jdi-quality            | sonnet | implementation        |
| jdi-researcher         | sonnet | researcher (full)     |
| jdi-security           | sonnet | read-only advisor     |
| jdi-ux-designer        | sonnet | planning/file-writing |
| jdi-verifier           | sonnet | read-only advisor     |

Notes:
- `jdi-head-engineering`, `jdi-plan-checker`, and `jdi-product-lead` were
  upgraded to `opus` per plan 1-01 (gating/quality reasoning roles must
  match `jdi-architect` and `jdi-planner`).
- `jdi-researcher` and `jdi-phase-researcher` get `Write/Edit` because
  both write structured research reports (`.jdi/research/*.md`,
  `RESEARCH.md`); the `--pre-plan-discovery` mode of `jdi-researcher`
  skips file writes by behaviour, not by tool restriction.
- `jdi-security` is read-only by design — it recommends and audits, it
  never patches code. Pair with `jdi-programmer` for fixes.
