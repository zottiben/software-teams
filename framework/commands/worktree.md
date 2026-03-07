---
name: worktree
description: "JDI: Create git worktree with full environment"
---

# /jdi:worktree

Create an isolated git worktree with full project environment from a ticket, task name, or description.

> **CRITICAL: Do NOT use the built-in `EnterWorktree` tool.** It creates a bare worktree without project-specific setup. Always follow the Direct Execution steps below.

## Direct Execution

> **CRITICAL: Ordering matters.** Steps 4–7 are sequential — do NOT parallelise setup steps that depend on configuration being complete first.

1. **Parse name** from `$ARGUMENTS`:
   - Extract ticket ID if present (e.g. "PROJ-1234") — use as prefix
   - Slugify the rest: lowercase, spaces/special chars to hyphens, strip trailing hyphens, max 40 chars
   - Examples: `"PROJ-1234 Add user auth"` → `proj-1234-add-user-auth`
   - Examples: `"fix broken calculator"` → `fix-broken-calculator`
   - If no arguments, generate random adjective-noun name
   - `--lightweight` flag: skip databases, web server setup, SSL (deps + migrate only)
   - `--base <branch>` flag: base branch (default: main)
2. **Validate**: check git repo, branch doesn't exist, required tools available
3. **Create worktree**:
   ```bash
   mkdir -p .worktrees
   git worktree add -b <name> .worktrees/<name> <base-branch>
   ```
4. **`cd` into worktree** — all subsequent commands run from inside the worktree:
   ```bash
   cd .worktrees/<name>
   ```
5. **Project-specific setup** (from adapter config, skip if `--lightweight`):
   - Create databases per adapter config
   - Configure environment files per adapter config
   - Run project-specific web server setup per adapter config
6. **Install dependencies** — these CAN run in parallel:
   ```bash
   # Run dependency install commands from adapter config
   # e.g. composer install, bun install, npm install, etc.
   ```
7. **Project bootstrap** (run sequentially, AFTER environment is configured):
   - Run migration commands per adapter config
   - Run seed commands per adapter config (in dependency order)
   - Run post-setup commands per adapter config
8. **Update state**: set `worktree.active: true`, `worktree.path`, `worktree.branch`, `worktree.created_at`, `worktree.type` in `.jdi/config/state.yaml`
9. **Report**: worktree path, branch, setup summary

**On error**: clean up (reverse database creation, remove worktree, reverse web server setup).

Worktree to create: $ARGUMENTS
