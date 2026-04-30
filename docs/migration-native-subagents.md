# Migration: Native Subagents (v0.2.0)

This release reworks how JDI specialists are spawned inside Claude Code. If you have an existing JDI install, follow the one-command upgrade below — it is non-breaking by default.

Target release: **v0.2.0** (next published `@benzotti/jdi`). Current package version: `0.1.57`.

---

## What changed

- **Native subagents.** JDI specialists are now first-class Claude Code subagents under `.claude/agents/`. `jdi sync-agents` (run automatically by `jdi init`) converts every `framework/agents/jdi-*.md` into a Claude Code-compatible spec via `src/utils/convert-agents.ts`.
- **Doctrine files.** Two new generated files — `.claude/AGENTS.md` (catalogue) and `.claude/RULES.md` (orchestration / quality doctrine) — are imported by `CLAUDE.md` so every session sees the same agent inventory and rules without re-reading the framework tree.
- **Three-tier planning.** `/jdi:create-plan` now writes `SPEC.md` + `ORCHESTRATION.md` + per-agent task slices for non-trivial plans, instead of one monolithic plan file. `--single-tier` forces the legacy single-file layout.
- **Spawn-by-name.** Agents are spawned with `subagent_type="jdi-<name>"` and `mode: "acceptEdits"`. The legacy `subagent_type="general-purpose"` + identity-injection preamble is gone from the hot path; it remains only as a fresh-clone bootstrap fallback.

---

## How to upgrade

One command from the root of your JDI-using project:

```bash
cd <your-jdi-project>
jdi sync-agents
```

Confirm the new artefacts:

```bash
ls .claude/agents/        # jdi-architect.md, jdi-backend.md, ... (one file per JDI specialist)
ls .claude/AGENTS.md      # generated catalogue
ls .claude/RULES.md       # generated orchestration / quality doctrine
```

If your `CLAUDE.md` does not yet import the doctrine files, copy the import block from `framework/templates/CLAUDE-SHARED.md`:

```markdown
@.claude/AGENTS.md
@.claude/RULES.md
```

---

## Breaking changes

- **Custom skills hard-coding `subagent_type="general-purpose"` plus a "You are jdi-X. Read .jdi/framework/agents/..." preamble** should switch to the native form:

  ```text
  Agent(
    subagent_type: "jdi-<name>",     # e.g. jdi-programmer
    mode: "acceptEdits",
    prompt: "<task body — no identity preamble>"
  )
  ```

- The framework-lint test (`src/framework-lint.test.ts`) flags any regression — leftover injection patterns outside the lint-allowlisted fallback block in `framework/components/meta/AgentRouter.md` §4 fail CI.

---

## Feature flag

A new flag controls the migration:

```yaml
# .jdi/config/jdi-config.yaml
features:
  native_subagents: true   # default — generate .claude/agents/ on init/sync
```

- `true` (default): `jdi init` and `jdi sync-agents` write Claude Code-compatible specs to `.claude/agents/`. Spawns use the native pattern.
- `false`: Conversion is skipped. JDI continues to spawn via the legacy injection fallback (see `framework/components/meta/AgentRouter.md` §4). Use this only as a temporary escape hatch during transition.

Implementation: `src/commands/init.ts` and `src/commands/sync-agents.ts` read the flag before invoking `convertAgents()`.

---

## Three-tier planning

`/jdi:create-plan` now produces a layered set of artefacts for non-trivial plans:

| Tier | File | Purpose |
|------|------|---------|
| 1 | `SPEC.md` | What is being built and why |
| 2 | `ORCHESTRATION.md` | Wave / dependency / agent routing |
| 3 | `{plan}.T{n}.md` | Per-agent task slice (one per task) |

Templates:

- [`framework/templates/SPEC.md`](../framework/templates/SPEC.md)
- [`framework/templates/ORCHESTRATION.md`](../framework/templates/ORCHESTRATION.md)
- [`framework/templates/PLAN-TASK-AGENT.md`](../framework/templates/PLAN-TASK-AGENT.md)

Use `--single-tier` to force the legacy single-file plan layout for trivial plans or when you specifically need the old shape.

---

## Rollback

If anything misbehaves during transition:

```yaml
# .jdi/config/jdi-config.yaml
features:
  native_subagents: false
```

The legacy injection paths remain wired end-to-end (router fallback in `AgentRouter.md` §4, planner doc preserves the legacy spawn snippet, lint allowlists the fallback). Re-enable by deleting the flag or setting it back to `true`, then re-running `jdi sync-agents`.

---

## Keeping the framework snapshot fresh

`jdi init` populates `.jdi/framework/` with a snapshot of the canonical `framework/` tree at install time. As JDI evolves, that snapshot can drift from canonical. Two maintenance commands keep both layers in sync:

| Command | Refreshes | When to use |
|---------|-----------|-------------|
| `jdi sync-framework` | `.jdi/framework/` (full snapshot) **+** `.claude/agents/` (auto-rerun) | Framework upgrade — you bumped the JDI version, or canonical agents/templates/components changed. |
| `jdi sync-agents` | `.claude/agents/` only | Quick agent-only refresh — the snapshot is already fresh and you only need to regenerate native subagent files. |

Useful flags:

```bash
jdi sync-framework --dry-run    # preview the diff between canonical and the snapshot
jdi sync-framework              # refresh in place (overwrites drifted files)
```

Project state files (`PROJECT.yaml`, `REQUIREMENTS.yaml`, `ROADMAP.yaml`, `.jdi/config/state.yaml`) are preserved — `sync-framework` never writes to those paths. After a refresh, `diff -rq framework .jdi/framework` should report only the `adapters/` directory (intentionally excluded from the snapshot).

---

## Carryover candidates for next plan

Items intentionally deferred from this migration:

- **`.claude/commands/` regeneration in installed projects.** This plan converted `framework/agents/` to `.claude/agents/`. The equivalent flow for command stubs (`framework/commands/` → `.claude/commands/<project>/`) for downstream JDI installs is not yet automated. Track in a follow-up plan.
- **Runtime token-ledger instrumentation (R-06 follow-up).** The R-06 risk register noted that we lack hard runtime measurement of the per-spawn token savings claimed in `framework/jdi.md`. Add lightweight telemetry around `Agent` spawn calls in a follow-up.
- **CLAUDE.md auto-patching for older installs.** If an existing project's `CLAUDE.md` predates the doctrine imports, `jdi sync-agents` does not patch it. Manual copy from `framework/templates/CLAUDE-SHARED.md` is required (see [How to upgrade](#how-to-upgrade)).
- **Migration smoke test.** A `bun test` smoke check that verifies the migration note's required sections is not yet wired; the framework-lint suite covers spawn patterns but not doc structure.
