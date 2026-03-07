---
name: PRReviewLocal
category: quality
description: Local-only review output (no GitHub comments)
---

# PRReviewLocal

When `post="false"` or invoked as `<JDI:PRReview post="false" />`:

Skip Steps 9-10 (posting to GitHub).

Instead, write the full structured review to a file:

## File Output

1. **Create the directory** if it does not exist:
   ```bash
   mkdir -p .jdi/reviews
   ```

2. **Write the review file** to `.jdi/reviews/PR-{pr_number}-review.md` with the following structure:

```markdown
---
pr: {pr_number}
title: "{pr_title}"
author: "{author}"
branch: "{head_branch} -> {base_branch}"
url: "{pr_url}"
reviewed_at: "{ISO timestamp}"
verdict: "{APPROVE | REQUEST_CHANGES}"
findings:
  blockers: {N}
  major: {N}
  minor: {N}
  suggestions: {N}
  questions: {N}
  praise: {N}
---

# PR Review: #{pr_number}

**Title:** {pr_title}
**Author:** {author}
**Branch:** {head_branch} -> {base_branch}
**URL:** {pr_url}
**Files changed:** {count}
**Lines:** +{additions} / -{deletions}

---

## Summary

{1-2 sentence overall assessment}

**Verdict:** {APPROVE | REQUEST_CHANGES}

---

## Findings

### {severity emoji} {Severity}: {title}
**File:** `{path/to/file.ts}:{line}`

{Description}

**Suggested fix:**
\`\`\`{language}
{code}
\`\`\`

---

## Checklist

- [{x or space}] Logic is correct
- [{x or space}] Edge cases handled
- [{x or space}] Error handling appropriate
- [{x or space}] Types are correct
- [{x or space}] No security issues
- [{x or space}] Tests cover changes
- [{x or space}] Follows project patterns
- [{x or space}] No performance concerns
```

**IMPORTANT:** Include ALL findings organised by severity (highest to lowest). Only include severity sections that have findings.

3. **Confirm the file was written:**

**Output:**
```
Review file written
  - Path: .jdi/reviews/PR-{pr_number}-review.md
  - Findings: {total_count} ({blockers} blockers, {major} major, {minor} minor, {suggestions} suggestions)
  - Verdict: {APPROVE | REQUEST_CHANGES}
```

Then proceed to Step 11 (return to master).
