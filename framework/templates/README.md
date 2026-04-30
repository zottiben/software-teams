# Framework Templates

Canonical scaffolding the Software Teams planner and implement-plan skills read and write
against. All placeholders use `{like_this}` syntax.

## Planning Templates

Software Teams supports two plan shapes. Pick based on plan size and team shape, not by
preference.

### Three-tier (default for non-trivial plans)

Spec-kit-style separation of concerns. Each tier has a different audience and
a different lifetime.

| Template | Tier | Purpose | Audience |
|----------|------|---------|----------|
| `SPEC.md` | 1 — WHAT | Problem, acceptance criteria, out-of-scope, glossary | Reviewer, future maintainer |
| `ORCHESTRATION.md` | 2 — HOW | Task graph, agent routing, sequencing rules, quality gates | Orchestrator (implement-plan) |
| `PLAN-TASK-AGENT.md` | 3 — slice | One file per task; what a single agent loads when spawned | The agent itself |

Cross-links use exact slug-derived paths:
- `{slug}.spec.md`
- `{slug}.orchestration.md`
- `{slug}.T{n}.md` (per-agent slices)

Slug derivation rules live in `framework/agents/software-teams-planner.md` (lowercase,
drop fillers, 2-4 words, hyphens).

**Use three-tier when:** >3 implementation tasks, cross-team / multi-agent
work, or any plan where a separate WHAT vs HOW boundary helps reviewers.

### Single-tier (legacy / quick)

| Template | Purpose |
|----------|---------|
| `PLAN.md` | Monolithic plan: frontmatter + objective + task manifest + verification |
| `PLAN-TASK.md` | Per-task file referenced from `PLAN.md`'s `task_files:` |

**Use single-tier when:** `/st:quick` flows, hotfixes, or plans with 1-3
tasks where the three-tier ceremony exceeds the work.

## Project Scaffolding (unchanged)

| Template | Purpose |
|----------|---------|
| `PROJECT.yaml` | Project identity: name, summary, core value, tech stack, constraints |
| `REQUIREMENTS.yaml` | Capabilities, risks, constraints — long-lived |
| `ROADMAP.yaml` | Phase / plan ordering and milestones |
| `SUMMARY.md` | Per-plan outcome record (written by software-teams-programmer post-execution) |
| `CLAUDE-SHARED.md` | Shared context imported into the project's `CLAUDE.md` |
| `RULES.md` | Per-project rule notes |

## Authoring Notes

- Frontmatter must be parseable by `yaml@2.7.0` (the framework-lint suite
  uses `yaml.parse`).
- Keep templates terse — they are target shapes, not exhaustive examples.
- Each template should be readable in under 60 seconds.
- Do not redefine slug derivation here; the planner owns it.
