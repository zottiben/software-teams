---
name: init
description: "JDI: Initialise JDI commands in the current project"
---

# /jdi:init

Initialise the JDI slash commands in the current project.

## Direct Execution

### Step 1: Create Directories

```bash
mkdir -p .claude/commands/jdi
mkdir -p .jdi/plans .jdi/research .jdi/config
```

### Step 2: Copy Command Stubs

Copy all command stubs from the framework to the project. Skip files that already exist and are >500 bytes (unless `--force`).

```bash
for file in .jdi/framework/commands/*.md; do
  dest=".claude/commands/jdi/$(basename "$file")"
  if [ ! -f "$dest" ] || [ "$(wc -c < "$dest")" -le 500 ] || [ "$FORCE" = "true" ]; then
    cp "$file" "$dest"
  fi
done
```

> **Do NOT embed command stub content inline.** The source of truth is `.jdi/framework/commands/`. Copy from there.

### Step 3: Register Claude Code Hooks

Ensure `PostToolUse` lint-fix hook is in `.claude/settings.local.json` (runs `bun run lint:fix` async after Edit/Write). Merge into existing hooks, don't overwrite.

Reference: `.jdi/framework/hooks/lint-fix-frontend.md`

### Step 4: Register Natural Language Routing

Append JDI routing block to `.claude/CLAUDE.md` if not already present (check for `## JDI Workflow Routing`). Content includes intent→skill mapping and iterative refinement instructions.

### Step 5: Initialise Config Files

```bash
cp .jdi/framework/config/state.yaml .jdi/config/state.yaml
cp .jdi/framework/config/variables.yaml .jdi/config/variables.yaml
cp .jdi/framework/config/jdi-config.yaml .jdi/config/jdi-config.yaml
```

### Step 6: Generate Markdown Scaffolding

Read templates from `.jdi/framework/templates/` and write to `.jdi/` (only if missing):
- PROJECT.yaml, REQUIREMENTS.yaml, ROADMAP.yaml

### Step 7: Display Completion

List all available commands and suggest `/jdi:create-plan "your feature"` to get started.

## Arguments

| Argument | Description |
|----------|-------------|
| `--force` | Overwrite existing command files |
