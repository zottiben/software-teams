---
name: deviation-rules
description: How to handle deviations from plans during execution
---

# Deviation Rules

How to handle unexpected situations during plan execution.

---

## Core Principle

Plans are guides, not rigid scripts. Real-world execution reveals new information.
Handle deviations systematically, not randomly.

---

## Fix Correctly, Not Quickly

Every auto-fix under Rules 1–3 must be the **root-cause fix**, not a band-aid.
Forbidden shortcuts: silenced types (`as any`, `@ts-ignore`, an `eslint-disable`
to dodge a real error), swallowed exceptions, duplicated logic you could
refactor, `// TODO` placeholders, or deleting/skipping a test to go green.

If the only fix that fits the current task scope is a workaround, escalate via
**Rule 4** with the correct fix described — do **not** ship the shortcut
silently and log it as a Rule 1/2/3 deviation. A quick fix that creates tech
debt is a worse outcome than an honest escalation.

When you record a Rule 1/2/3 deviation, state **why the chosen fix addresses
the root cause** (not just what you changed).

---

## The Four Rules

### Rule 1: Auto-Fix Bugs

**Trigger:** Bug discovered during implementation

**Action:**
1. Fix the bug immediately
2. Track in deviation log
3. Continue execution

**Example:**
```
Found: TypeError in existing code while adding new feature
Action: Fixed the TypeError
Track: Added to deviations with Rule 1 tag
Continue: Resumed task execution
```

**What qualifies:**
- Type errors
- Null pointer issues
- Logic errors in existing code
- Broken imports

### Rule 2: Auto-Add Critical Functionality

**Trigger:** Missing functionality that's essential for task completion

**Action:**
1. Add the missing piece
2. Track in deviation log
3. Continue execution

**Example:**
```
Found: Form component needs validation that doesn't exist
Action: Added validation utility
Track: Added to deviations with Rule 2 tag
Continue: Used validation in form, completed task
```

**What qualifies:**
- Missing utility functions
- Required helper components
- Essential type definitions
- Necessary API helpers

### Rule 3: Auto-Fix Blocking Issues

**Trigger:** Issue that prevents task completion

**Action:**
1. Fix the blocking issue
2. Track in deviation log
3. Continue execution

**Example:**
```
Found: Test failing due to outdated mock
Action: Updated mock to match current API
Track: Added to deviations with Rule 3 tag
Continue: Tests pass, completed task
```

**What qualifies:**
- Configuration issues
- Environment problems
- Dependency conflicts
- Test infrastructure issues

### Rule 4: STOP for Architectural Changes

**Trigger:** Proposed change would alter system architecture

**Action:**
1. **STOP** execution immediately
2. Present the situation to user
3. Await decision before continuing

**Example:**
```
Found: Task requires changing database schema
Action: STOPPED execution
Present: "This requires a database migration that affects X tables"
Await: User decision on how to proceed
```

**What qualifies:**
- Database schema changes
- API contract changes
- Authentication/authorisation changes
- Significant refactoring
- New external dependencies
- Infrastructure changes

---

## Decision Flow

```
Deviation detected
       │
       ├─► Is it a bug? ────────────► Rule 1: Fix, track, continue
       │
       ├─► Is it missing critical? ──► Rule 2: Add, track, continue
       │
       ├─► Is it blocking? ──────────► Rule 3: Fix, track, continue
       │
       └─► Does it change architecture? ► Rule 4: STOP, ask, await
```

---

## Tracking Format

When a deviation occurs, record:

```json
{
  "deviations": [
    {
      "task_id": "{task where found}",
      "rule": 1,
      "title": "{brief description}",
      "description": "{what was found}",
      "action": "{what was done}",
      "root_cause": "{why this fix addresses the cause, not just the symptom}",
      "files_affected": ["{list}"],
      "commit_hash": "{if committed separately}"
    }
  ]
}
```

---

## summary.md Section

In plan summary, include:

```markdown
## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1] {title}**
- Found during: Task {X}
- Issue: {description}
- Fix: {what was done}
- Files: {affected files}
- Commit: {hash}

**2. [Rule 2] {title}**
- Found during: Task {Y}
- Missing: {what was needed}
- Added: {what was created}
- Files: {new files}
- Commit: {hash}

{Or: "None - plan executed as written."}
```

---

## Escalation

If unsure which rule applies:
- Default to Rule 4 (ask)
- It's better to ask than to make unwanted changes
- User can always say "Software Teams" to proceed

---

## Context for User Decisions (Rule 4)

When presenting an architectural decision:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Software Teams ► DEVIATION: Architectural Change Detected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Task:** {current task}
**Issue:** {what was encountered}

## What's Needed

{Description of the architectural change required}

## Impact

- {Impact 1}
- {Impact 2}

## Options

1. **Proceed** — Make the change as described
2. **Modify** — Suggest alternative approach
3. **Skip** — Skip this task, continue with others
4. **Stop** — Halt execution entirely

───────────────────────────────────────────────────────────────
```
