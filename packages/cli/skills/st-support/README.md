# `skills/st-support/` — Shared Prompt Fragments

This directory holds canonical markdown fragments that are consumed by BOTH
the local Claude Code skill files (`skills/*/SKILL.md`) and the GitHub Action's
prompt builder (`src/commands/action/router-prompts.ts`). The intent is a
single source of truth: when an instruction needs to change (Anthropic
adjusts model behaviour, a new flow type lands, a fragment is reworded for
clarity), it changes in ONE place.

## How the action consumes a fragment

```ts
import threeTierArtifacts from "../../../../skills/st-support/plan-three-tier-artifacts.md"
  with { type: "text" };
```

`bun build --target=bun` inlines the file's text at build time. The fragment
ships embedded in `dist/index.js`; the runtime never reads the source file.

## How the local skill consumes a fragment

The skill files reference fragments by path:

> The plan must produce the artifacts documented in
> `${CLAUDE_SKILL_DIR}/../st-support/plan-three-tier-artifacts.md`.

Claude Code's user-facing flow Reads the file when the agent needs the
canonical contract. Skill files DESCRIBE the workflow and POINT AT the
fragments — they don't inline their content.

## Rules for adding a fragment

- Fragments are PURE markdown. No template syntax, no interpolation. The
  consuming code adds run-specific values (issue number, repo) around the
  fragment, not inside it.
- Each fragment covers ONE concern. Don't bundle "scope rules + tasks
  table + agent mapping" into one file — split them.
- Filenames use lowercase-with-hyphens, no leading underscore.
- This directory intentionally has no `SKILL.md`, so Claude Code does not
  register it as an invocable skill.

## Current fragments

| Fragment | Used by |
|---|---|
| `AGENTS-MODELS.md` | Maintainer reference for canonical agent model, effort, and tool policy |
| `self-reference-style.md` | `router-prompts.ts` (both single-spawn brief + orchestrator) |
| `plan-three-tier-artifacts.md` | `router-prompts.ts` (`buildPlanBrief`) + `skills/create-plan/SKILL.md` (Step 7) |
| `pr-template-conciseness.md` | `router-prompts.ts` (template-filling instructions in both single-spawn + orchestrator briefs) |
