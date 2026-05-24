# Software Teams Agent Model & Tool Mapping (Canonical)

This file is the human-readable aide-memoire for the `model_tier:` and `tools:`
frontmatter pinned on every `framework/agents/software-teams-*.md` spec. Pre-plan gate
PAQ-06 made both fields mandatory; the converter (software-teams sync-agents) treats
the per-agent frontmatter as the single source of truth and writes
`.claude/agents/{name}.md` mechanically from it.

When you add a new agent or change a role's responsibilities, update both
this table AND the agent's frontmatter in the same commit.

## Model Tier Assignment Policy

Agent specs use `model_tier: large|medium|small` — a vendor-agnostic capability
bucket. `sync-agents` translates the tier to the concrete Anthropic model name
when emitting `.claude/agents/*.md` (so the Claude Code host registry remains
unchanged). The legacy `model: opus|sonnet|haiku` field is accepted for one
minor version but triggers a deprecation warning; it will be removed in v0.7.

| Tier   | Anthropic model | When to use                                                       |
| ------ | --------------- | ----------------------------------------------------------------- |
| large  | opus            | High-leverage reasoning: planning, architecture, cross-cutting    |
|        |                 | judgement, oversight that gates downstream work.                  |
| medium | sonnet          | Default — implementation, research, review, specialist work.      |
| small  | haiku           | Mechanical / narrow-scope tasks (committer, debugger triage,      |
|        |                 | qa-tester case enumeration, plan checklist validation).           |

Never silently downgrade large → medium on an existing spec; raise it as a
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

| Agent                             | model_tier | Anthropic model | Role class            |
| --------------------------------- | ---------- | --------------- | --------------------- |
| software-teams-architect          | large      | opus            | planning/file-writing |
| software-teams-backend            | medium     | sonnet          | implementation        |
| software-teams-codebase-mapper    | medium     | sonnet          | planning/file-writing |
| software-teams-committer          | small      | haiku           | implementation        |
| software-teams-debugger           | small      | haiku           | implementation        |
| software-teams-devops             | medium     | sonnet          | implementation        |
| software-teams-feedback-learner   | medium     | sonnet          | implementation        |
| software-teams-frontend           | medium     | sonnet          | implementation        |
| software-teams-head-engineering   | large      | opus            | read-only advisor     |
| software-teams-perf-analyst       | medium     | sonnet          | read-only advisor     |
| software-teams-phase-researcher   | medium     | sonnet          | researcher (full)     |
| software-teams-plan-checker       | large      | opus            | read-only advisor     |
| software-teams-planner            | large      | opus            | planning/file-writing |
| software-teams-pr-feedback        | medium     | sonnet          | implementation        |
| software-teams-pr-generator       | medium     | sonnet          | planning/file-writing |
| software-teams-producer           | large      | opus            | planning/file-writing |
| software-teams-product-lead       | large      | opus            | read-only advisor     |
| software-teams-programmer         | medium     | sonnet          | implementation        |
| software-teams-qa-tester          | small      | haiku           | implementation        |
| software-teams-quality            | medium     | sonnet          | implementation        |
| software-teams-researcher         | medium     | sonnet          | researcher (full)     |
| software-teams-security           | medium     | sonnet          | read-only advisor     |
| software-teams-ux-designer        | medium     | sonnet          | planning/file-writing |
| software-teams-verifier           | medium     | sonnet          | read-only advisor     |

Notes:
- `software-teams-head-engineering`, `software-teams-plan-checker`, and `software-teams-product-lead` were
  upgraded to `large` (opus) per plan 1-01 (gating/quality reasoning roles must
  match `software-teams-architect` and `software-teams-planner`).
- `software-teams-researcher` and `software-teams-phase-researcher` get `Write/Edit` because
  both write structured research reports (`.software-teams/research/*.md`,
  `RESEARCH.md`); the `--pre-plan-discovery` mode of `software-teams-researcher`
  skips file writes by behaviour, not by tool restriction.
- `software-teams-security` is read-only by design — it recommends and audits, it
  never patches code. Pair with `software-teams-programmer` for fixes.
