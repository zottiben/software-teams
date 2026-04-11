---
name: generate-pr
description: "JDI: Generate comprehensive PR description and create the pull request"
allowed-tools: Read, Bash, Task
argument-hint: "[optional context hint]"
context: |
  !git branch --show-current 2>/dev/null
  !git log --oneline main..HEAD 2>/dev/null | head -15
---

# /jdi:generate-pr

Generate a PR description from the current branch's commits and create the pull request via the `jdi-pr-generator` specialist.

**This skill follows `<JDI:StrictnessProtocol />`. Read that component before executing any step below.**

---

## Orchestration

### 1. Branch Pre-flight

Run these checks in parallel:

- `git branch --show-current` — confirm we're not on `main`/`master`
- `git log --oneline main..HEAD` — confirm there are commits to include
- `git status --short` — confirm working tree is clean

If any check fails, STOP and report:

| Failure | Message |
|---------|---------|
| On `main`/`master` | "You're on the base branch. Switch to a feature branch first." |
| Zero commits ahead of base | "No commits to include in a PR. Make commits first." |
| Dirty working tree | "Working tree has uncommitted changes. Commit or stash before generating a PR." |

### 2. Existing PR Check

Run `gh pr list --head {current-branch}`. If a PR already exists for this branch, STOP:

> "PR #{existing} already exists for this branch. Use `/jdi:pr-feedback` to address comments, or update the existing PR directly."

### 3. Delegate to jdi-pr-generator

Spawn the specialist via Task tool. JDI specialists spawn as `general-purpose` with identity injected via prompt text:

```
Task(
  subagent_type="general-purpose",
  prompt="You are jdi-pr-generator. Read .jdi/framework/agents/jdi-pr-generator.md
  for your full role and instructions. Also read
  .jdi/framework/components/meta/AgentBase.md for the JDI base protocol.

  Generate PR for current branch. Context hint: $ARGUMENTS"
)
```

### 4. Confirm Before Creating

The generator returns a draft title and body. Present both to the user and ask:

> "Create the PR with this title and body, or revise first?"

**Wait for the user's answer. Do NOT auto-run `gh pr create`.** Creating a PR is visible to collaborators — it requires explicit approval.

### 5. Create PR

On approval, run `gh pr create` with the confirmed title and body. Report the PR URL. Then **STOP**.

---

## Edge Cases

| Situation | Response |
|-----------|----------|
| On `main`/`master` | STOP at step 1. Refuse to generate. |
| No commits ahead of base | STOP at step 1. Nothing to PR. |
| Dirty working tree | STOP at step 1. Ask the user to commit or stash. |
| Existing PR for branch | STOP at step 2. Redirect to `/jdi:pr-feedback`. |
| `gh` not authenticated | Report the error verbatim. Do NOT attempt to create the PR via other means. |
| User wants to target a non-default base | Pass the base to `gh pr create --base {branch}` at step 5, after explicit confirmation. |

---

## Collaborative Protocol

<JDI:StrictnessProtocol />

---

**Context:** $ARGUMENTS
