# CodebaseContext Component

Cache-first codebase context loading. Reads existing analysis — never spawns mapper automatically.

---

## Cache-First Loading

1. If `.software-teams/codebase/SUMMARY.md` exists → **read it directly** (regardless of age)
2. If `.software-teams/codebase/CONVENTIONS.md` exists → read it when writing code
3. If neither exists → **inform user** to run `/st:map-codebase` first, then proceed without codebase context

**Never spawn codebase mapper automatically.** The mapper is expensive (~30% of session budget). Only run it via explicit `/st:map-codebase` command.

**Skip entirely if:** `--skip-codebase` flag is present in command arguments.

---

## Context Files

| File | Purpose | When to Read |
|------|---------|--------------|
| `.software-teams/codebase/SUMMARY.md` | Architecture overview, file locations, tech stack | Always (if exists) |
| `.software-teams/codebase/CONVENTIONS.md` | Coding standards (mapper output only) | When writing code (if exists) |
| `.claude/rules/*.md` | Auto-loaded patterns (no explicit read needed) | Automatic |
| `.software-teams/config/state.yaml` | Current phase, plan, position | Always |

---

## Usage in Commands

```
<JDI:CodebaseContext />
```

This component reads cached context files. If no codebase analysis exists, it proceeds without it — agents can still analyse relevant source files directly.
