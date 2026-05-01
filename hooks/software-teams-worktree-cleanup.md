---
name: software-teams-worktree-cleanup
description: Clean up git worktree and associated branch after execution
---

# Worktree Cleanup Hook

Clean up the git worktree and associated branch after worktree-based execution completes.

---

## When to Execute

This hook is invoked after worktree execution completes, either:
- After a **merge** (branch was merged into current branch)
- After a **discard** (changes were discarded)

---

## Cleanup Steps

### 1. Remove the Git Worktree

```bash
git worktree remove .worktrees/software-teams-{plan-id} --force
```

The `--force` flag is used to handle cases where the worktree has uncommitted changes (which shouldn't happen in normal flow but provides safety).

### 2. Delete the Branch

**If branch was merged:**
```bash
git branch -d software-teams/{plan-id}
```
Uses `-d` (safe delete) since the branch was already merged.

**If branch was NOT merged (discard):**
```bash
git branch -D software-teams/{plan-id}
```
Uses `-D` (force delete) since the branch was never merged.

### 3. Remove Empty Worktrees Directory

```bash
rmdir .worktrees 2>/dev/null
```

Only removes the directory if it's empty. Silently fails if other worktrees exist.

---

## Error Handling

### Worktree Removal Fails

If the worktree removal fails (e.g., uncommitted changes, locked files):

```
⚠️ Warning: Could not remove worktree automatically.

Manual cleanup commands:
  git worktree remove .worktrees/software-teams-{plan-id} --force
  rm -rf .worktrees/software-teams-{plan-id}
```

### Branch Deletion Fails

If the branch deletion fails:

```
⚠️ Warning: Could not delete branch automatically.

Manual cleanup command:
  git branch -D software-teams/{plan-id}
```

---

## State Update

After cleanup, update `.software-teams/config/state.yaml`:

1. Read `.software-teams/config/state.yaml`
2. Clear any worktree-related state:
   ```yaml
   worktree:
     active: false
     path: null
     branch: null
   ```
3. Write the updated YAML back

---

## Full Cleanup Sequence

```bash
# 1. Remove worktree
git worktree remove .worktrees/software-teams-{plan-id} --force

# 2. Delete branch (use -d if merged, -D if not)
git branch -d software-teams/{plan-id}  # or -D for discarded

# 3. Clean up empty directory
rmdir .worktrees 2>/dev/null

# 4. Update state (handled by Read/Write tools)
```

---

## Usage Example

Called from `st-implement-plan.md` Step 3: Post-Execution:

```
After user selects "merge" or "discard":
1. If merge: git merge software-teams/{plan-id}
2. Invoke this cleanup hook
3. Report cleanup complete
```
