---
name: statusline
description: "Software Teams: Install/remove the Software Teams statusline (plan · phase · wave · task)"
allowed-tools: Read, Bash
argument-hint: "[on | off | status]"
---

# /st:statusline

Turn the Software Teams statusline on or off from inside Claude Code — no
separate terminal. It renders a Vice City–styled box showing the model, git
branch, context bar, and the **orchestration state** (plan · phase · wave ·
task · flags) read from `.software-teams/state.yaml`.

The renderer is a stdlib-only Python 3 script; it wires into
`.claude/settings.local.json` (local + gitignored — a personal display
preference, not committed). It never overwrites an unrelated statusLine.

## Direct Execution

### Step 1: Resolve the CLI

Resolve the CLI per `commands/_shared/cli-invocation.md`. If resolution fails,
relay the fail-fast block and STOP. After resolution, `$ST_CLI` is available.

### Step 2: Map the argument and run

- **`on`** (or no argument): `$ST_CLI statusline --install`
  - Copies the renderer into `.claude/statusline/` and wires
    `settings.local.json`. If a different statusLine already exists, it refuses
    and prints the manual snippet — relay that and ask before adding `--force`.
- **`off`**: `$ST_CLI statusline --uninstall` (removes it only if it is ours).
- **`status`**: `$ST_CLI statusline --status` (reports whether it is wired).

### Step 3: Report

Relay the result. On enable, remind the user it requires `python3` and takes
effect on the next statusline refresh. Note: a project statusLine overrides any
global statusline (`~/.claude/settings.json`) for this project only.
