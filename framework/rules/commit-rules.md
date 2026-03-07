---
name: commit-rules
description: Standards for creating commits within JDI workflow
---

# Commit Rules

For full commit instructions, see `<JDI:Commit />` component at `.jdi/framework/components/execution/Commit.md`.

---

## Quick Reference

**Format:** `{type}({scope}): {description}` — imperative mood, no period, max 72 chars.

**Types:** `feat` | `fix` | `refactor` | `docs` | `test` | `chore` | `perf` | `style`

**Scope:** Plan tasks use `{phase}-{plan}-T{n}`. Standalone commits use feature area (e.g., `auth`, `api`).

**Staging:** Always stage files individually. NEVER use `git add .`, `git add -A`, or glob patterns.

**Atomic:** One task = one commit. Each commit must represent a shippable state.

**Pre-commit:** Verify staged files (`git diff --cached --name-only`), run quality checks before committing.
