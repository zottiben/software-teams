---
name: implement-plan
description: "JDI: Execute implementation plan"
allowed-tools: Read, Glob, Bash, Write, Edit, Task, AskUserQuestion
argument-hint: "[--team | --single | --dry-run | --skip-qa]"
context: |
  !cat .jdi/config/state.yaml 2>/dev/null | head -30
---

# /jdi:implement-plan

Execute an approved plan with complexity-based routing. Deterministic workflow — every invocation follows the same numbered steps, in order, without skipping.

**This skill follows `<JDI:StrictnessProtocol />` and `<JDI:SilentDiscovery />`. Read those components before executing any step below.**

---

## Flags

- `--team` — Force Agent Teams mode regardless of complexity signals
- `--single` — Force single-agent mode regardless of complexity signals
- `--dry-run` — Preview without writing: list files that would change and agents that would be spawned, then STOP
- `--skip-qa` — Skip the post-task `jdi-qa-tester` verification pass

> **Do NOT use the built-in `EnterWorktree` tool.** If `state.yaml` has `worktree.active: true`, just `cd` into `worktree.path`.

---

## Orchestration

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them. Each step ends with a clear state transition — if you cannot produce that transition, STOP and ask.

### 1. Silent Discovery

Execute `<JDI:SilentDiscovery />` now. Read the scaffolding files listed in that component and store the result internally as `DISCOVERED_STATE`. Do NOT print the discovery output to the user.

**Additional reads for this skill:**
- `.jdi/codebase/SUMMARY.md` if it exists
- `.jdi/framework/learnings/general.md` (always)
- Domain-specific learnings based on `DISCOVERED_STATE.tech_stack`: PHP → `backend.md`, TS/React → `frontend.md`, testing → `testing.md`, devops → `devops.md`

Learnings override defaults. Record which learnings files were found in `DISCOVERED_STATE.learnings_loaded`.

### 2. Load Plan

Read the plan index file (path from `$ARGUMENTS` or from `DISCOVERED_STATE.current_plan.path`). Parse the frontmatter for:

- `tasks:` or `task_files:` (legacy monolithic vs split plan)
- `deps:` and `waves:`
- `tech_stack:`
- `available_agents:` catalogue
- `primary_agent:` pin

**Format detection:** if frontmatter contains `task_files:`, this is a split plan — read each task file's frontmatter in a single batch. If absent, this is a legacy monolithic plan — all tasks are inline in the index.

**Plan status gate:** if the plan's status in `state.yaml` is not `approved`, STOP and tell the user: "Plan is in status `{status}` — run `/jdi:create-plan` (or the review loop) to reach `approved` before implementing."

### 3. Resolve Per-Task Agents

For every task file listed in `task_files:`, record the `agent:` field from its frontmatter. This is the `subagent_type` you will pass to the Task tool when spawning.

**Resolution order:**
1. Task-level `agent:` pin from the task file frontmatter
2. Plan-level `primary_agent:` from the index frontmatter
3. Tech-stack default: PHP → `jdi-backend`, TS/React → `jdi-frontend`, otherwise → `general-purpose`

**Test task override:** For tasks with `type: test`, the agent is always `jdi-qa-tester` regardless of the resolution order. Pass `mode: plan-test` in the spawn prompt.

**NEVER default everything to `general-purpose` silently.** See `framework/components/meta/AgentRouter.md`.

### 4. Agent Existence Check

For each pinned agent, read the matching `source:` from the plan's `available_agents` catalogue and confirm the spec exists:

- **`source: jdi`** — check `.jdi/framework/agents/{name}.md` (installed projects) or `framework/agents/{name}.md` (self-hosting JDI repo)
- **`source: claude-code`** — check `.claude/agents/{name}.md` (project-local) or `~/.claude/agents/{name}.md` (user-global)

If the spec is NOT found, downgrade to `general-purpose` (with a `jdi-backend` / `jdi-frontend` spec load in the prompt) and record an `agent_downgrade:` entry listing the original pin, the downgrade target, and the reason. This entry MUST appear in the final summary — never silently change a pin.

### 5. Complexity Routing

Apply `<JDI:ComplexityRouter />`:
- **Simple** (≤3 tasks, single stack/wave) → single-agent mode
- **Complex** (>3 tasks OR multi-stack OR multi-wave) → Agent Teams swarm

**Override flags:** `--team` forces Agent Teams mode; `--single` forces single-agent mode. Overrides win over complexity signals.

Record the routing decision and reasoning in `DISCOVERED_STATE.routing`.

### 6. Dry Run Check

If `--dry-run` is present, output:
- The resolved agent per task
- Any `agent_downgrade:` entries
- The routing decision
- The list of files each task claims to touch (from task spec)

Then **STOP**. Do NOT spawn agents, do NOT advance state, do NOT edit files.

### 7. Advance State to Executing

