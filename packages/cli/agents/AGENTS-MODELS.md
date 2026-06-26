# Software Teams Agent Model & Tool Mapping (Canonical)

This file is the human-readable aide-memoire for the `model:` and `tools:`
frontmatter pinned on every `framework/agents/software-teams-*.md` spec. Pre-plan gate
PAQ-06 made both fields mandatory. At `software-teams sync-agents` time the converter
resolves each agent's model using this precedence:

1. **config.yaml `models:` profile override** (if the active profile names the agent) — highest priority.
2. **Per-agent frontmatter `model:`** — fallback default used only when the active profile (and any override) does not name the agent.

The converter writes `.claude/agents/{name}.md` mechanically from the resolved value.
Frontmatter is no longer the sole source of truth; it is the fallback.

When you add a new agent or change a role's responsibilities, update both
this table AND the agent's frontmatter in the same commit.

## Model Assignment Policy

| Model  | When to use                                                       |
| ------ | ----------------------------------------------------------------- |
| opus   | High-leverage reasoning: planning, architecture, cross-cutting    |
|        | judgement, oversight that gates downstream work.                  |
| sonnet | Default — implementation, research, review, specialist work.      |
| haiku  | Mechanical / narrow-scope tasks (committer, debugger triage,      |
|        | plan checklist validation).                                       |

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
| software-teams-dev-planner        | sonnet | planning/file-writing |
| software-teams-devops             | sonnet | implementation        |
| software-teams-feedback-learner   | sonnet | implementation        |
| software-teams-frontend           | sonnet | implementation        |
| software-teams-game-ai-engineer   | sonnet | implementation        |
| software-teams-game-art-pipeline  | sonnet | implementation        |
| software-teams-game-designer      | opus   | planning/file-writing |
| software-teams-game-devops        | sonnet | implementation        |
| software-teams-game-engineer      | sonnet | implementation        |
| software-teams-game-producer      | opus   | planning/file-writing |
| software-teams-game-qa            | sonnet | implementation        |
| software-teams-game-tech-artist   | sonnet | implementation        |
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
| software-teams-qa-tester          | sonnet | implementation        |
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
- `software-teams-qa-tester` is `sonnet` (raised from `haiku`): it owns
  evidence-based verification — baseline-proving "pre-existing" failures,
  contract-check, and a11y judgement — which needs reasoning, not the cheapest
  model. The `quality` and `balanced` profiles use sonnet; the `budget` profile
  keeps it on `haiku` as the explicit cost trade-off.
- The eight game-* specialists are gameplay/Unity/AI-art-pipeline/store-cert/production roles for game development projects; they follow the same model/role-class conventions as the other agents.
- **Profile-overrides-frontmatter precedence:** `config.yaml models:` profiles override the per-agent frontmatter `model:` at `software-teams sync-agents` time. The frontmatter value is the fallback default used only when the active profile (and any override) does not name the agent. The `balanced` profile maps `software-teams-dev-planner` to `claude-opus-4-6`; its frontmatter default is `sonnet`.
- **Orchestrator caveat:** The orchestrator is the main Claude Code session, not a spawned subagent — it cannot be configured via `config.yaml`. Out of scope; documented here only.
