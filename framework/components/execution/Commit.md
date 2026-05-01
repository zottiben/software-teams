---
name: Commit
category: execution
description: Create atomic commits with proper formatting and state tracking
params:
  - name: scope
    type: string
    required: false
    default: "task"
    options: ["task", "plan", "phase", "docs", "fix"]
    description: What level of work is being committed
  - name: type
    type: string
    required: false
    default: null
    options: ["feat", "fix", "refactor", "docs", "test", "chore", "perf", "style"]
    description: Override commit type (auto-detected if not provided)
  - name: files
    type: array
    required: false
    default: null
    description: Specific files to stage (auto-detected if not provided)
---

# Commit

Create an atomic commit with proper formatting, staging, and state tracking.

---

## Default Behaviour

When invoked as `<JDI:Commit />`:

1. **Check for changes** — `git status --porcelain`. If none, skip.

2. **Identify modified files** — Parse git status, group by change type.

3. **Determine commit type** — `feat` (new), `fix` (bug), `refactor` (cleanup), `docs` (documentation), `test` (tests). Override with `type` param.

4. **Stage files individually**
   ```bash
   git add path/to/file1
   git add path/to/file2
   ```
   **NEVER** use `git add .` or `git add -A`

   **EXCLUDED DIRECTORIES** (never stage):
   - `.worktrees/**` — Git worktrees
   - `.software-teams/**` — Software Teams runtime state

   ```bash
   if [[ "$file" == .worktrees/* ]] || [[ "$file" == .software-teams/* ]]; then
     echo "SKIP (excluded): $file"
     continue
   fi
   ```

5. **Create commit message** — Use @ST:Commit:MessageFormat

6. **Execute commit**
   ```bash
   git commit -m "$(cat <<'EOF'
   {message}
   EOF
   )"
   ```

7. **Record commit hash** — `git rev-parse --short HEAD`

8. **Update state** — Add commit to `state.yaml` session_commits array.

---

<section name="MessageFormat">

## Message Format

```
{type}({scope}): {description}

- {change 1}
- {change 2}
- {change 3}
```

### Type Selection

| Type | When to Use |
|------|-------------|
| `feat` | New feature, endpoint, component |
| `fix` | Bug fix, error correction |
| `test` | Test-only changes |
| `refactor` | Code cleanup, no behaviour change |
| `perf` | Performance improvement |
| `docs` | Documentation changes |
| `style` | Formatting, linting fixes |
| `chore` | Config, tooling, dependencies |

### Rules
- **Scope**: In a plan: `{phase}-{plan}` (e.g., `01-02`). Standalone: feature name or file area.
- **Description**: Imperative mood, no capital start, no period, max 72 chars.
- **Body**: 3-5 bullet points of WHAT changed.

</section>

---

## Scope Reference

| Scope | Message Format |
|-------|----------------|
| `task` | `{type}({phase}-{plan}): task {N} - {desc}` |
| `plan` | `docs({phase}-{plan}): complete {plan-name}` |
| `phase` | `docs({phase}): complete {phase-name}` |
| `docs` | `docs: {description}` |
| `fix` | `fix: {description}` |

## State Updates

After commit: append to `commits.session_commits` in state.yaml, update `last_commit_hash`. Append to `implementation.files_modified` in variables.yaml.
