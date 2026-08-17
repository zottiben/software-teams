---
name: st-pr-feedback
description: "Software Teams: Address PR review comments systematically"
argument-hint: "<pr-number-or-url>"
disable-model-invocation: true
context: fork
agent: software-teams-pr-feedback
background: false
---

## Live context

!`git branch --show-current 2>/dev/null`


# Pr Feedback

Address review comments on a pull request via the `software-teams-pr-feedback` specialist.

**This skill follows `@ST:StrictnessProtocol`. Read that component before executing any step below.**

---

## Orchestration

### 1. Parse PR Reference

Extract the PR number from `$ARGUMENTS`. Accept a bare number or a full GitHub URL. If neither is present, STOP and ask for one.

### 2. Fetch Unresolved Comments

Run `gh api repos/{owner}/{repo}/pulls/{number}/comments` (or equivalent) to confirm there are unresolved comments. If there are none, STOP:

> "PR #{number} has no unresolved review comments. Nothing to address."

### 3. Address the feedback

This skill runs in a fork using the `software-teams-pr-feedback` specialist.
Follow that agent's contract directly for PR `{pr-number}`; do not spawn another
agent. Process every actionable comment, apply and verify the fixes, capture new
non-duplicate project rules, commit and push, then post the signed replies.

### 4. Present Result

Summarise comments addressed, files touched, commits made, rules learned, and
replies posted. End with:

> "Feedback applied. Review the diff, then run `/st-commit` or push when ready."

**Wait for the user's response. Do NOT auto-push.**

---

## Edge Cases

| Situation | Response |
|-----------|----------|
| No PR reference | STOP at step 1. Ask for a number or URL. |
| No unresolved comments | STOP at step 2. Nothing to do. |
| Specialist cannot address a specific comment | Surface the blocker; the user decides whether to override or defer. |
| Working tree dirty before start | Ask whether to stash, commit, or abort. Do NOT silently mix unrelated changes. |
| PR is closed or merged | STOP and report — feedback on closed PRs is not actionable via this skill. |

---

## Collaborative Protocol

@ST:StrictnessProtocol:FiveRules

---

**PR to address:** $ARGUMENTS
