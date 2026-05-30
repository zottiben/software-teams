---
name: review-plan
description: "Software Teams: Review a plan for one-shot readiness (consistency, contradictions, quality) before approval"
allowed-tools: Read, Glob, Bash, Task, AskUserQuestion
argument-hint: "[plan-name] [plan-part]  — defaults to the current plan"
context: |
  !cat .software-teams/state.yaml 2>/dev/null | head -30
  !ls .software-teams/plans/*.orchestration.md 2>/dev/null | tail -5
  !ls .software-teams/plans/*.plan.md 2>/dev/null | tail -5
---

# /st:review-plan

Review an existing plan for one-shot readiness before implementation agents are spawned. Re-runnable as many times as needed. Deterministic workflow — every invocation follows the same numbered steps, in order, without skipping.

**This skill follows `@ST:StrictnessProtocol` and `@ST:SilentDiscovery`. Read those components before executing any step below.**

---

## Arguments

- `{plan-name}` (optional, 1st positional): which plan to review. Default = current plan (`state.current_plan.path`). When given, fuzzy-match the stem against plan slugs in `.software-teams/plans/` — prefer `{slug}.orchestration.md` (three-tier index); fall back to `{slug}.plan.md` (single-tier index). The literals `.` and `current` force the current plan. If the argument matches more than one plan, list the candidates and ask which one.
- `{plan-part}` (optional, 2nd positional): drill into ONE part of the resolved plan — a task ID (`T3` or `task 3`), a per-agent slice or agent name, or a section heading from the spec or orchestration file. When omitted, the entire plan is reviewed. **Precedence when only one positional is supplied:** if the value resolves to a plan slug, treat it as `{plan-name}`; else if it resolves to a part of the current plan, treat it as `{plan-part}`.

---

## Orchestration

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them. Each step ends with a clear state transition — if you cannot produce that transition, STOP and ask.

### 1. Resolve the Plan

Read `.software-teams/state.yaml`. Identify the canonical index for the plan to review:

- **Three-tier (preferred):** `{slug}.orchestration.md` — use this when it exists.
- **Single-tier (fallback):** `{slug}.plan.md`.

Apply `{plan-name}` resolution:

1. If `{plan-name}` is absent, `.`, or `current` — use `state.current_plan.path`. If that key is empty or missing, STOP: _"No plan to review — run `/st:create-plan \"<feature>\"` first."_
2. If `{plan-name}` is provided, fuzzy-match its value against the stems of files in `.software-teams/plans/`. If no match, list available plan slugs and ask which one. If more than one match, list them and ask which one.

### 2. Resolve the Plan-Part (if provided)

Map `{plan-part}` to a concrete slice:

- A task ID (`T3`, `task 3`) → the corresponding per-agent slice file or inline task block.
- An agent name → all slices whose `agent:` frontmatter matches.
- A section heading → the matching heading in the spec or orchestration file.

If the value matches nothing found in the plan artifacts, STOP and list the parts you did find. Do NOT guess.

### 3. Load Artifacts (SilentDiscovery)

Read the plan artifacts silently — do NOT print their contents to the user:

- The spec file (`{slug}.spec.md`) if it exists.
- The orchestration or plan index file resolved in step 1.
- All per-agent slice files listed in `task_files:` — or, if `{plan-part}` was resolved, only the scoped slice(s).

Store the combined content internally as `PLAN_CONTEXT`.

### 4. Spawn the Quality Reviewer

Spawn `software-teams-quality` via `Agent(subagent_type="software-teams-quality", mode="acceptEdits")`. Claude Code loads the agent spec natively from `.claude/agents/software-teams-quality.md` — do NOT inject identity via prompt text.

The spawn prompt MUST include:

- `mode: plan-review`
- The plan artifacts (or scoped part) — pass by file path when the full plan is reviewed; inline the scoped content when `{plan-part}` is set.
- The explicit goal: _"Judge whether each task is specified well enough for a specialist agent to ONE-SHOT it with no back-and-forth. Surface every consistency issue, contradiction, ambiguity, missing acceptance criterion, unpinned or incorrect agent assignment, and ordering or dependency gap."_
- The instruction to return the plan-review structured YAML defined in step 5 below — nothing else.
- Budget guidance: ≤20 file reads, ≤400-word body.

### 5. Parse the Verdict and Record It

Expect the reviewer to return exactly this YAML shape:

```yaml
mode: plan-review
one_shot_ready: true | false
quality_score: 0-100
blocking_gaps:        # empty list when one_shot_ready: true
  - task: T3
    issue: "..."
    fix: "..."
recommendations: [ "..." ]
verdict: "one-line summary"
```

If the returned YAML is malformed, empty, or missing the `mode: plan-review` key, STOP immediately — report the raw return to the user and do NOT record any state. Do not guess at a verdict from prose output.

Record via the state CLI (NEVER hand-edit `state.yaml`):

- **If ready:** `software-teams state plan-reviewed --one-shot-ready --score {quality_score} --plan-name "{plan name}" --revision {revision-if-known}`
- **If gaps:** `software-teams state plan-reviewed --score {quality_score} --plan-name "{plan name}"` (omit `--one-shot-ready`)

### 6. Branch on the Verdict

**`one_shot_ready: true` →** AUTO-APPROVE: run `software-teams state approved`. Then print exactly:

> _"Plan is one-shot ready (quality score {n}/100). Plan approved and locked in. Let me know when you want to implement."_

Then STOP (see HARD STOP gate below).

---

**`one_shot_ready: false` →** Present a compact verdict (≤40 lines total):

1. The one-line `verdict`.
2. `Quality score: {n}/100`.
3. A blocking-gaps table:

   | Task | Issue | Suggested fix |
   |------|-------|---------------|
   | T{n} | … | … |

Then ask via `AskUserQuestion` (header: **"Next step"**) with exactly two options:

- **"Auto-refine & re-review"** — spawn `software-teams-planner` via `Agent(subagent_type="software-teams-planner", mode="acceptEdits")`. Pass the plan file paths and the full `blocking_gaps` + `recommendations` from step 5, and instruct the planner to: apply the fixes IN PLACE (edit the existing plan files), increment the `revision:` counter in the affected files' frontmatter, and return when done. After the planner returns, GO BACK TO STEP 4 and re-review. This refine→re-review loop may repeat until the plan is one-shot ready or the user stops it.
- **"Stop — I'll refine"** — STOP with: _"Refine the plan (via `/st:create-plan` feedback or directly), then re-run `/st:review-plan` when ready. The plan cannot be approved until the quality review passes."_

---

## Edge Cases

Pre-written responses for known deviations. When one applies, follow the scripted response rather than improvising.

| Situation | Response |
|-----------|----------|
| No current plan and no `{plan-name}` given | STOP: "No plan to review — run `/st:create-plan \"<feature>\"` first." |
| `{plan-name}` matches nothing | List available plan slugs and ask which one. Do NOT guess. |
| `{plan-name}` matches multiple plans | List the candidates and ask which one. |
| `{plan-part}` matches nothing | STOP and list the parts found (task IDs, agent names, headings). |
| Quality agent returns malformed or empty YAML | STOP, report the raw output, do NOT record a false "ready" result. |
| Quality agent returns prose without the `mode: plan-review` key | Treat as malformed — same response as above. |
| `software-teams state` CLI missing or errors | Run `software-teams init` to initialise the state machine, then retry. |
| User asks to implement during review | Remind them of the gate: "Review and implementation are separate phases. The plan must pass the quality review before implementation can begin." Do NOT auto-advance. |
| Auto-refine loop exceeds 3 iterations without reaching `one_shot_ready: true` | Surface the remaining gaps to the user with a recommendation to stop and refine manually. Ask via `AskUserQuestion` whether to continue looping or stop. |

---

## HARD STOP — Review / Approval Gate

After auto-approval (step 6, `one_shot_ready: true` branch) or after the user chooses "Stop — I'll refine", your work is **DONE**.

- Do NOT invoke `/st:implement-plan`.
- Do NOT spawn implementation agents.
- Do NOT begin writing source code.
- Do NOT suggest next implementation commands beyond the one-line completion message.

Planning, review, and implementation are separate human-gated phases. This gate exists because past sessions have drifted into implementation immediately after approval, producing work the user did not sanction.

---

## Collaborative Protocol

@ST:StrictnessProtocol

---

**Plan to review:** $ARGUMENTS
