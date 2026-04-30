---
name: checkpoint
description: Handles checkpoint interactions
trigger: checkpoint_reached
---

# Checkpoint Hook

Handles pausing execution and managing user interaction at checkpoints.

---

## Trigger

Fires when:
- Task type is `checkpoint:human-verify`
- Task type is `checkpoint:decision`
- Task type is `checkpoint:human-action`
- Auth gate or credential requirement detected

---

## Checkpoint Types

### human-verify

User needs to test/verify something.

**Flow:**
1. Present what was built
2. Provide verification steps
3. Wait for "approved" or issues

**Template:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 JDI ► CHECKPOINT: Verification Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase:** {phase} | **Plan:** {plan} | **Task:** {n}/{total}

## What Was Built

{Summary of completed work}

## Please Verify

1. {Step 1}
2. {Step 2}
3. {Step 3}

## Expected Behaviour

{What you should see}

───────────────────────────────────────────────────────────────

Reply "approved" to continue, or describe any issues found.
```

### decision

User needs to make a choice.

**Flow:**
1. Present decision context
2. Show options with trade-offs
3. Record choice and rationale

**Template:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 JDI ► CHECKPOINT: Decision Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Decision:** {What needs to be decided}

## Context

{Why this decision matters}

## Options

| Option | Pros | Cons |
|--------|------|------|
| A: {option} | {pros} | {cons} |
| B: {option} | {pros} | {cons} |
| C: {option} | {pros} | {cons} |

## Recommendation

{If applicable, what we recommend and why}

───────────────────────────────────────────────────────────────

Reply with your choice (A/B/C) and any additional context.
```

### human-action

User needs to do something manually.

**Flow:**
1. Explain what's needed
2. Provide steps
3. Wait for "done" confirmation
4. Verify action worked

**Template:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 JDI ► CHECKPOINT: Manual Action Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Action:** {What you need to do}

## Why This Can't Be Automated

{Reason - credentials, external system, etc.}

## Steps

1. {Step 1}
2. {Step 2}
3. {Step 3}

## How to Verify

{How we'll confirm it worked}

───────────────────────────────────────────────────────────────

Reply "done" when complete.
```

---

## State Management

On checkpoint:

```yaml
checkpoints:
  last_checkpoint: "{timestamp}"
  checkpoint_type: "{type}"
  checkpoint_task: "{task_id}"
  awaiting_response: true
```

On response:

```yaml
checkpoints:
  awaiting_response: false
  last_response: "{user_response}"
  response_at: "{timestamp}"
```

---

## Response Handling

### "approved" / "done"
- Continue to next task
- Clear awaiting_response

### Issues described
- Parse user feedback
- Return to task with feedback context
- Address issues
- Re-present checkpoint

### Decision made
- Record decision
- Record rationale if provided
- Apply decision to remaining work
- Continue execution

---

## Timeout Behaviour

If checkpoint awaits response for extended time:
- State preserved in state.yaml
- Can resume with `/st-implement-plan --resume`
- Progress is not lost

---

## Outputs

| Output | Purpose |
|--------|---------|
| Checkpoint display | User interaction |
| State update | Track checkpoint |
| Decision record | Document choices |
