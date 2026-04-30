---
name: init
description: "Software Teams: Initialise Software Teams commands in the current project"
---

<!-- AUTO-GENERATED — do not hand-edit; run `software-teams build-plugin` -->

# /st:init

Initialise the Software Teams slash commands in the current project.

## Direct Execution

### Step 1: Create Directories

```bash
mkdir -p .claude/commands/st
mkdir -p .software-teams/plans .software-teams/research .software-teams/codebase .software-teams/reviews .software-teams/config .software-teams/persistence .software-teams/feedback
```

### Step 2: Copy Command Stubs

Copy all command stubs from the framework to the project. Skip files that already exist and are >500 bytes (unless `--force`).

```bash
for file in .software-teams/framework/commands/*.md; do
  dest=".claude/commands/st/$(basename "$file")"
  if [ ! -f "$dest" ] || [ "$(wc -c < "$dest")" -le 500 ] || [ "$FORCE" = "true" ]; then
    cp "$file" "$dest"
  fi
done
```

> **Do NOT embed command stub content inline.** The source of truth is `.software-teams/framework/commands/`. Copy from there.

### Step 3: Register Claude Code Hooks

Ensure `PostToolUse` lint-fix hook is in `.claude/settings.local.json` (runs `bun run lint:fix` async after Edit/Write). Merge into existing hooks, don't overwrite.

Reference: `.software-teams/framework/hooks/lint-fix-frontend.md`

### Step 4: Register Natural Language Routing

Append Software Teams routing block to `.claude/CLAUDE.md` if not already present (check for `## Software Teams Workflow Routing`). Content includes intent→skill mapping and iterative refinement instructions.

### Step 5: Update .gitignore

Append Software Teams patterns to the project's `.gitignore` if they aren't already present. This prevents Software Teams artefacts from being committed to version control. Users can remove these entries manually if they want to version control Software Teams files.

Patterns added:
```
# Software Teams framework — remove these lines to version control Software Teams artefacts
.software-teams/
.claude/commands/st/
```

Skip if the marker comment `# Software Teams framework` is already in `.gitignore`. Create `.gitignore` if it doesn't exist.

### Step 5.5: Detect and Configure Tech Stack

Detect the project's technology stack by scanning for signature files in the project root.

**Backend detection:**
- `composer.json` + `artisan` → `php-laravel`
- `composer.json` (without artisan) → `php`
- `go.mod` → `go`
- `requirements.txt` or `pyproject.toml` + `manage.py` → `python-django`
- `requirements.txt` or `pyproject.toml` (without manage.py) → `python`
- `Gemfile` + `config/routes.rb` → `ruby-rails`
- `*.csproj` or `*.sln` → `dotnet`
- `package.json` with express/fastify/nest in dependencies → `node-express`

**Frontend detection:**
- `package.json` with `react` in dependencies → `react-typescript` (if also has typescript) or `react`
- `package.json` with `vue` in dependencies → `vue-typescript` or `vue`
- `package.json` with `svelte` in dependencies → `svelte`
- `package.json` with `@angular/core` in dependencies → `angular`
- `package.json` with `next` in dependencies → `nextjs`

**DevOps detection:**
- `Dockerfile` + `k8s/` or `kubernetes/` directory → `docker-k8s`
- `serverless.yml` or `serverless.ts` → `serverless`
- `Procfile` → `heroku`

**Procedure:**
1. Run detection heuristics above against the project root
2. If detection is ambiguous or finds nothing, ask the user: "What backend stack does this project use?" and "What frontend stack?"
3. Write detected/chosen values into PROJECT.yaml `tech_stack` field
4. Verify matching convention files exist in `.software-teams/framework/stacks/`. If a convention file exists for the detected stack, log it. If not, log: "No convention file found for {stack} — agents will use generic domain principles. You can create one at `.software-teams/framework/stacks/{stack}.md` using `_template.md` as a guide."

### Step 6: Initialise Config Files

```bash
cp .software-teams/framework/config/state.yaml .software-teams/config/state.yaml
cp .software-teams/framework/config/variables.yaml .software-teams/config/variables.yaml
cp .software-teams/framework/config/software-teams-config.yaml .software-teams/config/software-teams-config.yaml
```

### Step 7: Generate Markdown Scaffolding

Read templates from `.software-teams/framework/templates/` and write to `.software-teams/` (only if missing):
- PROJECT.yaml, REQUIREMENTS.yaml, ROADMAP.yaml

### Step 8: Display Completion

List all available commands and suggest `/st:create-plan "your feature"` to get started.

## Arguments

| Argument | Description |
|----------|-------------|
| `--force` | Overwrite existing command files |