Run `bun run src/index.ts state executing` (in installed projects: `npx jdi state executing`). Do NOT manually edit `state.yaml`.

### 8. Spawn and Execute

**Platform constraints:**
- JDI specialists (`source: jdi`) are NOT registered Claude Code subagents and MUST be spawned via `subagent_type="general-purpose"` with identity injected via prompt text. Registered Claude Code subagents (`source: claude-code`) are spawned directly by name. See `framework/jdi.md` Critical Constraints.
- **All agents MUST be spawned with `mode: "bypassPermissions"`** — agents run in background and cannot prompt the user for Write/Edit approval. Without this mode, agents will be blocked on permission prompts and fail silently.

**Single-agent mode:**
- `source: jdi` → `Agent(subagent_type="general-purpose", mode="bypassPermissions", prompt="You are {plan.primary_agent}. Read .jdi/framework/agents/{plan.primary_agent}.md... PLAN: {index-path}")`
- `source: claude-code` → `Agent(subagent_type="{plan.primary_agent}", mode="bypassPermissions", prompt="<standard spawn prompt> PLAN: {index-path}")`

For split plans, the agent reads task files one at a time via the `file:` field in `state.yaml`.

**Agent Teams mode:** Spawn ONE Agent call per task using the source-aware pattern above. Pass `TASK_FILE: {task-file-path}` so the agent loads only its assigned task. Every spawn MUST include `mode: "bypassPermissions"`.

**Prompt scoping rules (non-negotiable):**
- One task = one spawn. Never bundle multiple tasks into one prompt.
- Give exact file paths. Cap exploration explicitly: "read only your TASK_FILE and the files it names."
- Request short reports (<400 words). Agents can be truncated mid-task; scoped prompts survive the budget ceiling.
- Include a `## Project Context` block in every spawn prompt: type, tech stack, quality gates, working directory. Saves 2-3 discovery tool calls per spawn.
- For split plans, the agent reads the `TASK_FILE` itself — do not inline task content into the prompt.

**Test task execution:** When spawning a `type: test` task:
- Use `jdi-qa-tester` agent in `plan-test` mode (always `source: jdi`, spawn via `subagent_type="general-purpose"`)
- Pass the task file path as `TASK_FILE`
- Include `test_framework`, `test_command`, and `test_scope` from the task frontmatter
- Include the `depends_on` task IDs so the test agent can read those tasks' `files_modified` for coverage context
- The test agent writes test files and runs them — failures are reported as structured returns
- Test task failures are treated as S2 severity: halt the plan and escalate to the user

**Wave-based execution:** honour `waves:` from the plan frontmatter. Spawn all tasks in wave N in parallel; wait for all returns before starting wave N+1.

### 8a. Blocker Resolution

When an agent returns `status: blocked`:

1. Read the blocker context from the agent's structured return
   (blocker_reason, blocker_context, suggested_options if any)
2. Execute `<JDI:InteractiveGate mode="blocker-resolution" />`
3. Present the blocker to the user via AskUserQuestion:
   - header: "BLOCKED"
   - question: "{task_name} is blocked: {blocker_reason}"
   - options (pick 2-4 based on context):
     a) Resolve with approach X (if agent suggested options)
     b) Skip this task and continue
     c) Modify the task scope
     d) Halt the plan
4. Route based on answer:
   - Resolve: re-spawn the agent with the resolution context
   - Skip: advance-task with skip status, continue to next
   - Modify: enter inline edit of the task file, then re-spawn
   - Halt: stop execution, enter review loop at step 14

### 9. Advance Task State

After each task's programmer returns successfully, run:

```bash
bun run src/index.ts state advance-task {task-id}
```

Do NOT advance state for tasks that failed or were skipped. Do NOT batch advance calls — advance per task, in order.

### 10. Post-Task Verify (jdi-qa-tester)

After each task's programmer returns, invoke `jdi-qa-tester` in `post-task-verify` mode with the task's `done_when` criteria and `files_modified` list. If verification fails with **S1** or **S2** severity, **halt the plan** and escalate to the user. Otherwise record the verification result in the task summary and proceed to commit.

