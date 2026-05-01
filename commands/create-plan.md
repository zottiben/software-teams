---
name: create-plan
description: "Software Teams: Create implementation plan"
allowed-tools: Read, Glob, Bash, Write, Edit, Task, AskUserQuestion
argument-hint: "<feature to plan> [--worktree | --worktree-lightweight | --status | --single-tier]"
context: |
  !cat .software-teams/config/state.yaml 2>/dev/null | head -25
  !ls .software-teams/plans/*.orchestration.md 2>/dev/null | tail -5
  !ls .software-teams/plans/*.plan.md 2>/dev/null | tail -5
---

# /st:create-plan

Create an implementation plan using a single planner agent (includes research). Deterministic workflow — every invocation follows the same numbered steps, in order, without skipping.

**This skill follows `@ST:StrictnessProtocol`, `@ST:SilentDiscovery`, and `@ST:InteractiveGate`. Read those components before executing any step below.**

---

## Flags

- `--worktree` — Create git worktree with full environment before planning (follow `.claude/commands/st/worktree.md` steps)
- `--worktree-lightweight` — Same but skip databases/web server (deps + migrate only)
- `--status` — Status mode: generate a plan progress report using `.software-teams/config/state.yaml` + the current plan. Does NOT spawn the planner. See Status Mode section below.
- `--with-tests` — Force test plan generation regardless of test suite detection. When set, the planner generates test tasks even if no existing test suite is found.
- `--without-tests` — Suppress test plan generation even when a test suite is detected. Useful for plans that only touch documentation, config, or framework files where test generation would be noise.
- `--single-tier` — Force the legacy single-tier output (`{slug}.plan.md` + per-task `{slug}.T{n}.md`). By default this skill drives the planner toward three-tier output (SPEC + ORCHESTRATION + per-agent slices) when the plan is non-trivial — `--single-tier` opts out of that and forces the legacy shape. Useful for hotfixes, tiny plans, or when something downstream still expects the legacy index.

> **Do NOT use the built-in `EnterWorktree` tool.** Always follow `/st:worktree` Direct Execution steps.

---

## Status Mode (`--status`)

When `--status` is passed, run this workflow instead of the planning workflow. All other flags are ignored.

### 1. Read State

Read `.software-teams/config/state.yaml` and the current plan's index file. The index source depends on the plan's tier:

- **Three-tier (preferred):** read `{slug}.orchestration.md` — the Tasks manifest table is canonical here.
- **Single-tier (legacy fallback):** read `{slug}.plan.md` — the Tasks manifest is in its `<section name="TaskManifest">` block.

Detection: if `{slug}.orchestration.md` exists, prefer it. Otherwise fall back to `{slug}.plan.md`. Never assume only one shape exists.

After picking the index, read every per-task file listed in the manifest (per-agent `.T{n}.md` slices in three-tier; PLAN-TASK `.T{n}.md` files in single-tier — same file pattern, different bodies).

### 2. Generate Tables

Produce four tables — **Completed**, **In Progress**, **Blocked**, **Not Started** — listing each task with its `agent:` pin, `priority:` band, and any notes pulled from state. The agent pin lives in each per-task file's frontmatter regardless of tier.

### 3. Output and Stop

Print the report to stdout. Then **STOP**. Do NOT spawn the planner. Do NOT write any files. Do NOT advance state. The user may run `/st:create-plan "<feature>"` (without `--status`) when they want to plan new work.

---

## Orchestration (Planning Mode)

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them. Each step ends with a clear state transition — if you cannot produce that transition, STOP and ask.

### 1. Worktree Setup (if flagged)

If `--worktree` or `--worktree-lightweight` is present, derive a branch name from the task description, follow the Direct Execution steps in `framework/commands/worktree.md`, and `cd` into `.worktrees/<name>`. Confirm the working directory changed before proceeding.

If no worktree flag is present, skip this step entirely — do not mention it to the user.

### 2. Silent Discovery

Execute `@ST:SilentDiscovery` now. Read the scaffolding files listed in that component and store the result internally as `PRE_DISCOVERED_CONTEXT`. Do NOT print the discovery output to the user.

**Additional reads for this skill:**
- `.software-teams/REQUIREMENTS.yaml` → `risks:` block (for the planner's Risks section)
- Prior plan's `SUMMARY.md` if it exists (for carryover candidates)
- `.software-teams/codebase/SUMMARY.md` if it exists (for codebase context)

Append these to `PRE_DISCOVERED_CONTEXT`.

**Test suite flag handling:** When `--with-tests` is passed, set `DISCOVERED_STATE.test_suite.forced: true` in addition to whatever detection finds. When `--without-tests` is passed, set `DISCOVERED_STATE.test_suite.suppressed: true` — this overrides detection and prevents test task generation even if a test suite is found.

**If scaffolding files are missing:** record `missing: true` for each in `PRE_DISCOVERED_CONTEXT`. Do not error. The planner will create missing files from templates in step 5.

### 3. Agent Discovery

Enumerate available agents in this order (earlier roots override later ones on name collision). For each discovered `.md` file, read the frontmatter `name:` and `description:` and record a `source:` field so `implement-plan` picks the correct spawn pattern.

1. **Software Teams framework specialists (primary — `source: software-teams`)** — list `.software-teams/framework/agents/software-teams-*.md` (installed projects). If that directory does not exist, fall back to `framework/agents/software-teams-*.md` (self-hosting Software Teams repo).
2. **Project-local Claude Code subagents (`source: claude-code`)** — list `.claude/agents/*.md`.
3. **User-global Claude Code subagents (`source: claude-code`)** — list `~/.claude/agents/*.md`.

Store the merged catalogue as `AVAILABLE_AGENTS`. If none of the roots exist, set `AVAILABLE_AGENTS = []`. Do NOT fail.

> **Why source matters:** Software Teams specialists (`software-teams-backend`, `software-teams-frontend`, etc.) are converted from `framework/agents/` into `.claude/agents/` by `software-teams sync-agents`, so once that has run they are spawned natively by name (`subagent_type="software-teams-backend"`). The `source:` field still distinguishes specialists shipped with Software Teams (`source: software-teams`) from user-added Claude Code subagents (`source: claude-code`) for routing decisions. See `framework/software-teams.md` Critical Constraints and `framework/components/meta/AgentRouter.md` §4.

See `framework/components/meta/AgentRouter.md` §1 for the full discovery + routing rules the planner will apply.

### 4. Quick Mode Detection

If the feature description looks trivial (single file, <30 minutes, no architectural impact — e.g. "rename var X", "add a log line"), recommend `/st:quick "<description>"` instead. Present this as a suggestion, not a redirect:

> "This looks small enough for `/st:quick`, which skips the planner entirely. Want to use that instead, or stick with `/st:create-plan`?"

**Wait for the user's answer. Do not proceed until they respond.** If they pick quick, STOP — do not spawn the planner.

### 4a. Pre-Plan Research Spawn

Spawn `software-teams-researcher` in `pre-plan-discovery` mode via `Agent(subagent_type="software-teams-researcher", mode="acceptEdits")`. Claude Code loads the agent spec natively from `.claude/agents/software-teams-researcher.md` — do NOT inject identity via prompt text. The spawn prompt MUST include:

- The feature description (`$ARGUMENTS`)
- `PRE_DISCOVERED_CONTEXT` as a YAML block
- Mode: `--pre-plan-discovery`
- Instruction: _"Scan the codebase for decision points relevant to this feature. Return RESEARCH_QUESTIONS YAML. Budget: <=15 file reads, <400 word report."_

Store the return as `RESEARCH_DISCOVERY`.

### 4b. Pre-Planning Questions (Interactive Gate)

Execute `@ST:InteractiveGate:pre-plan`:

1. Collect surface-level ambiguity questions from the feature description
2. Collect research-driven questions from `RESEARCH_DISCOVERY.research_questions`
3. Merge, deduplicate, prioritise (research-driven first)
4. If questions exist, present via `AskUserQuestion`. Wait for answers.
5. If zero questions from both sources, skip silently.

Store answers as `PRE_ANSWERED_QUESTIONS`.

### 5. Spawn Planner

Spawn `software-teams-planner` via `Agent(subagent_type="software-teams-planner", mode="acceptEdits")`. Claude Code loads the agent spec natively from `.claude/agents/software-teams-planner.md` — do NOT inject identity via prompt text. Native spawn here confirms the post-T6 wave-2 migration; the lint suite forbids the legacy `general-purpose` injection pattern in this file.

**Tier selection in the spawn prompt:**

- **Default (no `--single-tier`):** pass `tier: three-tier` in the spawn prompt. The planner applies its own Tier Decision Rule (`task_count > 3` OR cross-team) and may downgrade to single-tier if the plan is genuinely tiny — `tier: three-tier` is a request, not a mandate. Most non-trivial features will produce SPEC + ORCHESTRATION + per-agent slices.
- **With `--single-tier`:** pass `tier: single-tier` in the spawn prompt. This forces the legacy `{slug}.plan.md` + `{slug}.T{n}.md` shape regardless of task count.

The spawn prompt MUST include:

- The feature description (`$ARGUMENTS`)
- `PRE_DISCOVERED_CONTEXT` as a YAML block — planner must NOT re-read scaffolding
- `AVAILABLE_AGENTS` catalogue — planner pins specialists via AgentRouter
- `PRE_ANSWERED_QUESTIONS` YAML block (from step 4b, if any questions were asked)
- `RESEARCH_DISCOVERY.research_context` (so the planner doesn't re-scan what the researcher already found)
- `DISCOVERED_STATE.test_suite` context (detected framework, test command, patterns, and whether `forced` or `suppressed` is set)
- `tier: three-tier` (default) OR `tier: single-tier` (when `--single-tier` passed) — see "Tier selection" above.
- Explicit instruction: _"If `test_suite.detected: true` OR `test_suite.forced: true` (AND NOT `test_suite.suppressed: true`), generate test tasks per your test task generation rules. If `test_suite.suppressed: true`, skip test task generation entirely."_
- Explicit instruction: _"Do NOT re-prompt the user for anything already in PRE_DISCOVERED_CONTEXT. These questions were already answered by the user — do NOT re-ask them. The research context below summarises what was found in the codebase — use it, don't re-scan. Only surface NEW questions that emerged during planning that could not have been anticipated."_
- Explicit instruction: _"Apply your Tier Decision Rule. If tier resolves to three-tier, write SPEC + ORCHESTRATION + per-agent slices. If tier resolves to single-tier, write the legacy `.plan.md` index + per-task files. Report the chosen `tier:` in your structured return."_

The planner creates split plan files directly via the Write tool (sandbox override for plan files). In three-tier mode it writes `{slug}.spec.md`, `{slug}.orchestration.md`, and per-agent `{slug}.T{n}.md` slices, with `available_agents:` and `primary_agent:` in the orchestration frontmatter and `agent:` pinned in every per-agent slice. In single-tier mode it writes `{slug}.plan.md` + per-task `{slug}.T{n}.md`, with `available_agents:` in the index frontmatter and `agent:` pinned in every task file.

### 6. Verify Planner Output

After the planner returns, read the structured return's `tier:` field and verify the matching artefact set. **If the structured return omits `tier:`, treat it as `single-tier` for back-compat (older planner specs may not report it).**

**If `tier: three-tier`:**

- SPEC file `{slug}.spec.md` exists at `spec_path`
- ORCHESTRATION file `{slug}.orchestration.md` exists at `orchestration_path`
- Every per-agent slice listed in `task_files:` exists on disk
- ORCHESTRATION frontmatter contains `available_agents:` matching what you passed in, and `primary_agent:`
- Every per-agent slice's frontmatter contains `agent:`, `tier: per-agent`, `spec_link:`, `orchestration_link:` (unless `AVAILABLE_AGENTS` was empty — then `agent:` may be `general-purpose`)
- Every per-agent slice's body opens with `**Why this slice:**` and `**Read first:**` headers (token-efficiency contract)
- Legacy `{slug}.plan.md` is OPTIONAL — do not error if it is absent.

**If `tier: single-tier`:**

- Index file `{slug}.plan.md` exists at `plan_path`
- Every entry in `task_files:` exists on disk
- Every task file's frontmatter contains an `agent:` field (unless `AVAILABLE_AGENTS` was empty)
- The index frontmatter contains `available_agents:` matching what you passed in
- SPEC and ORCHESTRATION files are NOT expected — do not error if they are absent.

If any check fails, STOP and report the gap to the user. Do not advance state on incomplete output.

### 7. Execute Deferred Ops

The planner creates files directly (spawned under `acceptEdits` with a scoped `allowedTools` allowlist defined in `.claude/settings.json`). If any `files_to_create` entries were returned, create them now via the Write tool as a fallback.

### 8. Update State

Run the state CLI — do NOT manually edit `.software-teams/config/state.yaml`. The `--plan-path` argument is the **canonical index** for the chosen tier:

- **Three-tier:** pass the orchestration file path (`{slug}.orchestration.md`) — that is the canonical manifest in three-tier mode.
- **Single-tier:** pass the index file path (`{slug}.plan.md`) — legacy behaviour.

```bash
software-teams state plan-ready --plan-path ".software-teams/plans/{canonical-index-file}" --plan-name "{plan name}"
```

### 9. Present Summary

Present the plan summary to the user:

- Plan name, objective, and sprint goal (from SPEC.md in three-tier; from PLAN.md in single-tier)
- Task manifest table: `ID | Task | Agent | Priority | Requires` (from ORCHESTRATION.md in three-tier; from PLAN.md in single-tier)
- Any open questions the planner surfaced
- File list — show the chosen tier and the artefacts produced:
  - Three-tier: `{slug}.spec.md`, `{slug}.orchestration.md`, and every `{slug}.T{n}.md`
  - Single-tier: `{slug}.plan.md` and every `{slug}.T{n}.md`

End with the exact prompt: _"Provide feedback to refine, or say **approved** to finalise."_

**Wait for the user's answer. Do not advance state. Do not invoke any other skill. Do not begin implementation.**

### 10. Review Loop

- **Feedback:** apply the requested changes in place (edit existing plan files, increment revision counter in frontmatter), re-present the summary, and ask the same question again.
- **Approval** (user says "approved", "lgtm", "looks good", or equivalent): run `software-teams state approved`, output the completion message, and STOP.

**Never loop back to step 5.** Feedback refines; it does not restart.

---

## Edge Cases

Pre-written responses for known deviations. When one applies, follow the scripted response rather than improvising.

| Situation | Response |
|-----------|----------|
| Scaffolding files missing (`.software-teams/PROJECT.yaml` etc.) | Planner creates them from `framework/templates/` in step 5. Do NOT ask the user for values the template's defaults cover. |
| `.claude/agents/` empty on both levels | Set `AVAILABLE_AGENTS = []`, note in summary, and proceed. The planner falls back to tech-stack defaults. |
| Feature description is vague ("improve X") | Steps 4a + 4b handle this: the researcher discovers codebase decision points, and the InteractiveGate surfaces ambiguity questions via AskUserQuestion. Do not waste a planner invocation on an underspecified prompt. |
| Pre-plan researcher returns zero questions | Skip step 4b if surface-level analysis also yields zero questions. Proceed directly to step 5. This is expected for clear features. |
| Pre-plan researcher returns >4 questions | Batch into multiple AskUserQuestion calls (max 4 per call). Present highest-priority questions first. |
| Worktree flag but worktree already exists | Ask the user: reuse the existing worktree, or pick a new name? Do not silently proceed. |
| `--status` with no current plan | Output "No current plan — run `/st:create-plan \"<feature>\"` to create one" and STOP. |
| Planner returns without writing any files | STOP, report the failure, do NOT advance state. Ask the user to re-invoke or debug. |
| User asks to implement during review loop | Remind them of the gate: "Planning and implementation are separate phases. Say `approved` to lock in the plan, then run `/st:implement-plan`." Do NOT auto-advance. |
| Planner returns `tier: three-tier` but SPEC or ORCHESTRATION is missing | STOP and report the missing artefact. The structured return advertised three-tier — incomplete output cannot advance state. Ask the user to re-invoke. |
| Planner downgraded `tier` to single-tier despite the spawn prompt requesting three-tier | Accept the downgrade — the planner applied its own Tier Decision Rule and concluded the plan is single-team / ≤3 tasks. Verify the single-tier artefact set and proceed. |

---

## HARD STOP — Planning Gate

After the user approves the plan, your work is **DONE**.

Output exactly: _"Plan approved and locked in. Let me know when you want to implement."_

Then STOP completely.

- Do NOT invoke `/st:implement-plan`.
- Do NOT spawn implementation agents.
- Do NOT begin writing source code.
- Do NOT suggest implementation commands beyond the one-line completion message.

Planning and implementation are separate human-gated phases. This gate exists because past sessions have drifted into implementation immediately after approval, producing work the user did not sanction.

---

## Collaborative Protocol

<!-- whole-component: command also uses SilentDiscovery — SilentDiscoveryDiscipline section is required for composition -->
@ST:StrictnessProtocol

---

**References:** Agent base (read FIRST for cache): `.software-teams/framework/components/meta/AgentBase.md` | Agent spec: `.software-teams/framework/agents/software-teams-planner.md` | Agent routing: `.software-teams/framework/components/meta/AgentRouter.md`

**Feature to plan:** $ARGUMENTS
