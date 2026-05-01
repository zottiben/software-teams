---
name: PRReview
category: quality
description: Review pull request changes and post line comments to GitHub
params:
  - name: pr_number
    type: string
    required: false
    description: PR number to review (auto-detected if not provided)
  - name: context
    type: string
    required: false
    description: Extra context - ClickUp URL, focus areas, or specific instructions
  - name: depth
    type: string
    required: false
    options: ["quick", "standard", "thorough"]
    default: "standard"
    description: How deeply to analyse the changes
  - name: post
    type: boolean
    required: false
    default: true
    description: Whether to post comments to GitHub (false = local review only)
---

# PRReview

Review pull request changes with structured analysis and post line comments to GitHub.

## Default Behaviour

When invoked as `@ST:PRReview`, execute steps in order:

### Step 1: Identify PR (REQUIRED)

If PR number provided, use it. Otherwise detect:

```bash
gh pr view --json number,url,title,headRefName,baseRefName,author --jq '.'
```

If no PR found: report and **STOP completely**.

### Step 2: Checkout PR Branch (REQUIRED)

```bash
git fetch origin
gh pr checkout [pr_number]
git branch --show-current
```

### Step 3: Gather PR Context

```bash
gh pr view [pr_number] --json title,body,additions,deletions,changedFiles,commits,labels
gh pr view [pr_number] --json files --jq '.files[].path'
gh pr diff [pr_number]
gh pr view [pr_number] --json commits --jq '.commits[-1].oid'
```

### Step 4: Understand PR Intent

1. Read PR description — what problem is being solved?
2. Read commit messages — what approach was taken?
3. Identify scope — what should/shouldn't be reviewed?

If context provided:
- ClickUp URL (`app.clickup.com`): Note for requirements checking
- Focus keywords: Prioritise these areas
- Instructions: Follow during review

### Step 5: Read Changed Files FULLY

Read each changed file in its entirety (not just the diff). **NEVER** use limit/offset.

### Step 5b: Cross-Reference Learnings (MANDATORY)

If learnings files were loaded (via the command stub or agent prompt), cross-reference every changed file against the team's learnings:

1. For each finding from the review checklist, check if a learning exists that addresses it — cite the learning in your comment.
2. Flag any code that **violates** a documented learning (e.g. a learning says "always use path aliases" but the PR uses relative imports).
3. **Praise** code that follows learnings the team has documented — this reinforces good patterns.
4. If no learnings were loaded, skip this step (but note it in your review summary as a gap).

Learnings-based findings should use the same severity classification as other findings. A violation of a documented team convention is at minimum a **minor** finding.

### Step 6: Perform Code Review

Apply @ST:PRReview:Checklist to analyse each change. Include learnings violations alongside standard checklist findings.

### Step 7: Categorise Findings (Internal)

Categorise using @ST:PRReview:SeverityGuide. Build internal list with: file path, line number, severity, title, explanation, suggested fix. Do NOT output detailed findings yet.

### Step 8: Review Checkpoint

Output finding counts by severity, total line comments, and review state (APPROVE | REQUEST_CHANGES).

If `post="false"`: note output will go to `.software-teams/reviews/PR-[number]-review.md`.

**CHECKPOINT** — Wait for user: "continue" | "list" | "cancel"

### Step 8a: After "continue":
- `post="true"` (default): Continue to Step 9
- `post="false"`: Execute the LocalOutput section below, skip to Step 11

### Steps 9-10: Build & Submit Review (post=true only)

Use @ST:PRReview:PostComments to build and submit the atomic review.

### Step 11: Cleanup (MANDATORY)

```bash
git checkout master && git branch --show-current
```

Verify on `master`. Output: PR number, title, state, line comment count, URL, confirmed branch. If not on master, retry.

---

<section name="Checklist">

## Review Checklist

Apply during Step 6.

| Category | Checks |
|----------|--------|
| **Correctness** | Logic sound, edge cases handled, error handling, type safety, null/undefined, async |
| **Security** | No hardcoded secrets, input validated, injection prevented, XSS prevented, auth checks, no sensitive data logged |
| **Performance** | No N+1 queries, large datasets efficient, no unnecessary re-renders, caching considered, no memory leaks |
| **Architecture** | Follows patterns, separation of concerns, no circular deps, consistent APIs, appropriate scope |
| **Style** | Clear naming, readable, no dead code, comments explain "why", consistent formatting |
| **Testing** | New functionality tested, edge cases tested, meaningful tests, no flaky tests |
| **Type Safety** | Types defined, no unnecessary `any`, null/undefined typed, generics appropriate |

</section>

---

<section name="SeverityGuide">

## Severity Classification

Use during Step 7.

| Emoji | Severity | Description | Action |
|-------|----------|-------------|--------|
| blocker | **Blocker** | Bugs, security issues, data loss risk | Must fix before merge |
| major | **Major** | Significant issues, performance problems | Should fix before merge |
| minor | **Minor** | Code quality, maintainability | Should fix, not blocking |
| suggestion | **Suggestion** | Optional improvements | Consider for future |
| question | **Question** | Clarification needed | Needs response |
| praise | **Praise** | Good patterns worth highlighting | Positive feedback |

### Event Logic

- Any blockers, major, or minor findings: `REQUEST_CHANGES`
- Suggestions only or no issues: `APPROVE`

</section>

---

<section name="PostComments">

## Post Comments to GitHub

Use during Steps 9-10.

> **CRITICAL**: Each finding MUST be a separate object in the `comments` array. The `body` field is ONLY for the summary table. All code-specific feedback goes in `comments` with exact `path` and `line`. Verify `comments` array has one entry per finding (excluding praise, which goes in summary body).

### Get Repository Info

```bash
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
```

### Comment Object Format

```json
{
  "path": "[exact_file_path]",
  "line": [line_number],
  "side": "RIGHT",
  "body": "[severity emoji] **[title]**\n\n[explanation]\n\n**Suggested fix:**\n```[language]\n[code]\n```\n\n- AI Ben"
}
```

### Submit Review (SINGLE ATOMIC POST)

```bash
gh api repos/[owner]/[repo]/pulls/[pr_number]/reviews \
  --input - <<'EOF'
{
  "commit_id": "[latest_commit_sha]",
  "event": "[APPROVE|REQUEST_CHANGES]",
  "body": "## Review Summary\n\n[assessment]\n\n| Category | Count |\n|----------|-------|\n| Blockers | [N] |\n| Major | [N] |\n| Minor | [N] |\n| Suggestions | [N] |\n\n**[N] line comments below.**\n\n- AI Ben",
  "comments": [ ...comment objects... ]
}
EOF
```

**CHECKPOINT** — Wait for "post" or "cancel" before posting.

</section>

---

<section name="LocalOutput">

## Local Review Output

When `post="false"` or invoked with `@ST:PRReview` and the local-output flag:

Skip Steps 9-10 (posting to GitHub). Instead, write the full structured review to a file:

1. **Create the directory** if it does not exist: `mkdir -p .software-teams/reviews`
2. **Write** to `.software-teams/reviews/PR-{pr_number}-review.md` with frontmatter (pr, title, author, branch, url, reviewed_at, verdict, findings counts) followed by: Summary, Findings (organised by severity highest to lowest), and Checklist.
3. **Confirm**: Output the file path, finding counts, and verdict.

Then proceed to Step 11 (return to master).

</section>