- **a11y-check trigger:** if `files_modified` includes UI files (components, views, templates, CSS affecting render), additionally invoke `jdi-qa-tester` in `a11y-check` mode and record the result in the same task summary.
- **contract-check trigger:** if `files_modified` includes contract-bearing files — API routes, Controllers/Actions, DTOs, FormRequests, OpenAPI specs, exported TypeScript types, `packages/*/src/index.ts`, DB migrations, generated client code — additionally invoke `jdi-qa-tester` in `contract-check` mode. Treat any contract failure as at least **S2** and halt the plan.
- **Test task skip:** Skip `post-task-verify` for `type: test` tasks — they ARE the verification. The test agent's own pass/fail result is the verification outcome.
- **Skip rules:** Skipped entirely if `--skip-qa` is passed. Also skipped automatically if `files_modified` contains ONLY `.md`, `.yaml`, or `.yml` files (documentation/config doesn't get regression-tested). The programmer's structured return field `qa_verification_needed: false` is also honoured.
- **Contract-check exception to the skip rule:** if any file in `files_modified` is a contract-bearing YAML/JSON spec (OpenAPI / Swagger — e.g. `openapi.yaml`, `swagger.json`, `api/*.yaml`, `**/openapi*.{yml,yaml,json}`; GraphQL SDL — `**/*.graphql`, `**/schema.gql`; JSON Schema — `**/schemas/**/*.json`), still invoke `contract-check` even when the doc-only skip rule would otherwise apply. `post-task-verify` and `a11y-check` remain skipped in this case — only `contract-check` runs.

### 11. Execute Deferred Ops

Agents create files directly (they have `bypassPermissions`), so `files_to_create` should be empty. If any agent does return `files_to_create` entries, create them via Write tool. Execute `commits_pending` via `git add` + `git commit`. Do NOT skip this step.

### 12. Run Verification Gates

Execute the project's quality gates in order: tests, lint, typecheck (exact commands come from `DISCOVERED_STATE.quality_gates`). Record pass/fail per gate.

If any gate fails, STOP — do not advance state to `complete`. Report the failure and enter the review loop at step 14.

### 13. Advance State to Complete

Run `bun run src/index.ts state complete`. Do NOT manually edit `state.yaml`.

### 14. Present Summary

Present the implementation summary to the user:

- Tasks completed (with per-task agent and verification result)
- Files changed (grouped by task)
- Quality gate results
- Any `agent_downgrade:` events
- Deviations from the spec

End with the exact prompt: _"Provide feedback to adjust, or say **approved** to finalise."_

**Wait for the user's answer. Do NOT suggest commits or PRs yet.**

### 15. Review Loop

- **Feedback:** apply the requested code changes, re-run verification gates, increment the revision counter, and re-present the summary.
- **Approval:** suggest a conventional commit or PR generation as the next step. Do NOT auto-run either — the user decides.

**Never loop back to step 8.** Feedback refines existing tasks; it does not re-spawn agents for tasks that already completed.

---

## Edge Cases

Pre-written responses for known deviations. When one applies, follow the scripted response rather than improvising.

| Situation | Response |
|-----------|----------|
| Plan status is not `approved` | STOP at step 2. Tell the user to approve the plan first. Do NOT force-advance. |
| Pinned agent not installed | Downgrade to `general-purpose`, record the downgrade, continue. Surface in the final summary. |
| Task file missing (listed in `task_files:` but not on disk) | STOP. Report the missing file. Do NOT advance state. |
| Programmer returns with `status: blocked` | Enter step 8a (Blocker Resolution). Do NOT advance task state. Present the blocker interactively via AskUserQuestion and route based on user's choice. |
| Agent suggests resolution options in structured return | Include agent's suggestions as the first AskUserQuestion options in step 8a, before the default options (skip/modify/halt). |
| QA verification S1 or S2 failure | HALT the plan immediately. Record the failure in state. Wait for user direction before continuing. |
| Verification gate failure at step 12 | STOP before completing. Report the failure, enter review loop. Do NOT advance state to `complete`. |
| `--dry-run` with no changes needed | Output "no-op: plan is already at target state" and STOP. |
| Worktree active but path missing | Ask the user: recreate the worktree, or proceed in current directory? Do NOT silently proceed. |
| Wave has zero tasks ready | Skip the empty wave, log it, continue to the next wave. |
| User asks to skip verification during review | Remind them of `--skip-qa` flag semantics. Do NOT skip silently. |
| Test task fails (tests written but some fail) | Report the failing tests with output. Enter review loop. The user may fix implementation and re-run, or accept partial coverage. |

---

## HARD STOP — Verification Gate

Before presenting the summary (step 14), all three must be true:

1. Every task has either `advance-task` applied OR a documented failure in the summary
2. Every QA verification trigger that fired has a recorded result
3. Every quality gate has passed OR been explicitly flagged as failing in the summary

If ANY of these is not true, STOP. Do not present a summary that implies success when work remains. Silent gaps are the failure mode this gate exists to prevent.

---

## Collaborative Protocol

<JDI:StrictnessProtocol />

---

**References:** Agent base (read FIRST for cache): `.jdi/framework/components/meta/AgentBase.md` | Agent specs: `.jdi/framework/agents/jdi-backend.md`, `.jdi/framework/agents/jdi-frontend.md` | Orchestration: `.jdi/framework/components/meta/AgentTeamsOrchestration.md` | Routing: `.jdi/framework/components/meta/ComplexityRouter.md`, `.jdi/framework/components/meta/AgentRouter.md`

**Plan to execute:** $ARGUMENTS
