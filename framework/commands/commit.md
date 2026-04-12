---
name: commit
description: "JDI: Create conventional commit"
allowed-tools: Read, Bash, Task
argument-hint: "[optional scope hint]"
context: |
  !git status --short 2>/dev/null | head -20
  !git diff --cached --stat 2>/dev/null | head -10
---

# /jdi:commit

Create a well-formatted conventional commit via the `jdi-committer` specialist.

**This skill follows `<JDI:StrictnessProtocol />`. Read that component before executing any step below.**

---

## Orchestration

### 1. Pre-flight Check

Run `git status --short` to confirm there are changes to commit. If the working tree is clean, STOP:

> "Nothing to commit — working tree is clean. Make edits first, then run `/jdi:commit`."

### 2. Staging Check

If there are unstaged changes but nothing is staged, ask the user:

> "You have unstaged changes and nothing in the index. Stage them first, or do you want me to stage everything (`git add -A`)?"

**Wait for the user's answer. Do NOT auto-stage.**

### 3. Delegate to jdi-committer

Spawn the committer via Task tool. JDI specialists spawn as `general-purpose` with identity injected via prompt text (see `framework/jdi.md` Critical Constraints):

```
Task(
  subagent_type="general-purpose",
  prompt="You are jdi-committer. Read .jdi/framework/agents/jdi-committer.md for
  your full role and instructions. Also read .jdi/framework/components/meta/AgentBase.md
  for the JDI base protocol. If your spec has requires_components in frontmatter,
  batch-read all listed components before starting.

  Create a conventional commit for the staged changes. Scope hint: $ARGUMENTS"
)
```

### 4. Present Result

After the committer returns, print the commit hash and subject line. Then **STOP**.

---

## Edge Cases

| Situation | Response |
|-----------|----------|
| Working tree clean | STOP at step 1. Nothing to do. |
| Unstaged changes, nothing staged | Ask before staging. Never auto-stage. |
| Commit hook fails | Report the hook output, do NOT retry with `--no-verify`. Let the user decide. |
| Staged changes include secrets-looking files (`.env`, `credentials*`) | Refuse and warn. Wait for explicit confirmation before proceeding. |
| User asks to amend | Redirect: "Amending rewrites history — create a new commit instead, or confirm you really want amend." |

---

## Collaborative Protocol

<JDI:StrictnessProtocol />
