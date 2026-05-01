---
name: pre-commit
description: Validation before creating a commit
trigger: commit_attempt
---

# Pre-Commit Hook

Validation performed before creating any commit.

---

## Trigger

Fires when:
<!-- whole-component: descriptive trigger reference — names the component as a whole, not a section invocation -->
- @ST:Commit component invoked
- `/st-commit` command run
- Manual commit through JDI workflow

---

## Validation Steps

### 1. Check Staged Files

```bash
git diff --cached --name-only
```

**Verify:**
- At least one file staged
- No unintended files (logs, secrets, temp)
- Files match expected task files

### 1b. CRITICAL: Validate Excluded Directories

**The following directories must NEVER be staged:**
- `.worktrees/**` - Git worktrees are execution infrastructure
- `.software-teams/**` - JDI runtime state and configuration

```bash
# Check for excluded files in staging
EXCLUDED=$(git diff --cached --name-only | grep -E "^(\.worktrees/|\.software-teams/)")
if [ -n "$EXCLUDED" ]; then
  echo "ERROR: Excluded directories found in staging:"
  echo "$EXCLUDED"
  echo ""
  echo "These directories must not be committed:"
  echo "  .worktrees/ - Git worktrees are execution infrastructure"
  echo "  .software-teams/       - JDI runtime state and configuration"
  echo ""
  echo "Unstage these files with: git reset HEAD <file>"
  exit 1
fi
```

**If excluded files found:**
- **BLOCK COMMIT** (no override allowed)
- Display error message
- List offending files
- Provide unstaging instructions

### 2. Run Quality Checks

```bash
# TypeScript check (if applicable)
bun run typecheck 2>&1 | head -20

# Lint check (if applicable)
bun run lint 2>&1 | head -20
```

**If errors:**
- Block commit
- Display errors
- Suggest fixes

### 3. Check for Secrets

```bash
# Common secret patterns
grep -r -E "(API_KEY|SECRET|PASSWORD|TOKEN)=" --include="*.ts" --include="*.tsx" --include="*.env" .
```

**If found:**
- Block commit
- Warn about potential secrets
- Require confirmation to proceed

### 4. Validate Commit Message

Check message format:
```
{type}({scope}): {description}
```

**Valid types:** feat, fix, refactor, docs, test, chore, perf, style

**Validation:**
- First line ≤72 characters
- Imperative mood
- No period at end
- Scope matches task context

### 5. Check for Large Files

```bash
git diff --cached --stat | grep -E "\+[0-9]{4,}"
```

**If large additions:**
- Warn about file size
- Confirm intentional

---

## Blocking Conditions

Commit is blocked if:
- **Files in `.worktrees/` or `.software-teams/` are staged** (NO OVERRIDE ALLOWED)
- Type check fails
- Lint errors exist (not warnings)
- Secrets detected (without override)
- Message format invalid
- No files staged

---

## Override

Allow override with:
- `--no-verify` flag (use sparingly)
- Explicit confirmation for warnings

---

## Outputs

| Output | Purpose |
|--------|---------|
| Pass/Fail | Gate decision |
| Errors | What needs fixing |
| Warnings | What to review |
