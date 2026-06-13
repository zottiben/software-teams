---
name: init
description: "Software Teams: Initialise Software Teams commands in the current project"
---

# /st:init

Initialise Software Teams in the current project (plugin mode).

## Direct Execution

### Step 1: Resolve the CLI

Resolve the CLI per `commands/_shared/cli-invocation.md`. If resolution fails the
fragment's fail-fast block exits with both install commands — stop here.

After resolution, `$ST_CLI` is available for the steps below.

### Step 2: Run state-only init

```bash
$ST_CLI init --state-only
```

`--state-only` skips the `.claude/` artefacts the plugin already supplies
natively — `.claude/commands/st/` stubs and `.claude/agents/` files. It **does**
install framework infrastructure the plugin does *not* ship: the
`.claude/hooks/` scripts (`quality-gate.sh`, `orchestrator-deny-bash.sh`) and the
deterministic SubagentStop quality-gate wiring in `.claude/settings.json`. The
quality gate runs the project's fast gates via `software-teams verify` after each
specialist completes.

### Step 3: Offer lint-fix hook (single prompt)

Ask the user via AskUserQuestion:

> Would you like to register a `PostToolUse` lint-fix hook in
> `.claude/settings.local.json`? It runs `bun run lint:fix` asynchronously
> (non-blocking) after Edit/Write tool calls on frontend files.
>
> Answer **yes** to add it, **no** to skip.

**If yes:** merge the hook entry into `.claude/settings.local.json` (create the
file and the `.claude/` directory if they do not yet exist). Do NOT overwrite
unrelated hooks — merge into the existing `hooks` array.

**If no:** proceed to Step 4 immediately.

This is a **separate, opt-in skill step** — it is not performed by
`init --state-only`. Writing `.claude/settings.local.json` on an explicit yes
does not violate `--state-only` semantics (the CLI's flag governs only its own
scaffolding output).

### Step 4: Completion

Print a short message, for example:

> Software Teams initialised. Run `software-teams:create-plan` to plan your next
> feature, or `software-teams:implement-plan` to start building.
>
> Skills are available as `software-teams:*` commands — no `/st:*` stubs are
> generated in plugin mode.

Do **not** list every available command, do **not** prompt for a tech stack, and
do **not** run any `--help` calls.

## Arguments

| Argument | Description |
|----------|-------------|
| _(none)_ | Plugin init runs `--state-only` by default; no flags are exposed to the user |
