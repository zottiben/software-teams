# JDI

**JDI aka Jedi — Multi-agent development framework for Claude Code — plan, implement, review, and ship with specialist agents and minimal token overhead.**

[![npm version](https://img.shields.io/npm/v/@benzotti/jedi)](https://www.npmjs.com/package/@benzotti/jedi) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

JDI orchestrates specialised agents to plan, implement, review, and ship features — from single-file fixes to full-stack multi-wave implementations. It runs in three modes: **Claude Code app**, **CLI**, and **GitHub Actions**.

---

## Table of Contents

- [Usage Modes](#usage-modes)
- [Getting Started](#getting-started)
- [Commands](#commands)
- [GitHub Actions Setup](#github-actions-setup)
- [Features](#features)
- [Agents](#agents)
- [Teams](#teams)
- [Configuration](#configuration)
- [Security](#security)
- [Directory Structure](#directory-structure)
- [Architecture](#architecture)

---

## Usage Modes

JDI runs in three modes with identical capabilities:

| Mode | How | Best For |
|------|-----|----------|
| **Claude Code App** | `/jdi:create-plan`, `/jdi:implement-plan`, etc. | Interactive development with Claude Code |
| **CLI** | `jdi plan`, `jdi implement`, `jdi quick`, etc. | Terminal workflows, scripting, CI |
| **GitHub Actions** | Comment `Hey JDI plan ...` on issues/PRs | Autonomous code generation from issue comments |

---

## Getting Started

### Claude Code App

```bash
bun install -g @benzotti/jedi
jdi init
```

Then inside Claude Code:
```
/jdi:create-plan "Add user authentication"
/jdi:implement-plan
/jdi:commit
/jdi:generate-pr
```

### CLI

```bash
bun install -g @benzotti/jedi
jdi init

jdi plan "Add user authentication"
jdi implement
jdi quick "fix the broken quote calculator"
jdi review 42
jdi pr
```

### GitHub Actions

```bash
jdi setup-action
```

Then on any issue or PR, comment:
```
Hey JDI plan Add user authentication
Hey JDI implement
Hey JDI quick fix the broken login button
```

See [GitHub Actions Setup](#github-actions-setup) for details.

---

## Commands

| Slash Command | CLI Equivalent | Description |
|---------------|----------------|-------------|
| `/jdi:init` | `jdi init` | Initialise JDI in the current project |
| `/jdi:create-plan` | `jdi plan <desc>` | Create an implementation plan |
| `/jdi:implement-plan` | `jdi implement [plan]` | Execute a plan (single-agent or Agent Teams) |
| `/jdi:quick` | `jdi quick <desc>` | Quick focused change without orchestration |
| `/jdi:commit` | `jdi commit` | Create a conventional commit |
| `/jdi:generate-pr` | `jdi pr` | Generate and create a pull request |
| `/jdi:pr-review` | `jdi review <pr>` | Review a PR and post line comments |
| `/jdi:pr-feedback` | `jdi feedback` | Address PR review comments |
| `/jdi:worktree` | `jdi worktree` | Create an isolated git worktree |
| `/jdi:worktree-remove` | `jdi worktree-remove` | Remove a worktree and clean up |
| `/jdi:status` | `jdi status` | Show current state and suggest next action |

### CLI Flags

#### `jdi plan`
| Flag | Description |
|------|-------------|
| `--print` | Print prompt to stdout instead of executing |
| `--output <file>` | Write prompt to file |

#### `jdi implement`
| Flag | Description |
|------|-------------|
| `--team` | Force Agent Teams mode |
| `--single` | Force single-agent mode |
| `--dry-run` | Preview changes without writing files |
| `--print` | Print prompt to stdout |

#### `jdi quick`
| Flag | Description |
|------|-------------|
| `--dry-run` | Preview changes without writing files |
| `--print` | Print prompt to stdout |

#### `jdi pr`
| Flag | Description |
|------|-------------|
| `--draft` | Create as draft PR |
| `--base <branch>` | Base branch (default: main) |
| `--no-push` | Skip pushing the branch |
| `--dry-run` | Show generated PR without creating |

---

## GitHub Actions Setup

### Installation

Run `jdi setup-action` to generate the workflow file, or manually copy `action/workflow-template.yml` to `.github/workflows/jedi.yml`.

### Required Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `CLICKUP_API_TOKEN` | No | ClickUp integration for ticket-driven development |

### Optional Variables

| Variable | Description |
|----------|-------------|
| `JEDI_AUTH_ENABLED` | Set to `true` to restrict JDI to write collaborators |
| `JEDI_ALLOWED_USERS` | Comma-separated list of allowed GitHub usernames |

### Comment Syntax

| Command | Description |
|---------|-------------|
| `Hey JDI plan <description>` | Create an implementation plan |
| `Hey JDI implement` | Execute the current plan |
| `Hey JDI implement --dry-run` | Preview implementation without writing |
| `Hey JDI quick <description>` | Make a quick change |
| `Hey JDI review` | Review the current PR |
| `Hey JDI do <clickup-url>` | Full flow: plan + implement from ticket |
| `Hey JDI ping` | Check framework status |

### Conversation Flow

1. Comment `Hey JDI plan ...` to start planning
2. JDI posts the plan and asks for feedback
3. Reply with refinement feedback (e.g. "change task 2 to use Redis instead")
4. Say "approved" or "lgtm" to lock the plan
5. Comment `Hey JDI implement` to execute
6. Reply with follow-up feedback to iterate on the implementation

JDI maintains conversation context across comments — no need to repeat earlier instructions.

---

## Features

### Planning and Implementation

1. **Research** — The planner agent analyses your codebase and gathers context
2. **Plan** — Produces a structured `PLAN.md` with task breakdown, dependencies, and success criteria
3. **Execute** — The complexity router decides single-agent or Agent Teams mode
4. **Verify** — Quality gates run automatically after execution
5. **Commit** — Each task gets its own atomic conventional commit

### Dry-Run Mode

Preview what JDI would change without writing any files:

```bash
jdi implement --dry-run
jdi quick --dry-run "add error handling to the API"
```

Or in GitHub Actions: `Hey JDI implement --dry-run`

In dry-run mode, JDI can only read files — writes, commits, and pushes are blocked.

### Plan-Aware PR Generation

`jdi pr` reads the current plan from state.yaml and generates a richer PR body:
- Summary derived from the plan objective
- Task list from the plan breakdown
- Verification checklist from plan criteria

### Automated Verification Runner

After implementation (both CLI and GitHub Actions), JDI automatically runs quality gates defined in `adapter.yaml`:

```yaml
quality_gates:
  lint: "bun run lint"
  typecheck: "bun run typecheck"
  test: "bun test"
```

Results are printed in the CLI and posted as a collapsible section in GitHub comments.

### Git Worktrees

Full-environment git worktrees for isolated development:

- **Full worktree** (`--worktree`): databases, dependencies, migrations, seeders, web server
- **Lightweight worktree** (`--worktree-lightweight`): dependencies and migrations only

### Agent Teams

For complex plans (>3 tasks, multiple tech stacks, or multiple waves), JDI uses Claude Code's Agent Teams to orchestrate multiple specialist agents working in parallel.

### Complexity Router

| Signal | Simple | Complex |
|--------|--------|---------|
| Task count | 1-3 | >3 |
| Tech stacks | Single | Mixed |
| Wave count | 1 | >1 |

Override with `--team` or `--single`.

### PR Workflow

- **`jdi review <pr>`** — Structured code review with severity-classified findings posted as line comments
- **`jdi feedback`** — Address review comments systematically, learning from team patterns
- **`jdi pr`** — Create a PR with plan-aware description

### Component System

JSX-like reusable instruction syntax:

```markdown
<JDI:Commit />                      # Full component
<JDI:Verify scope="plan" />         # With parameters
<JDI:PRReview post="false" />       # Local review mode
```

**Available components:**

| Component | Category | Purpose |
|-----------|----------|---------|
| `Commit` | execution | Create conventional commits |
| `Verify` | execution | Multi-level verification |
| `VerifyAdvanced` | execution | Phase and requirements verification |
| `CodebaseContext` | execution | Load and cache codebase analysis |
| `PRReview` | quality | Structured PR review (remote and local modes) |
| `TaskBreakdown` | planning | Break features into tasks |
| `WaveComputation` | planning | Compute dependency-ordered waves |
| `AgentBase` | meta | Base protocol for all agents |
| `AgentTeamsOrchestration` | meta | Agent Teams lifecycle management |
| `ComplexityRouter` | meta | Route plans to single-agent or swarm |
| `TeamRouter` | meta | Route commands to teams |
| `StateUpdate` | meta | Record decisions, deviations, blockers |

### State Management

All state lives in YAML files on disk — no context pollution:

| File | Purpose |
|------|---------|
| `.jdi/config/state.yaml` | Runtime state — position, progress, review status |
| `.jdi/config/adapter.yaml` | Project-type adapter config (tech stack, quality gates) |
| `.jdi/config/jdi-config.yaml` | Global configuration (workflow, models) |

### PR Feedback Learning

JDI detects learning phrases from PR reviews ("we usually do this", "convention is") and captures them to categorised learnings files in `.jdi/framework/learnings/` for future reference.

---

## Agents

20 specialised agents organised by team:

### Engineering
| Agent | Role |
|-------|------|
| `jdi-backend` | Backend Engineer |
| `jdi-frontend` | Frontend Engineer |
| `jdi-architect` | Systems Architect |
| `jdi-programmer` | Senior Fullstack Engineer |

### Product and Research
| Agent | Role |
|-------|------|
| `jdi-planner` | Product Manager / Planner |
| `jdi-researcher` | Senior Analyst |
| `jdi-product-lead` | Product Lead |
| `jdi-ux-designer` | Lead UI/UX Designer |

### Quality Assurance
| Agent | Role |
|-------|------|
| `jdi-quality` | Lead QA Developer |
| `jdi-verifier` | Senior QA Developer |

### DevOps
| Agent | Role |
|-------|------|
| `jdi-devops` | DevOps Engineer |

### Supporting
| Agent | Role |
|-------|------|
| `jdi-committer` | Commit specialist |
| `jdi-pr-generator` | PR generation |
| `jdi-pr-feedback` | PR feedback handler |
| `jdi-debugger` | Debugging specialist |
| `jdi-head-engineering` | Head of Engineering (oversight) |
| `jdi-codebase-mapper` | Codebase indexing |
| `jdi-feedback-learner` | Learning extraction |
| `jdi-plan-checker` | Plan validation |

All agents inherit `<JDI:AgentBase />` which defines sandbox awareness, structured returns, and component resolution.

---

## Teams

| Team | Members | Purpose |
|------|---------|---------|
| **Engineering** | backend, frontend, architect, executor | All coding |
| **Product & Research** | planner, researcher, product-lead, ux-designer | Planning (no code) |
| **Quality Assurance** | quality, verifier | Testing, verification |
| **DevOps** | devops | Infrastructure, CI/CD |
| **Micro-Management** | product-lead, head-engineering | Oversight (opt-in) |

---

## Configuration

Global configuration in `.jdi/config/jdi-config.yaml`:

```yaml
workflow:
  mode: yolo          # yolo | interactive | strict
  depth: standard     # shallow | standard | deep

models:
  profile: balanced   # quality | balanced | budget

quality:
  run_lint_before_commit: true
  run_tests_before_pr: true
```

---

## Security

JDI v0.1.30 includes several security hardening measures:

- **Opt-in authorization gate**: Restrict JDI to write collaborators or an explicit allow-list via `JEDI_AUTH_ENABLED` and `JEDI_ALLOWED_USERS` repo variables
- **Prompt injection defense**: User input is sanitized (injection preambles stripped) and wrapped in XML fences with untrusted-content warnings
- **Shell injection prevention**: All workflow arguments are individually quoted — no unquoted variable expansion
- **Comment pagination limits**: Comment fetching is bounded to 100 items
- **Storage path traversal prevention**: Storage keys with path traversal characters are rejected
- **YAML state management**: State updates use a proper YAML parser instead of regex

---

## Directory Structure

```
src/                                 # CLI source (TypeScript)
├── commands/                        # CLI commands
├── utils/                           # Utilities (prompt-builder, state, verify, sanitize)
├── storage/                         # Pluggable storage adapters
└── index.ts                         # Entry point

framework/                           # Distributable framework
├── agents/                          # Agent specifications (20 agents)
├── commands/                        # Command stub templates
├── components/                      # Reusable component instructions
│   ├── execution/                   # Commit, Verify, CodebaseContext
│   ├── planning/                    # TaskBreakdown, WaveComputation
│   ├── quality/                     # PRReview
│   └── meta/                        # AgentBase, ComplexityRouter, TeamRouter, StateUpdate
├── teams/                           # Team definitions (5 teams)
├── adapters/                        # Project-type configs
├── templates/                       # PLAN, PLAN-TASK, SUMMARY, CLAUDE-SHARED, PROJECT/REQUIREMENTS/ROADMAP.yaml
├── learnings/                       # Category shells for PR review learnings
└── jdi.md                           # Framework architecture doc

action/                              # GitHub Actions
└── workflow-template.yml            # Workflow template for `jdi setup-action`
```

---

## Architecture

### Minimal Context

Commands are ultra-minimal stubs (~300 tokens). Agents read specs and components on-demand in their isolated context. Take this with a grain of salt 🧂.

| Scenario | Without JDI | With JDI | Savings |
|----------|-------------|----------|---------|
| Single command | ~6,900 tokens | ~300 tokens | 95% |
| 5-command workflow | ~34,500 tokens | ~1,500 tokens | 96% |

### Agent Delegation

Complex operations spawn agents via the Task tool. Each agent runs in an isolated context with its own spec and components.

### External State

All state lives in YAML files on disk. No context pollution from state tracking.

---
