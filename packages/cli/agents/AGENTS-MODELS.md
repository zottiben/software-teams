# Software Teams Agent Model & Tool Mapping (Canonical)

This file is the human-readable aide-memoire for the `model:`, `effort:`, and `tools:`
frontmatter on every `agents/software-teams-*.md` spec.

## Two dials, resolved separately

**`model` is how capable. `effort` is how thorough.** They are independent, and the
right question when an agent gets something wrong is which one was short:

- It had the context, clearly tried, and was still wrong → **raise the model**.
- It skipped a file, skipped the tests, or stopped at the first plausible answer →
  **raise the effort**.

Effort is deliberately sparse. Anthropic's guidance is to stay on the model's default
effort for most work and treat the dial as a manual override, so an agent appears in a
profile's `effort:` map only where there is a stated reason. An agent with no entry emits
no `effort:` key and inherits the default. Do not pre-populate the map.

## Resolution at `sync-agents` time

The converter writes `.claude/agents/{name}.md` from:

1. **config.yaml** — `models.profiles.<active>` then `models.overrides` for the model;
   `models.profiles.<active>.effort` then `models.effort_overrides` for the effort.
2. **Per-agent frontmatter** — the fallback, used only where config names nothing.

## Resolution at runtime (the harness's own order)

What Software Teams writes into the frontmatter is only step 3 of Claude Code's own
precedence, so a value set here can still be overridden at spawn time:

1. `CLAUDE_CODE_SUBAGENT_MODEL` environment variable
2. The per-invocation `model` parameter on the `Agent` tool call
3. The subagent definition's `model:` frontmatter — **what we write**
4. The main conversation's model

So a worker or CI environment that sets `CLAUDE_CODE_SUBAGENT_MODEL` silently wins over
every profile in this file. Worth knowing before debugging "my profile isn't applying".

When you add a new agent or change a role's responsibilities, update both
this table AND the agent's frontmatter in the same commit.

## Model Assignment Policy

| Model  | When to use                                                       |
| ------ | ----------------------------------------------------------------- |
| fable  | Work larger than a single sitting: long autonomous runs, ambiguous |
|        | root-cause investigation, architecture. Costs the most per token   |
|        | and draws hardest on a subscription seat allowance, so it appears  |
|        | only in the `quality` profile. It verifies its own work with less  |
|        | prompting — do NOT add verification reminders to specs that run    |
|        | on it.                                                             |
| opus   | High-leverage reasoning: planning, architecture, cross-cutting    |
|        | judgement, oversight that gates downstream work.                  |
| sonnet | Default — implementation, research, review, specialist work.      |
| haiku  | Mechanical / narrow-scope tasks (committer, plan checklist         |
|        | validation). Not for diagnosis: see the debugger note below.      |

## Effort Assignment Policy

| Effort | When to set it explicitly                                          |
| ------ | ------------------------------------------------------------------ |
| low    | Mechanical, precisely specified work where thoroughness buys        |
|        | nothing (committer, pr-generator, feedback-learner).                |
| high   | Roles that gate downstream work, or whose failure mode is stopping  |
| xhigh  | too early (debugger, security, qa-tester, plan-checker, verifier).  |
| max    | Reserved. Nothing ships on it by default.                           |
| unset  | Everything else — inherit the model's default. This is the norm.    |

Never silently downgrade opus → sonnet on an existing spec; raise it as a
deliberate decision.

## Tool Allowlist Policy (Role Classes)

Tool names match Claude Code's canonical names exactly: `Read`, `Write`,
`Edit`, `Grep`, `Glob`, `Bash`, `LSP`, `WebFetch`, `WebSearch`, `Agent`.
No aliases, no lowercase. The `ci.yml` frontmatter gate rejects anything
outside the canonical set.

Two names that used to appear here and must not come back:

- **`Task` does not exist.** The subagent-spawning tool is `Agent`. Its
  `subagent_type` parameter is unchanged, so only the tool name moved.
- **`AskUserQuestion` cannot be granted to a subagent.** The harness strips it
  from every subagent unconditionally, along with `EnterPlanMode`,
  `ScheduleWakeup`, `TaskOutput`, and `Workflow`. A specialist that needs a
  human decision returns it for the orchestrator to ask on its behalf.
- **`MultiEdit` was folded into `Edit`.**

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
- **Profile-overrides-frontmatter precedence:** `config.yaml models:` profiles override the per-agent frontmatter `model:` at `software-teams sync-agents` time. The frontmatter value is the fallback default used only when the active profile (and any override) does not name the agent. The `balanced` profile maps `software-teams-dev-planner` to `opus`; its frontmatter default is `sonnet`.
- **Profiles use aliases, not pinned IDs.** `opus`, `sonnet`, `haiku`, and `fable` each track Anthropic's current recommended version for that family, so the profiles do not go stale when a model ships. On the Anthropic API today `opus` resolves to Opus 5 and `sonnet` to Sonnet 5. Pin a full ID (`claude-opus-5`) only when a fixed version genuinely matters.
- **This table is a capability tier, not a thoroughness tier.** Model selects how capable; `effort` selects how thorough. See "Two dials" above for how to tell which one is short.
- **`software-teams-debugger` is `sonnet` in every profile (raised from `haiku`).** Root-cause analysis on a subtle bug is the canonical "pick a larger model" case: no amount of effort rescues a model that is confidently wrong. It also carries the highest effort of any role, because its specific failure mode is stopping at the first plausible explanation. This is the same argument that already moved `qa-tester` off `haiku`.
- **Orchestrator caveat:** The orchestrator is the main Claude Code session, not a spawned subagent — it cannot be configured via `config.yaml`. Out of scope; documented here only.
