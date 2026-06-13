---
name: worktree-merge
description: "Software Teams: Merge a worktree's branch back into the current branch (and optionally remove it)"
allowed-tools: Read, Bash
argument-hint: "[worktree-name] [--remove] [--no-ff]"
context: |
  !git worktree list 2>/dev/null
---

# /st:worktree-merge

Bring a Software Teams worktree's committed work back into your current branch —
the deterministic merge-back that completes the worktree story. Runs in-session,
no separate terminal.

Because Software Teams owns the worktree's branch name (created by
`/st:worktree`), this is deterministic: it merges that branch into the current
branch. It only moves COMMITTED work — uncommitted changes are reported, not
dropped — and conflicts abort cleanly for manual resolution.

## Direct Execution

### Step 1: Resolve the CLI

Resolve the CLI per `commands/_shared/cli-invocation.md`. If resolution fails,
relay the fail-fast block and STOP. After resolution, `$ST_CLI` is available.

### Step 2: Merge back

Pass `$ARGUMENTS` straight through (worktree name + flags):

```bash
$ST_CLI worktree-merge $ARGUMENTS
```

- No name → uses the active worktree from `.software-teams/state.yaml`.
- `--remove` removes the worktree + branch after a successful merge.
- `--no-ff` forces a merge commit.

### Step 3: Report and route

Relay the outcome:
- **Merged** → confirm, and note whether the worktree was removed.
- **Uncommitted changes** → tell the user to commit them in the worktree first
  (or delegate that), then re-run.
- **Conflict** → the merge was aborted to keep the tree clean; offer to resolve
  it (delegate to a specialist) or let the user merge manually.
- **Nothing to merge** → the worktree has no commits ahead; nothing to do.
