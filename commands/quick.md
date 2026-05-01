---
name: quick
description: "Software Teams: Quick focused change (skips planner, relaxed standards)"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit
argument-hint: "<task description> [--dry-run]"
context: |
  !git status --short 2>/dev/null | head -20
---

<!-- AUTO-GENERATED — do not hand-edit; run `software-teams build-plugin` -->

# /st:quick

Execute a small, focused change directly without full orchestration. For trivial or prototype work only — no planner, no agent spawn, no waves.

**This skill follows `<JDI:StrictnessProtocol />`. Read that component before executing any step below.**

---

## Flags

- `--dry-run` — Preview the change without writing files. List intended edits and STOP.

---

## Scope Gate (read first)

`/st:quick` is for:

- Single-file edits, typo fixes, log lines, variable renames
- Prototype / exploration code where throwaway is acceptable
- Tasks under ~30 minutes with no architectural impact

`/st:quick` is NOT for:

- Production code requiring tests, review, or sign-off
- Multi-file refactors or anything touching contracts (API routes, DTOs, exported types, migrations)
- Work that spans tech stacks or layers

If the task doesn't fit, redirect to `/st:create-plan "<feature>"` before writing any code.

---

## Orchestration

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them.

### 1. Parse and Classify

Read `$ARGUMENTS`. If the task description suggests production-grade work (tests required, multi-file, architectural), STOP and redirect:

> "This looks bigger than `/st:quick` is meant for. Run `/st:create-plan "<feature>"` instead so we agree on scope before writing code."

**Wait for the user's answer. Do not proceed until they confirm `/st:quick` is still the right fit.**

### 2. Detect Tech Stack

Read the target files (inferred from `$ARGUMENTS` or the user's follow-up). Identify the stack. Record in working memory.

### 3. Dry Run Check

If `--dry-run` is present, list the files you would edit and the intended change per file. Then **STOP**. Do NOT write anything.

### 4. Execute Change

Apply the edit directly via Edit tool. No agent spawn. No TaskCreate. Scope is intentionally narrow — one concern per invocation.

### 5. Verification

Run only the quality gates that are cheap and relevant:

- Typecheck for TS changes (`tsc --noEmit` or project-equivalent)
- Lint for the touched file only (not the whole repo)
- Tests only if the user explicitly asked for them — `/st:quick` defaults to skipping

If a gate fails, STOP and report. Do NOT auto-fix beyond the scope the user requested.

### 6. Report

Present a 3-line summary: files changed, gates run, next suggested action. End with:

> "Commit as `proto:` / `quick:` / leave uncommitted? Your call."

**Wait for the user's answer. Do NOT auto-commit.**

---

## Relaxed Standards Mode

- Prototype / throwaway code accepted
- Tests optional (default: skip)
- Commit message prefix: `proto:` or `quick:`
- Framed as exploration — NOT production
- `software-teams-qa-tester` is NOT invoked in `/st:quick` mode. If regression checks matter, route through `/st:implement-plan` instead.

---

## Edge Cases

| Situation | Response |
|-----------|----------|
| Task description implies production work | Redirect to `/st:create-plan` at step 1. Do NOT proceed. |
| `.software-teams/` directory doesn't exist | Proceed anyway — `/st:quick` does not require Software Teams scaffolding. Skip any state updates. |
| Typecheck or lint fails after edit | Report the failure. Do NOT auto-fix unrelated issues. |
| User asks for tests mid-task | Honour the request; run the test command once, report, then stop. |
| Target file doesn't exist | Ask the user: create it, or did they mean a different path? |

---

## HARD STOP

Once the edit is applied and gates have run, the skill is **DONE**.

- Do NOT auto-commit.
- Do NOT advance state.
- Do NOT invoke any other skill.

---

## Collaborative Protocol

@ST:StrictnessProtocol

---

**Task:** $ARGUMENTS
