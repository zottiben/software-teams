# Software Teams Agent Model & Tool Mapping (Canonical)

This file is the human-readable aide-memoire for the `model:` and `tools:`
frontmatter pinned on every `framework/agents/software-teams-*.md` spec. Pre-plan gate
PAQ-06 made both fields mandatory; the converter (software-teams sync-agents) treats
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
| software-teams-architect          | opus   | planning/file-writing |
| software-teams-backend            | sonnet | implementation        |
| software-teams-codebase-mapper    | sonnet | planning/file-writing |
| software-teams-committer          | haiku  | implementation        |
| software-teams-debugger           | haiku  | implementation        |
| software-teams-devops             | sonnet | implementation        |
| software-teams-feedback-learner   | sonnet | implementation        |
| software-teams-frontend           | sonnet | implementation        |
| software-teams-head-engineering   | opus   | read-only advisor     |
| software-teams-perf-analyst       | sonnet | read-only advisor     |
| software-teams-phase-researcher   | sonnet | researcher (full)     |
| software-teams-plan-checker       | opus   | read-only advisor     |
| software-teams-planner            | opus   | planning/file-writing |
| software-teams-pr-feedback        | sonnet | implementation        |
| software-teams-pr-generator       | sonnet | planning/file-writing |
| software-teams-producer           | opus   | planning/file-writing |
| software-teams-product-lead       | opus   | read-only advisor     |
| software-teams-programmer         | sonnet | implementation        |
| software-teams-qa-tester          | haiku  | implementation        |
| software-teams-quality            | sonnet | implementation        |
| software-teams-researcher         | sonnet | researcher (full)     |
| software-teams-security           | sonnet | read-only advisor     |
| software-teams-ux-designer        | sonnet | planning/file-writing |
| software-teams-verifier           | sonnet | read-only advisor     |

Notes:
- `software-teams-head-engineering`, `software-teams-plan-checker`, and `software-teams-product-lead` were
  upgraded to `opus` per plan 1-01 (gating/quality reasoning roles must
  match `software-teams-architect` and `software-teams-planner`).
- `software-teams-researcher` and `software-teams-phase-researcher` get `Write/Edit` because
  both write structured research reports (`.software-teams/research/*.md`,
  `RESEARCH.md`); the `--pre-plan-discovery` mode of `software-teams-researcher`
  skips file writes by behaviour, not by tool restriction.
- `software-teams-security` is read-only by design — it recommends and audits, it
  never patches code. Pair with `software-teams-programmer` for fixes.
