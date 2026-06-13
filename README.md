# Software Teams

**A team of specialist AI agents that plan, build, review, and ship features end-to-end.**

[![npm version](https://img.shields.io/npm/v/@websitelabs/software-teams)](https://www.npmjs.com/package/@websitelabs/software-teams) [![CI](https://img.shields.io/github/actions/workflow/status/zottiben/software-teams/ci.yml?branch=main&label=ci)](https://github.com/zottiben/software-teams/actions) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```
You:   /st:create-plan "Add password reset flow"
ST:    Plan written. 4 tasks across backend, frontend, qa. Approve?
You:   approved
You:   /st:implement-plan
ST:    Wave 1: backend done (commit 1a2b3c). Wave 2: frontend done (commit 4d5e6f).
       QA pass: 12/12 tests added and passing. Ready to ship?
You:   /st:generate-pr
ST:    PR #42 opened.
```

That's the loop. Plan → approve → implement → ship. One Claude Code session.

---

## Why use this

Claude Code has built-in subagents. Software Teams sits on top of them and adds the *workflow* — the specific orchestration patterns that turn "I have a ticket" into "I have a merged PR" without you driving each step.

| You want… | Reach for |
|-----------|-----------|
| To ask Claude one focused question | Claude Code itself |
| To dispatch one specialist for a clear task | Claude Code's `/agents` |
| **A repeatable plan-then-build flow with multiple specialists, atomic commits, and a generated PR** | **Software Teams** |
| Autonomous execution from a GitHub issue or PR comment | **Software Teams (GitHub Actions mode)** |
| To compose specialists visually — one Claude per node, canvas handoff, Slack human-in-the-loop, ClickUp/Datadog triggers | **Software Teams (n8n nodes)** |

The differentiators:

- **Three-tier planning** keeps prompt context tight. The planner writes a `spec.md` (the *what*), an `orchestration.md` (the *how* — task graph, agent pinning, sequencing rules), and one `T{n}.md` slice per task. When a specialist is spawned for task T3, it loads only T3's slice and the SPEC sections that slice cites — not the whole plan, not the other tasks. On a 12-task plan this typically saves 60–80% of per-spawn tokens.
- **Native Claude Code subagents.** No identity-injection preambles. Specialists are real `.claude/agents/<name>.md` files generated from the canonical specs in `packages/cli/agents/`.
- **Rules that learn from PR review.** When a reviewer says "we always use path aliases here," the `feedback-learner` extracts the rule, dedupes it against your existing `.claude/CLAUDE.md`, and writes it to `.software-teams/rules/{frontend,backend,…}.md` so the next plan picks it up.
- **Four runtimes, one codebase.** The same specialists run from inside Claude Code (`/st:*`), from your terminal (`software-teams …`), from a GitHub PR comment (`Hey software-teams …`), or as **n8n community nodes** on a self-hosted visual canvas.

---

## Quickstart (60 seconds)

Pick one of two install paths.

**Option A — Claude Code plugin** (recommended if you live inside Claude Code):

```
/plugin marketplace add zottiben/software-teams
/plugin install software-teams@websitelabs
```

Then in your project: `/software-teams:init`.

> **Self-contained** — the plugin ships with a bundled CLI (`dist/index.js`, Bun-native). No global install needed; everything runs inside the plugin. Plugin init uses `--state-only` mode: it scaffolds `.software-teams/` only and generates no `.claude/` artifacts — the plugin already supplies all skills and agents natively.

**Option B — Standalone CLI** (recommended if you also want the terminal commands and GitHub Actions runtime):

```bash
bun add -g @websitelabs/software-teams
# or:
npm i -g @websitelabs/software-teams

cd ~/code/your-project
software-teams init
```

The **plugin** path sets up `.software-teams/` (state, plans, rules) only — the plugin supplies skills and agents natively. The **CLI** path sets up `.software-teams/`, `.claude/agents/` (33 specialists), and a CLAUDE.md routing block. Pass `--state-only` to any `init` call to scaffold `.software-teams/` without generating `.claude/` artifacts.

Now from inside Claude Code in that project:

```
/st:create-plan "Add a /healthz endpoint with a 200 response and a basic test"
```

The planner spawns, scans your codebase, and writes a plan. Reply `approved` to lock it. Then:

```
/st:implement-plan
```

The orchestrator picks specialists, runs them in dependency order, and posts a summary when each task is done. From there: `/st:commit`, `/st:generate-pr`, ship.

---

## Three ways to drive it

**Inside Claude Code** — slash commands trigger the workflow:

```
/st:create-plan <feature description>
/st:implement-plan
/st:pr-review <pr-number>
```

**From the terminal** — same workflows, scriptable:

```bash
software-teams plan "add password reset flow"
software-teams implement
software-teams quick "fix the broken login button"
software-teams review 42
software-teams pr
```

**From a GitHub PR/issue comment** — autonomous mode, runs in Actions:

```
Hey software-teams plan add password reset flow
Hey software-teams implement
Hey software-teams review
```

The action handles plan-then-build, posts progress comments, opens the PR. See [GitHub Actions setup](#github-actions-setup) for the one-time wiring.

---

## What's actually shipping

The headline workflows are the ones in the [Quickstart](#quickstart-60-seconds). Under the hood:

- **A planner** that produces three-tier plans by default and falls back to single-tier for trivial work.
- **A complexity router** that decides whether one specialist handles a task or whether to fan out into wave-based parallel execution.
- **A QA gate** that runs after every task and can halt the orchestrator on critical findings.
- **A rules system** layered on top of `.claude/CLAUDE.md`. CLAUDE.md is the source of truth; `.software-teams/rules/*.md` adds team-specific guidance the feedback loop accumulates from PR reviews.
- **Worktree integration** for isolated environments when you want the agent to work on a branch without touching your local checkout.

Full reference: [`software-teams.md`](software-teams.md).

---

## Slash commands

Both prefixes invoke the same skills — pick by how you installed.

| Skill | npm CLI prefix | Plugin prefix | What it does |
|---|---|---|---|
| `init` | `/st:init` | `/software-teams:init` | One-time setup in the current project |
| `create-plan` | `/st:create-plan` | `/software-teams:create-plan` | Plan a feature (three-tier by default) |
| `review-plan` | `/st:review-plan` | `/software-teams:review-plan` | Review a plan for one-shot readiness (consistency, contradictions, quality) via `software-teams-quality`; defaults to the current plan, `[plan-name] [plan-part]` to target one. Re-runnable until it passes, then auto-approves. Recommended by `create-plan` but not required. |
| `implement-plan` | `/st:implement-plan` | `/software-teams:implement-plan` | Execute the current plan (add `--workflow` for deterministic execution, `--isolate` to run in a worktree, `--team` for agent-teams) |
| `compile-workflow` | `/st:compile-workflow` | `/software-teams:compile-workflow` | Compile an approved three-tier plan into a deterministic Claude Code Workflow and optionally run it |
| `verify` | `/st:verify` | `/software-teams:verify` | Run the project's quality gates (lint / analyse / test) on demand |
| `quick` | `/st:quick` | `/software-teams:quick` | One-shot focused change, no orchestration |
| `pr-review` | `/st:pr-review` | `/software-teams:pr-review` | Review a PR and post line comments |
| `pr-feedback` | `/st:pr-feedback` | `/software-teams:pr-feedback` | Address PR review comments and learn rules |
| `commit` | `/st:commit` | `/software-teams:commit` | Conventional commit |
| `generate-pr` | `/st:generate-pr` | `/software-teams:generate-pr` | Open a pull request |
| `worktree` | `/st:worktree` | `/software-teams:worktree` | Create an isolated worktree |
| `worktree-merge` | `/st:worktree-merge` | `/software-teams:worktree-merge` | Merge a worktree's branch back into the current branch (and optionally remove it) |
| `worktree-remove` | `/st:worktree-remove` | `/software-teams:worktree-remove` | Remove a worktree and clean up |
| `status` | `/st:status` | `/software-teams:status` | Show current state and next action |
| `statusline` | `/st:statusline` | `/software-teams:statusline` | Install/remove a statusline showing plan · phase · wave · task (needs python3) |
| `routines` | `/st:routines` | `/software-teams:routines` | Recommended recurring routines via `/loop` (local) and `/schedule` (cloud) |
| `orchestrator-mode` | `/st:orchestrator-mode` | `/software-teams:orchestrator-mode` | Toggle Orchestrator-Only Mode (`on\|off\|status`) — restricts the main thread to read / plan / delegate **code changes** while still letting it manage and ship the work (commit, push, install, build, open PRs); `Edit`, `Write`, `NotebookEdit`, and code-mutating Bash (`sed -i`, `tee`, `>`/`>>` redirects, `rm`/`mv`/`cp`, destructive git) are hard-blocked by a PreToolUse hook (see [`templates/.claude/hooks/orchestrator-deny-bash.sh`](templates/.claude/hooks/orchestrator-deny-bash.sh) for the full deny list). Specialists invoked via `Task` are unaffected. Per-project only. |
| `ask-questions` | `/st:ask-questions` | `/software-teams:ask-questions` | Toggle the Ask Clarifying Questions policy (`on\|off\|status`) — overrides the Claude Code harness's hardcoded auto-mode reminder that tells Claude to "work without stopping for clarifying questions." When `on`, Claude and sub-agents are told to ask substantive questions about ambiguous architectural/scope decisions even in auto permission mode. No hooks — pure prompt-layer policy. Per-project only. |

---

## GitHub Actions setup

```bash
software-teams setup-action
```

This drops `.github/workflows/software-teams.yml` into your repo. Then:

1. Add `ANTHROPIC_API_KEY` to your repo secrets.
2. (Optional) Set `SOFTWARE_TEAMS_AUTH_ENABLED=true` and `SOFTWARE_TEAMS_ALLOWED_USERS` to restrict who can trigger.
3. Comment on any issue/PR:

   ```
   Hey software-teams plan <description>
   Hey software-teams implement
   Hey software-teams quick <small fix>
   Hey software-teams review
   Hey software-teams do <clickup-ticket-url>
   ```

The action threads its responses, supports refinement (`change task 2…`), and respects an explicit `approved` gate before implementation. Plans live in the cache; rules can be persisted to your repo or pushed to a shared rules repo across projects.

---

## Run it as n8n nodes

Software Teams also ships as a set of **n8n community nodes** — run each specialist as a node on a visual workflow canvas, hand off between them over the wire, and pause for human review in Slack. Published as [`@websitelabs/n8n-nodes-software-teams`](packages/n8n).

> **Self-hosted n8n only.** The nodes execute the `claude` binary inline on the n8n worker, which n8n Cloud forbids. Each worker needs the `claude` CLI on `PATH` and an Anthropic key in the credential.

Install via **Settings → Community Nodes → Install** in your self-hosted instance:

```
@websitelabs/n8n-nodes-software-teams
```

Five nodes appear under the **Software Teams** palette section. They share one encrypted **Software Teams API** credential and pass a single typed `NodeEnvelope` between them:

| Node | What it does |
|------|--------------|
| **Trigger Ingestion** | Fetches PII-scrubbed context from a ClickUp ticket or Datadog issue and emits the initial envelope |
| **Agent** | Runs one specialist for one turn via `claude` (Task tool disabled); chain A→B for multi-agent handoff |
| **Orchestrator** | Plans an epic and emits one envelope per wave-task in dependency order; run state persists for resumable partial failures |
| **Slack HITL** | Posts a question to Slack, pauses the workflow, and resumes the agent with the human's reply folded into context |
| **Output** | Opens a GitHub PR (or issue) from the final envelope |

Secrets live only in n8n's encrypted credential store — never in node parameters, output, or execution logs.

**Can't install the package?** (n8n Cloud, or a locked-down worker) — the same engine is exposed as CLI verbs (`software-teams ingest | agent-turn | orchestrator-turn | output`) you can wire into n8n's built-in **Execute Command** nodes. See the [manual recipe](packages/n8n/MANUAL-RECIPE.md).

Full node reference, parameters, the inter-node data contract, and an importable example workflow: [`packages/n8n/README.md`](packages/n8n/README.md).

---

## The specialists

Software Teams ships 33 specialist agents organised by team. You don't pick them by hand — the planner pins each task to the right specialist via the agent router, and the orchestrator spawns them. Listed here for transparency, not as a UX surface you need to memorise.

<details>
<summary>Show full roster</summary>

| Team | Specialists |
|------|-------------|
| **Engineering** | `backend`, `frontend`, `architect`, `programmer`, `debugger`, `perf-analyst`, `security` |
| **Product & Research** | `planner`, `dev-planner`, `researcher`, `phase-researcher`, `product-lead`, `ux-designer` |
| **Quality** | `quality`, `qa-tester`, `verifier`, `plan-checker` |
| **DevOps** | `devops` |
| **Delivery** | `committer`, `pr-generator`, `pr-feedback`, `feedback-learner` |
| **Oversight** | `producer`, `head-engineering`, `codebase-mapper` |
| **Game development** | `game-designer`, `game-producer`, `game-engineer`, `game-ai-engineer`, `game-art-pipeline`, `game-devops`, `game-qa`, `game-tech-artist` |

Each specialist is a `.claude/agents/software-teams-<role>.md` file generated by `software-teams sync-agents` from the canonical sources in `packages/cli/agents/`. Re-run sync-agents after upgrades to refresh.

</details>

---

## Configuration

Everything lives under `.software-teams/`:

```
.software-teams/
├── state.yaml          # current plan, progress, review status
├── config/
│   ├── config.yaml     # workflow + model config
│   └── adapter.yaml    # tech stack + quality gates
├── plans/              # spec.md / orchestration.md / T{n}.md slices
├── rules/              # team rules (general/backend/frontend/testing/devops + commits/deviations)
├── persistence/        # codebase index, spawn ledger
└── feedback/           # PR feedback drafts (when --no-comments)
```

Project-type adapters (`adapters/<type>.yaml`) define quality gates per stack — e.g. PHP/Laravel runs `composer test` and `composer cs`, TypeScript runs `bun test` and `bun run typecheck`. Override via `.software-teams/config/adapter.yaml`.

### Generated `.claude/` artefacts & `.gitignore`

In **CLI mode**, `software-teams init` also generates Claude Code artefacts:

```
.claude/
├── agents/software-teams-*.md   # 33 specialist specs (from packages/cli/agents/)
├── commands/st/*.md             # the /st:* skills
├── hooks/*.sh                   # quality gate, state-context (SessionStart), orchestrator-mode, team gate
├── statusline/                  # the optional statusline renderer
├── settings.json                # tool allowlist + hook wiring
├── AGENTS.md, RULES.md          # generated agent catalogue + orchestration doctrine
└── CLAUDE.md                    # routing block
```

These — plus `.software-teams/` — are **gitignored by default**. `init` writes (and refreshes on every run) a managed block in your `.gitignore`, because every one of these is regenerated per-clone by `software-teams init` / `sync-agents` and would otherwise show up as dozens of untracked files. Clone → run `software-teams init` → everything is regenerated.

To **version-control** any artefact (e.g. a shared `settings.json`, or your project's `CLAUDE.md`), remove that line from the managed block. Custom agents you add under `.claude/agents/` that aren't named `software-teams-*` stay tracked — the ignore is prefix-scoped. (Plugin/`--state-only` installs generate no `.claude/` specs at all — the plugin supplies them natively.)

---

## Status

- **Stable**: planning, implementation, commit, PR generation, PR review, GitHub Actions runtime.
- **Recent**: deterministic Workflow compiler (`compile-workflow` / `--workflow`); automatic quality-gate + state-durability hooks; on-demand `verify`; worktree merge-back (`worktree-merge` / `--isolate`); a plan/phase/task statusline; LSP for code-touching agents; recurring `routines`; and experimental agent-teams specialist-to-specialist collaboration (`--team`).
- **Next**: ([open an issue](https://github.com/zottiben/software-teams/issues) to weigh in)

Tested on macOS and Linux with Bun ≥ 1.0 and Claude Code ≥ 1.0. Node 18+ supported via npm.

---

## Contributing

Software Teams is opinionated software. PRs that align with the existing patterns (single-concern agents, scoped spawn prompts, three-tier plans) are welcome. PRs that add a 25th specialist or a new top-level concept will need a strong case in the issue first — surface area is a feature.

```bash
git clone https://github.com/zottiben/software-teams
cd software-teams
bun install
bun run build
bun test
```

The repo is a **monorepo**: `packages/cli` (`@websitelabs/software-teams` — the CLI, plugin, and specialist sources) and `packages/n8n` (`@websitelabs/n8n-nodes-software-teams` — the community nodes). The root scripts (`bun run build`, `bun run typecheck`, `bun run lint`, `bun test`) delegate across both packages.

The framework is self-hosted: it uses its own workflows to develop itself. Run `software-teams sync-agents` after editing anything in `packages/cli/agents/` to regenerate the `.claude/agents/` mirror.

---

## License

MIT — see [LICENSE](LICENSE).
