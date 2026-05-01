# Software Teams Workflows

Quick-reference for common development workflows using Software Teams commands.

---

## Feature Workflow

End-to-end: requirements to merged PR.

```
Discovery → Planning → Execution → Review
```

1. `/st:create-plan "feature description"` — researches codebase, creates PLAN.md
2. Review and refine the generated plan
3. `/st:implement-plan .software-teams/plans/{phase}-{plan}-{slug}.plan.md` — executes with atomic commits
4. `/st:generate-pr` — creates PR with description from SUMMARY.md
5. `/st:pr-review` — self-review before requesting human review
6. `/st:pr-feedback` — address review comments

**Quick variant:** For small changes, use `/st:quick "description"` instead of steps 1-3.

---

## Bugfix Workflow

Investigate, fix, and verify bugs.

```
Reproduce → Investigate → Fix → Verify
```

1. Reproduce the bug and confirm the issue
2. `/st:create-plan "fix: description of bug"` — creates targeted fix plan
3. `/st:implement-plan` — implements the fix with tests
4. `/st:generate-pr` — creates PR
5. `/st:pr-review` — verify fix addresses root cause

**Quick variant:** For obvious fixes, use `/st:quick "fix: description"`.

---

## PR Workflow

Pull request lifecycle from creation to merge.

```
Create → Review → Feedback → Merge
```

1. `/st:generate-pr` — creates PR with comprehensive description
2. `/st:pr-review` — self-review, posts line comments to GitHub
3. Wait for human review
4. `/st:pr-feedback` — address all review comments, post replies
5. Repeat steps 3-4 until approved
6. Merge via GitHub

---

## Discovery Workflow

Research and analysis before implementation.

```
Scope → Research → Analyse → Document
```

1. Define what needs to be understood (scope the research)
2. `/st:create-plan --depth deep "research: topic"` — generates research tasks
3. Review research outputs in `.software-teams/research/`
4. Use findings to inform feature planning

---

## Command Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/st:quick` | Small focused change | Single file, <50 lines, obvious fix |
| `/st:create-plan` | Create implementation plan | New features, complex changes |
| `/st:implement-plan` | Execute plan | After plan is created and reviewed |
| `/st:commit` | Conventional commit | Manual commits outside plan execution |
| `/st:generate-pr` | Create pull request | After implementation is complete |
| `/st:pr-review` | Review pull request | Before requesting human review |
| `/st:pr-feedback` | Address PR feedback | After receiving review comments |
| `/st:status` | Show current status | Check progress and next steps |
