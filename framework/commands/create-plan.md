---
name: create-plan
description: "JDI: Create implementation plan"
allowed-tools: Read, Glob, Bash, Write, Edit, Task, AskUserQuestion
argument-hint: "<feature to plan> [--worktree | --worktree-lightweight | --status]"
context: |
  !cat .jdi/config/state.yaml 2>/dev/null | head -25
  !ls .jdi/plans/*.plan.md 2>/dev/null | tail -5
---

# /jdi:create-plan

Create an implementation plan using a single planner agent (includes research). Deterministic workflow — every invocation follows the same numbered steps, in order, without skipping.

**This skill follows `<JDI:StrictnessProtocol />`, `<JDI:SilentDiscovery />`, and `<JDI:InteractiveGate />`. Read those components before executing any step below.**

---

## Flags

- `--worktree` — Create git worktree with full environment before planning (follow `.claude/commands/jdi/worktree.md` steps)
- `--worktree-lightweight` — Same but skip databases/web server (deps + migrate only)
- `--status` — Status mode: generate a plan progress report using `.jdi/config/state.yaml` + the current plan. Does NOT spawn the planner. See Status Mode section below.
- `--with-tests` — Force test plan generation regardless of test suite detection. When set, the planner generates test tasks even if no existing test suite is found.
- `--without-tests` — Suppress test plan generation even when a test suite is detected. Useful for plans that only touch documentation, config, or framework files where test generation would be noise.

> **Do NOT use the built-in `EnterWorktree` tool.** Always follow `/jdi:worktree` Direct Execution steps.

---

## Status Mode (`--status`)

When `--status` is passed, run this workflow instead of the planning workflow. All other flags are ignored.

### 1. Read State

Read `.jdi/config/state.yaml` and the current plan file (index + every task file listed in `task_files:`).

### 2. Generate Tables

Produce four tables — **Completed**, **In Progress**, **Blocked**, **Not Started** — listing each task with its `agent:` pin, `priority:` band, and any notes pulled from state.

### 3. Output and Stop

Print the report to stdout. Then **STOP**. Do NOT spawn the planner. Do NOT write any files. Do NOT advance state. The user may run `/jdi:create-plan "<feature>"` (without `--status`) when they want to plan new work.

---

## Orchestration (Planning Mode)

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them. Each step ends with a clear state transition — if you cannot produce that transition, STOP and ask.

### 1. Worktree Setup (if flagged)

If `--worktree` or `--worktree-lightweight` is present, derive a branch name from the task description, follow the Direct Execution steps in `framework/commands/worktree.md`, and `cd` into `.worktrees/<name>`. Confirm the working directory changed before proceeding.

If no worktree flag is present, skip this step entirely — do not mention it to the user.

### 2. Silent Discovery

Execute `<JDI:SilentDiscovery />` now. Read the scaffolding files listed in that component and store the result internally as `PRE_DISCOVERED_CONTEXT`. Do NOT print the discovery output to the user.

**Additional reads for this skill:**
- `.jdi/REQUIREMENTS.yaml` → `risks:` block (for the planner's Risks section)
- Prior plan's `SUMMARY.md` if it exists (for carryover candidates)
- `.jdi/codebase/SUMMARY.md` if it exists (for codebase context)

Append these to `PRE_DISCOVERED_CONTEXT`.

**Test suite flag handling:** When `--with-tests` is passed, set `DISCOVERED_STATE.test_suite.forced: true` in addition to whatever detection finds. When `--without-tests` is passed, set `DISCOVERED_STATE.test_suite.suppressed: true` — this overrides detection and prevents test task generation even if a test suite is found.

**If scaffolding files are missing:** record `missing: true` for each in `PRE_DISCOVERED_CONTEXT`. Do not error. The planner will create missing files from templates in step 5.

### 3. Agent Discovery

Enumerate available agents in this order (earlier roots override later ones on name collision). For each discovered `.md` file, read the frontmatter `name:` and `description:` and record a `source:` field so `implement-plan` picks the correct spawn pattern.

1. **JDI framework specialists (primary — `source: jdi`)** — list `.jdi/framework/agents/jdi-*.md` (installed projects). If that directory does not exist, fall back to `framework/agents/jdi-*.md` (self-hosting JDI repo).
2. **Project-local Claude Code subagents (`source: claude-code`)** — list `.claude/agents/*.md`.
3. **User-global Claude Code subagents (`source: claude-code`)** — list `~/.claude/agents/*.md`.

Store the merged catalogue as `AVAILABLE_AGENTS`. If none of the roots exist, set `AVAILABLE_AGENTS = []`. Do NOT fail.

> **Why source matters:** JDI specialists (`jdi-backend`, `jdi-frontend`, etc.) are NOT registered Claude Code subagents — they live in `framework/agents/`. `implement-plan` must spawn them via `subagent_type="general-purpose"` with identity injected via prompt text. Registered Claude Code subagents (`source: claude-code`) can be spawned by name directly. See `framework/jdi.md` Critical Constraints and `framework/components/meta/AgentRouter.md` §4.

See `framework/components/meta/AgentRouter.md` §1 for the full discovery + routing rules the planner will apply.

### 4. Quick Mode Detection

If the feature description looks trivial (single file, <30 minutes, no architectural impact — e.g. "rename var X", "add a log line"), recommend `/jdi:quick "<description>"` instead. Present this as a suggestion, not a redirect:

> "This looks small enough for `/jdi:quick`, which skips the planner entirely. Want to use that instead, or stick with `/jdi:create-plan`?"

**Wait for the user's answer. Do not proceed until they respond.** If they pick quick, STOP — do not spawn the planner.

### 4a. Pre-Plan Research Spawn

Spawn `jdi-researcher` in `pre-plan-discovery` mode via `Agent(subagent_type="general-purpose", mode="acceptEdits")`. The spawn prompt MUST include:

- The feature description (`$ARGUMENTS`)
- `PRE_DISCOVERED_CONTEXT` as a YAML block
- Mode: `--pre-plan-discovery`
- Spec path: `.jdi/framework/agents/jdi-researcher.md`
- Instruction: _"Scan the codebase for decision points relevant to this feature. Return RESEARCH_QUESTIONS YAML. Budget: <=15 file reads, <400 word report."_

Store the return as `RESEARCH_DISCOVERY`.

### 4b. Pre-Planning Questions (Interactive Gate)

Execute `<JDI:InteractiveGate mode="pre-plan" />`:

1. Collect surface-level ambiguity questions from the feature description
2. Collect research-driven questions from `RESEARCH_DISCOVERY.research_questions`
3. Merge, deduplicate, prioritise (research-driven first)
4. If questions exist, present via `AskUserQuestion`. Wait for answers.
5. If zero questions from both sources, skip silently.

Store answers as `PRE_ANSWERED_QUESTIONS`.

### 5. Spawn Planner

Spawn `jdi-planner` via `Agent(subagent_type="general-purpose", mode="acceptEdits")`. The spawn prompt MUST include:

- The feature description (`$ARGUMENTS`)
- `PRE_DISCOVERED_CONTEXT` as a YAML block — planner must NOT re-read scaffolding
- `AVAILABLE_AGENTS` catalogue — planner pins specialists via AgentRouter
- `PRE_ANSWERED_QUESTIONS` YAML block (from step 4b, if any questions were asked)
- `RESEARCH_DISCOVERY.research_context` (so the planner doesn't re-scan what the researcher already found)
- `DISCOVERED_STATE.test_suite` context (detected framework, test command, patterns, and whether `forced` or `suppressed` is set)
- Explicit instruction: _"If `test_suite.detected: true` OR `test_suite.forced: true` (AND NOT `test_suite.suppressed: true`), generate test tasks per your test task generation rules. If `test_suite.suppressed: true`, skip test task generation entirely."_
- Explicit instruction: _"Do NOT re-prompt the user for anything already in PRE_DISCOVERED_CONTEXT. These questions were already answered by the user — do NOT re-ask them. The research context below summarises what was found in the codebase — use it, don't re-scan. Only surface NEW questions that emerged during planning that could not have been anticipated."_
- Spec path: `.jdi/framework/agents/jdi-planner.md`

The planner creates split plan files (index `.plan.md` + per-task `.T{n}.md` files) directly via Write tool (sandbox override for plan files). It writes `available_agents:` into the index frontmatter and pins an `agent:` field in every task file.

### 6. Verify Planner Output

After the planner returns, confirm:

- Index file `.jdi/plans/{plan-id}.plan.md` exists
- Every entry in `task_files:` exists on disk
- Every task file's frontmatter contains an `agent:` field (unless `AVAILABLE_AGENTS` was empty)
- The index frontmatter contains `available_agents:` matching what you passed in

If any check fails, STOP and report the gap to the user. Do not advance state on incomplete output.

### 7. Execute Deferred Ops

The planner creates files directly (spawned under `acceptEdits` with a scoped `allowedTools` allowlist defined in `.claude/settings.json`). If any `files_to_create` entries were returned, create them now via the Write tool as a fallback.

### 8. Update State

Run the state CLI — do NOT manually edit `.jdi/config/state.yaml`:

```bash
jdi state plan-ready --plan-path ".jdi/plans/{plan-file}" --plan-name "{plan name}"
```

### 9. Present Summary

Present the plan summary to the user:

- Plan name, objective, and sprint goal
- Task manifest table: `ID | Task | Agent | Priority | Requires`
- Any open questions the planner surfaced
- File list (index + task files)

End with the exact prompt: _"Provide feedback to refine, or say **approved** to finalise."_

**Wait for the user's answer. Do not advance state. Do not invoke any other skill. Do not begin implementation.**

### 10. Review Loop

- **Feedback:** apply the requested changes in place (edit existing plan files, increment revision counter in frontmatter), re-present the summary, and ask the same question again.
- **Approval** (user says "approved", "lgtm", "looks good", or equivalent): run `jdi state approved`, output the completion message, and STOP.

**Never loop back to step 5.** Feedback refines; it does not restart.

---

## Edge Cases

Pre-written responses for known deviations. When one applies, follow the scripted response rather than improvising.

| Situation | Response |
|-----------|----------|
| Scaffolding files missing (`.jdi/PROJECT.yaml` etc.) | Planner creates them from `framework/templates/` in step 5. Do NOT ask the user for values the template's defaults cover. |
| `.claude/agents/` empty on both levels | Set `AVAILABLE_AGENTS = []`, note in summary, and proceed. The planner falls back to tech-stack defaults. |
| Feature description is vague ("improve X") | Steps 4a + 4b handle this: the researcher discovers codebase decision points, and the InteractiveGate surfaces ambiguity questions via AskUserQuestion. Do not waste a planner invocation on an underspecified prompt. |
| Pre-plan researcher returns zero questions | Skip step 4b if surface-level analysis also yields zero questions. Proceed directly to step 5. This is expected for clear features. |
| Pre-plan researcher returns >4 questions | Batch into multiple AskUserQuestion calls (max 4 per call). Present highest-priority questions first. |
| Worktree flag but worktree already exists | Ask the user: reuse the existing worktree, or pick a new name? Do not silently proceed. |
| `--status` with no current plan | Output "No current plan — run `/jdi:create-plan \"<feature>\"` to create one" and STOP. |
| Planner returns without writing any files | STOP, report the failure, do NOT advance state. Ask the user to re-invoke or debug. |
| User asks to implement during review loop | Remind them of the gate: "Planning and implementation are separate phases. Say `approved` to lock in the plan, then run `/jdi:implement-plan`." Do NOT auto-advance. |

---

## HARD STOP — Planning Gate

After the user approves the plan, your work is **DONE**.

Output exactly: _"Plan approved and locked in. Let me know when you want to implement."_

Then STOP completely.

- Do NOT invoke `/jdi:implement-plan`.
- Do NOT spawn implementation agents.
- Do NOT begin writing source code.
- Do NOT suggest implementation commands beyond the one-line completion message.

Planning and implementation are separate human-gated phases. This gate exists because past sessions have drifted into implementation immediately after approval, producing work the user did not sanction.

---

## Collaborative Protocol

<JDI:StrictnessProtocol />

---

**References:** Agent base (read FIRST for cache): `.jdi/framework/components/meta/AgentBase.md` | Agent spec: `.jdi/framework/agents/jdi-planner.md` | Agent routing: `.jdi/framework/components/meta/AgentRouter.md`

**Feature to plan:** $ARGUMENTS
