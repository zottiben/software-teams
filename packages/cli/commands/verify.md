---
name: verify
description: "Software Teams: Run the project's quality gates (lint / analyse / test) on demand"
allowed-tools: Read, Bash
argument-hint: "[--gate <names>] [--skip <names>] [--json]"
context: |
  !cat .software-teams/config/adapter.yaml 2>/dev/null | head -20
---

# /st:verify

Run the project's quality gates on demand from inside Claude Code — no separate
terminal. These are the same gates the `SubagentStop` quality-gate hook runs
automatically after each specialist; this skill lets you run them whenever you
want (before a commit, after a manual edit, or to spot-check the tree).

## Direct Execution

### Step 1: Resolve the CLI

Resolve the CLI per `commands/_shared/cli-invocation.md`. If resolution fails,
relay the fail-fast block and STOP. After resolution, `$ST_CLI` is available.

### Step 2: Run the gates

Pass `$ARGUMENTS` straight through:

```bash
$ST_CLI verify $ARGUMENTS
```

- No args runs every gate defined in `.software-teams/config/adapter.yaml`.
- `--gate lint,analyse` runs only those gates; `--skip test` excludes the full
  test suite; `--json` emits structured output for tooling.
- Exit 0 = all selected gates passed; non-zero = at least one failed.

### Step 3: Report

Relay the pass/fail outcome. On failure, name the gate(s) that failed and the
key output lines. Do NOT auto-fix — report, and only fix if the user asks (then
delegate the fix to the appropriate specialist).
