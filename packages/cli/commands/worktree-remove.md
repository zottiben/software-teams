---
name: worktree-remove
description: "Software Teams: Remove git worktree and clean up"
---

# /st:worktree-remove

Remove a git worktree and clean up all associated resources.

## Direct Execution

1. **Identify worktree** from `$ARGUMENTS`:
   - If name provided: use `.worktrees/<name>`
   - If no arguments: read `worktree.path` from `.software-teams/state.yaml`
   - If neither: list worktrees via `git worktree list`, prompt which to remove
   - `--force` flag: skip confirmation prompt
   - `--keep-branch` flag: don't delete the git branch after removal
2. **Confirm** with user (unless `--force`): show worktree path, branch, resources that will be cleaned up
3. **Project-specific cleanup** (from adapter config):
   - Drop databases per adapter config
   - Remove web server configuration per adapter config
4. **Remove worktree**: `git worktree remove .worktrees/<name> --force`
5. **Delete branch** (unless `--keep-branch`):
   - Merged: `git branch -d <name>`
   - Unmerged: `git branch -D <name>` (warn user first)
6. **Clean up**: `rmdir .worktrees 2>/dev/null` (only if empty)
7. **Update state**: set `worktree.active: false`, clear `worktree.path`, `worktree.branch` in `.software-teams/state.yaml`
8. **Report**: what was removed

Reference: .software-teams/framework/hooks/software-teams-worktree-cleanup.md

Worktree to remove: $ARGUMENTS
