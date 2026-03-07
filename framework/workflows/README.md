# JDI Workflows

Quick-reference for common development workflows using JDI commands.

---

## Feature Workflow

End-to-end: requirements to merged PR.

```
Discovery → Planning → Execution → Review
```

1. `/jdi:create-plan "feature description"` — researches codebase, creates PLAN.md
2. Review and refine the generated plan
3. `/jdi:implement-plan .jdi/plans/{phase}-{plan}-{slug}.plan.md` — executes with atomic commits
4. `/jdi:generate-pr` — creates PR with description from SUMMARY.md
5. `/jdi:pr-review` — self-review before requesting human review
6. `/jdi:pr-feedback` — address review comments

**Quick variant:** For small changes, use `/jdi:quick "description"` instead of steps 1-3.

---

## Bugfix Workflow

Investigate, fix, and verify bugs.

```
Reproduce → Investigate → Fix → Verify
```

1. Reproduce the bug and confirm the issue
2. `/jdi:create-plan "fix: description of bug"` — creates targeted fix plan
3. `/jdi:implement-plan` — implements the fix with tests
4. `/jdi:generate-pr` — creates PR
5. `/jdi:pr-review` — verify fix addresses root cause

**Quick variant:** For obvious fixes, use `/jdi:quick "fix: description"`.

---

## PR Workflow

Pull request lifecycle from creation to merge.

```
Create → Review → Feedback → Merge
```

1. `/jdi:generate-pr` — creates PR with comprehensive description
2. `/jdi:pr-review` — self-review, posts line comments to GitHub
3. Wait for human review
4. `/jdi:pr-feedback` — address all review comments, post replies
5. Repeat steps 3-4 until approved
6. Merge via GitHub

---

## Discovery Workflow

Research and analysis before implementation.

```
Scope → Research → Analyse → Document
```

1. Define what needs to be understood (scope the research)
2. `/jdi:create-plan --depth deep "research: topic"` — generates research tasks
3. Review research outputs in `.jdi/research/`
4. Use findings to inform feature planning

---

## Command Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/jdi:quick` | Small focused change | Single file, <50 lines, obvious fix |
| `/jdi:create-plan` | Create implementation plan | New features, complex changes |
| `/jdi:implement-plan` | Execute plan | After plan is created and reviewed |
| `/jdi:commit` | Conventional commit | Manual commits outside plan execution |
| `/jdi:generate-pr` | Create pull request | After implementation is complete |
| `/jdi:pr-review` | Review pull request | Before requesting human review |
| `/jdi:pr-feedback` | Address PR feedback | After receiving review comments |
| `/jdi:status` | Show current status | Check progress and next steps |
