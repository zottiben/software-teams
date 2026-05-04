---
name: implement-plan
description: "Software Teams: Execute implementation plan"
allowed-tools: Read, Glob, Bash, Write, Edit, Task, AskUserQuestion
argument-hint: "[--team | --single | --dry-run | --skip-qa]"
context: |
  !cat .software-teams/state.yaml 2>/dev/null | head -30
---

# /st:implement-plan

Execute an approved plan with complexity-based routing. Deterministic workflow — every invocation follows the same numbered steps, in order, without skipping.

**This skill follows `@ST:StrictnessProtocol` and `@ST:SilentDiscovery`. Read those components before executing any step below.**

---

## Flags

- `--team` — Force Agent Teams mode regardless of complexity signals
- `--single` — Force single-agent mode regardless of complexity signals
- `--dry-run` — Preview without writing: list files that would change and agents that would be spawned, then STOP
- `--skip-qa` — Skip the post-task `software-teams-qa-tester` verification pass

> **Do NOT use the built-in `EnterWorktree` tool.** If `.software-teams/state.yaml` has `worktree.active: true`, just `cd` into `worktree.path`.

---

## Plan Tier Detection

Before running any execution loop, determine which tier the plan was authored in. The planner (`/st:create-plan`) emits one of two artefact shapes; this skill must branch on whichever is on disk.

```
slug = current_plan.slug   # from .software-teams/state.yaml
if exists `.software-teams/plans/{slug}.orchestration.md` → tier = three-tier
elif exists `.software-teams/plans/{slug}.plan.md`        → tier = single-tier
else                                           → STOP, ask user to run /st:create-plan
```

**Three-tier** plans (default for non-trivial features after T9/T10):
- `{slug}.spec.md` — the WHAT (problem, acceptance criteria, glossary)
- `{slug}.orchestration.md` — the HOW (task graph, agent pins, sequencing rules, quality gates)
- `{slug}.T{n}.md` — per-agent slices, each with a `**Read first:**` line citing the SPEC sections it needs

**Single-tier** plans (legacy / `--single-tier` opt-out):
- `{slug}.plan.md` — index with the task manifest inline
- `{slug}.T{n}.md` — per-task files

If `tier = three-tier`, follow the **Three-Tier Execution Loop (default)** below. If `tier = single-tier`, follow the **Single-Tier Execution Loop (legacy / fallback)** that comes after it. Do NOT mix the two — each loop is self-contained.

---

## Three-Tier Execution Loop (default)

For plans that have an `orchestration.md` artefact, the orchestrator (main Claude) reads the task graph from ORCHESTRATION, spawns each pinned agent natively with **only** its per-agent slice plus the SPEC sections that slice cites, verifies via `software-teams-qa-tester`, and advances. The orchestrator owns "when to move on" — agents never declare themselves done.

The numbered steps below run in order. Each step ends with a clear state transition — if you cannot produce that transition, STOP and ask. Steps that are identical to the single-tier loop are cross-referenced rather than duplicated.

### 3T.1. Silent Discovery

Same as the single-tier loop's **§1. Silent Discovery** below.

### 3T.2. Load Orchestration

Read `.software-teams/plans/{slug}.orchestration.md`. Parse its frontmatter for:

- `task_files:` — the list of per-agent slice paths (`{slug}.T{n}.md`)
- `available_agents:` — catalogue
- `primary_agent:` — pin used for the orchestrator brief and as fallback
- `spec_link:` — pointer to `{slug}.spec.md`

Then parse the **Tasks** manifest table (markdown table inside orchestration.md) for the task graph: `ID | Name | Agent | Wave | Depends On | Slice`. Each row pins a task to an `agent` and a `slice` file. Topologically sort by `(wave, depends_on)`.

Also record the **Sequencing Rules** and **Quality Gates** sections — they govern wave gates, parallel-safe groups, and which gates fire after which tasks.

**Plan status gate:** if the plan's status in `.software-teams/state.yaml` is not `approved`, STOP and tell the user: "Plan is in status `{status}` — run `/st:create-plan` (or the review loop) to reach `approved` before implementing."

### 3T.3. Resolve Per-Task Agents

The agent for each task comes from the manifest row's `Agent` column AND must match the `agent:` frontmatter inside the per-agent slice file (`{slug}.T{n}.md`). Read each slice's frontmatter once, in a single batch, and confirm the two agree. If they disagree, prefer the slice frontmatter (it is the contract the slice was written against) and record a `manifest_drift:` note in the summary.

**Test task override:** For tasks with `type: test` (slice frontmatter), the agent is always `software-teams-qa-tester` regardless of the manifest pin. Pass `mode: plan-test` in the spawn prompt.

**Resolution fallback:** If a slice has no `agent:` pin (legacy), fall back through manifest pin → `primary_agent` → tech-stack default → `general-purpose`. Never default to `general-purpose` silently — record an `agent_downgrade:` entry.

### 3T.4. Agent Existence Check

Same as the single-tier loop's **§4. Agent Existence Check** below — for each unique agent referenced in the task graph, confirm the spec is registered with Claude Code (`.claude/agents/{name}.md`). Record any downgrades.

### 3T.5. Complexity Routing

Apply `@ST:ComplexityRouter`. For three-tier plans the router considers the SPEC + ORCHESTRATION as the **orchestrator brief** when `--single` mode is forced; per-task spawns still load only the slice (see §3T.8 below).

`--team` and `--single` overrides win over signals as usual. Record the routing decision in `DISCOVERED_STATE.routing`.

### 3T.6. Dry Run Check

Same as the single-tier loop's **§6. Dry Run Check** below, with one addition: in three-tier mode, also report each task's `slice` path and the SPEC sections each slice will load (read each slice's `**Read first:**` line for that list). Then **STOP**.

### 3T.7. Advance State to Executing

Run `software-teams state executing`. Do NOT manually edit `.software-teams/state.yaml`.

### 3T.8. Per-Task Spawn Loop

For each task in the topologically sorted task graph:

1. **Resolve the slice load set.** Read the slice file (`{slug}.T{n}.md`) and parse its `**Read first:**` line. That line names the SPEC sections (and optionally specific ORCHESTRATION sections) the agent needs. Build a load set of:
   - The slice path itself (`{slug}.T{n}.md`)
   - The exact SPEC sections cited (NOT the full SPEC)
   - Any ORCHESTRATION subsections explicitly cited (e.g. `ORCHESTRATION §Quality Gates → contract-check`)
   - **Do NOT** include: the full SPEC, the full ORCHESTRATION, sibling slices, or the per-task files of other agents.

2. **Spawn the pinned agent natively.** Use `subagent_type="{task.agent}"` (post-T6 native migration — Claude Code resolves the spec from `.claude/agents/{task.agent}.md` directly). Spawn under `mode: "acceptEdits"` with the scoped allowlist from `.claude/settings.json`. The prompt MUST include:
   - A `## Project Context` block (type, tech stack, quality gates, working directory)
   - `TASK_FILE: {slice path}` — the agent reads it itself
   - The SPEC sections to read (pass the section anchors, NOT the file contents inline)
   - Instruction: _"Read only your TASK_FILE and the SPEC sections cited in its `**Read first:**` line. Do NOT load the full spec, the full orchestration, or other task files. Cap exploration to the files your slice names."_
   - The `done_when:` block from the slice (verbatim) so the agent knows the completion contract
   - Short-report instruction (<400 words) per `@ST:AgentBase` Budget Discipline

   **Optional (R-06 follow-up)**: Before each spawn, record the prompt context size so future plans get real per-spawn numbers instead of static estimates:

   ```
   bun run src/index.ts spawn-log record --task-id {task.id} --agent {task.agent} --bytes $(wc -c < {slice}) --slice {slice} --tier three-tier --plan-id {plan.id}
   ```

   This populates `.software-teams/persistence/spawn-ledger.jsonl`, after which `software-teams spawn-log report` produces real aggregate numbers, replacing the static estimate that T13 of plan `1-01-native-subagents` had to fall back to.

3. **Capture structured return.** Read `files_modified`, `files_created`, `commits_pending`, `qa_verification_needed`, and any `deviations`. The agent must NOT have run `git commit` itself — commits are deferred (§3T.11).

4. **Spawn `software-teams-qa-tester` in `post-task-verify` mode.** Pass the slice's `done_when:` block as the verification spec, plus `files_modified` from the agent's return. Same skip rules as §10 below: `--skip-qa`, doc-only `files_modified`, or `qa_verification_needed: false` skip the verify; contract-bearing YAML/JSON specs still trigger `contract-check`.

5. **Branch on verify result:**
   - **Pass** → run `software-teams state advance-task {task-id}`, record verification in the task summary, continue to next task.
   - **S1 / S2 fail** → halt the plan, escalate via AskUserQuestion (same blocker UX as §8a below). Do NOT advance task state.
   - **S3 / S4 fail** → record in task summary, continue. (Same severity ladder as `@ST:AgentBase`.)

6. **Wave gate:** when the wave's last task verifies, run the **post-wave-integration** gate from orchestration.md's Quality Gates section (typically `bun test` plus a smoke check on the wave's `provides:` deliverables). If the wave gate fails, halt the plan and enter the review loop at §15. Do NOT start the next wave.

The orchestrator decides "when to move on". Agents never declare themselves done — the verify step is the contract.

**Logging:** for each spawn, record bytes/tokens of context loaded (slice + cited SPEC sections only). This feeds T13's measurement work and proves the per-agent slice contract held.

### 3T.9. Advance Task State

Same as **§9. Advance Task State** below — run `software-teams state advance-task {task-id}` per task, in order, never batched. Already covered inside the loop above; called out as its own step number for parity with the single-tier loop.

### 3T.10. Post-Task Verify

Mechanism is identical to the single-tier loop's **§10. Post-Task Verify**. The only difference is the **source of truth** for the `done_when:` criteria: in three-tier mode it comes from the per-agent slice's `**Done when:**` block. The slice IS the verification spec.

### 3T.11. Execute Deferred Ops

Same as **§11. Execute Deferred Ops** below — execute `commits_pending` via `git add` + `git commit`, create any `files_to_create` entries via the Write tool. Do NOT skip this step.

### 3T.12. Run Verification Gates

Same as **§12. Run Verification Gates** below. The plan-level quality gates from `DISCOVERED_STATE.quality_gates` apply in addition to the wave-level integration checks already run inside the loop.

### 3T.13. Advance State to Complete

Same as **§13. Advance State to Complete** below — run `software-teams state complete`.

### 3T.14. Present Summary

Same as **§14. Present Summary** below, plus: report each task's slice path, the SPEC sections cited in `**Read first:**`, and the bytes/tokens loaded per spawn (from §3T.8 step 6 logging).

### 3T.15. Review Loop

Same as **§15. Review Loop** below. **Never loop back to §3T.8.** Feedback refines completed tasks; it does not re-spawn agents for tasks that already finished.

---

## Single-Tier Execution Loop (legacy / fallback)

For plans authored as `{slug}.plan.md` + per-task `{slug}.T{n}.md` (no SPEC, no ORCHESTRATION). Identical mechanics to the three-tier loop above except (a) the index is `{slug}.plan.md` rather than `{slug}.orchestration.md`, (b) tasks reference the full plan rather than a SPEC slice, and (c) per-task spawns load the task file plus the (smaller) plan index rather than per-agent slices.

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them. Each step ends with a clear state transition — if you cannot produce that transition, STOP and ask.

### 1. Silent Discovery

Execute `@ST:SilentDiscovery` now. Read the scaffolding files listed in that component and store the result internally as `DISCOVERED_STATE`. Do NOT print the discovery output to the user.

**Additional reads for this skill:**
- `.software-teams/codebase/summary.md` if it exists
- `.software-teams/rules/general.md` (always)
- Domain-specific rules based on `DISCOVERED_STATE.tech_stack`: PHP → `backend.md`, TS/React → `frontend.md`, testing → `testing.md`, devops → `devops.md`

Rules override defaults. Record which rules files were found in `DISCOVERED_STATE.rules_loaded`.

### 2. Load Plan

Read the plan index file (path from `$ARGUMENTS` or from `DISCOVERED_STATE.current_plan.path`). Parse the frontmatter for:

- `tasks:` or `task_files:` (legacy monolithic vs split plan)
- `deps:` and `waves:`
- `tech_stack:`
- `available_agents:` catalogue
- `primary_agent:` pin

**Format detection:** if frontmatter contains `task_files:`, this is a split plan — read each task file's frontmatter in a single batch. If absent, this is a legacy monolithic plan — all tasks are inline in the index.

**Plan status gate:** if the plan's status in `.software-teams/state.yaml` is not `approved`, STOP and tell the user: "Plan is in status `{status}` — run `/st:create-plan` (or the review loop) to reach `approved` before implementing."

### 3. Resolve Per-Task Agents

For every task file listed in `task_files:`, record the `agent:` field from its frontmatter. This is the `subagent_type` you will pass to the Task tool when spawning.

**Resolution order:**
1. Task-level `agent:` pin from the task file frontmatter
2. Plan-level `primary_agent:` from the index frontmatter
3. Tech-stack default: PHP → `software-teams-backend`, TS/React → `software-teams-frontend`, otherwise → `general-purpose`

**Test task override:** For tasks with `type: test`, the agent is always `software-teams-qa-tester` regardless of the resolution order. Pass `mode: plan-test` in the spawn prompt.

**NEVER default everything to `general-purpose` silently.** See `framework/components/meta/AgentRouter.md`.

### 4. Agent Existence Check

For each pinned agent, read the matching `source:` from the plan's `available_agents` catalogue and confirm the spec is registered with Claude Code:

- **`source: software-teams`** — check `.claude/agents/{name}.md` (generated by `software-teams sync-agents` from `.claude/agents/{name}.md`, or from `framework/agents/{name}.md` in the self-hosting Software Teams repo). If `.claude/agents/` is empty (e.g. fresh clone before `software-teams sync-agents` ran), the legacy injection fallback documented in AgentRouter.md §4 still works.
- **`source: claude-code`** — check `.claude/agents/{name}.md` (project-local) or `~/.claude/agents/{name}.md` (user-global)

If the spec is NOT found, downgrade to `general-purpose` (with a `software-teams-backend` / `software-teams-frontend` spec load in the prompt) and record an `agent_downgrade:` entry listing the original pin, the downgrade target, and the reason. This entry MUST appear in the final summary — never silently change a pin.

### 5. Complexity Routing

Apply `@ST:ComplexityRouter`:
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

Run `software-teams state executing`. Do NOT manually edit `.software-teams/state.yaml`.

### 8. Spawn and Execute

**Platform constraints:**
<!-- lint-allow: legacy-injection -->
- All agents (both `source: software-teams` and `source: claude-code`) are spawned natively by name: `subagent_type="{task.agent}"`. Claude Code resolves the spec from `.claude/agents/{task.agent}.md`. Software Teams specialists land there via `software-teams sync-agents` (which converts `framework/agents/software-teams-*.md` to the Claude Code-compatible format). The legacy `subagent_type="general-purpose"` + identity-injection pattern is documented as a fallback only — see `framework/components/meta/AgentRouter.md` §4 and `framework/software-teams.md` Critical Constraints.
<!-- /lint-allow -->
- **All agents MUST be spawned with `mode: "acceptEdits"`** — combined with the scoped `allowedTools` allowlist (declared once in `.claude/settings.json` and mirrored at spawn time in `src/utils/claude.ts`), agents get the file-write/tool access they need without the blanket `bypassPermissions` escape hatch. Agents run in background and cannot prompt the user for Write/Edit approval; the allowlist ensures they don't get stuck on prompts.

**Single-agent mode:**
- `Agent(subagent_type="{plan.primary_agent}", mode="acceptEdits", prompt="<standard spawn prompt> PLAN: {index-path}")`
- The variable `{plan.primary_agent}` resolves to the native agent name (e.g. `software-teams-backend`, `software-teams-frontend`, `unity-specialist`) for both `source: software-teams` and `source: claude-code` after `software-teams sync-agents` has run.

For split plans, the agent reads task files one at a time via the `file:` field in `.software-teams/state.yaml`.

**Agent Teams mode:** Spawn ONE Agent call per task using `subagent_type="{task.agent}"`. Pass `TASK_FILE: {task-file-path}` so the agent loads only its assigned task. Every spawn MUST include `mode: "acceptEdits"` (scoped allowlist in `.claude/settings.json`).

**Prompt scoping rules (non-negotiable):**
- One task = one spawn. Never bundle multiple tasks into one prompt.
- Give exact file paths. Cap exploration explicitly: "read only your TASK_FILE and the files it names."
- Request short reports (<400 words). Agents can be truncated mid-task; scoped prompts survive the budget ceiling.
- Include a `## Project Context` block in every spawn prompt: type, tech stack, quality gates, working directory. Saves 2-3 discovery tool calls per spawn.
- For split plans, the agent reads the `TASK_FILE` itself — do not inline task content into the prompt.

**Test task execution:** When spawning a `type: test` task:
- Use `software-teams-qa-tester` agent in `plan-test` mode (always `source: software-teams`, spawn natively as `subagent_type="software-teams-qa-tester"`)
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
2. Execute `@ST:InteractiveGate:blocker-resolution`
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
software-teams state advance-task {task-id}
```

Do NOT advance state for tasks that failed or were skipped. Do NOT batch advance calls — advance per task, in order.

### 10. Post-Task Verify (software-teams-qa-tester)

After each task's programmer returns, invoke `software-teams-qa-tester` in `post-task-verify` mode with the task's `done_when` criteria and `files_modified` list. If verification fails with **S1** or **S2** severity, **halt the plan** and escalate to the user. Otherwise record the verification result in the task summary and proceed to commit.

- **a11y-check trigger:** if `files_modified` includes UI files (components, views, templates, CSS affecting render), additionally invoke `software-teams-qa-tester` in `a11y-check` mode and record the result in the same task summary.
- **contract-check trigger:** if `files_modified` includes contract-bearing files — API routes, Controllers/Actions, DTOs, FormRequests, OpenAPI specs, exported TypeScript types, `packages/*/src/index.ts`, DB migrations, generated client code — additionally invoke `software-teams-qa-tester` in `contract-check` mode. Treat any contract failure as at least **S2** and halt the plan.
- **Test task skip:** Skip `post-task-verify` for `type: test` tasks — they ARE the verification. The test agent's own pass/fail result is the verification outcome.
- **Skip rules:** Skipped entirely if `--skip-qa` is passed. Also skipped automatically if `files_modified` contains ONLY `.md`, `.yaml`, or `.yml` files (documentation/config doesn't get regression-tested). The programmer's structured return field `qa_verification_needed: false` is also honoured.
- **Contract-check exception to the skip rule:** if any file in `files_modified` is a contract-bearing YAML/JSON spec (OpenAPI / Swagger — e.g. `openapi.yaml`, `swagger.json`, `api/*.yaml`, `**/openapi*.{yml,yaml,json}`; GraphQL SDL — `**/*.graphql`, `**/schema.gql`; JSON Schema — `**/schemas/**/*.json`), still invoke `contract-check` even when the doc-only skip rule would otherwise apply. `post-task-verify` and `a11y-check` remain skipped in this case — only `contract-check` runs.

### 11. Execute Deferred Ops

Agents create files directly (spawned under `acceptEdits` with the scoped allowlist from `.claude/settings.json`), so `files_to_create` should be empty. If any agent does return `files_to_create` entries, create them via Write tool. Execute `commits_pending` via `git add` + `git commit`. Do NOT skip this step.

### 12. Run Verification Gates

Execute the project's quality gates in order: tests, lint, typecheck (exact commands come from `DISCOVERED_STATE.quality_gates`). Record pass/fail per gate.

If any gate fails, STOP — do not advance state to `complete`. Report the failure and enter the review loop at step 14.

### 13. Advance State to Complete

Run `software-teams state complete`. Do NOT manually edit `.software-teams/state.yaml`.

### 14. Present Summary

Present the implementation summary using the **fixed shape** below. Do NOT free-form. Do NOT add explainer sections. Past sessions have hung mid-stream on long prose summaries with unfenced punctuation; the structure exists to prevent that.

**Required shape (in this exact order):**

1. **Task table** — one row per task: `ID | Name | Agent | Verify`. Nothing else.
2. **Files changed** — bulleted list of paths grouped under "Modified:" / "Created:". No prose.
3. **Quality gates** — one line per gate with the metric (e.g. `bun test: 390 pass / 0 fail`).
4. **Deviations / downgrades** — bulleted list, or the literal word `none`.

**Hard caps:**

- ≤ 40 lines of output total. If you cannot fit the report in 40 lines, drop detail — never split into multiple messages and never extend the structure.
- No "how it now works", "downstream view", "what this enables", marketing copy, or other explainer prose. That belongs in the PR description, not here.
- Always wrap option lists, slash-separated alternatives, and commands in backticks (e.g. `` `approved` / `lgtm` / `looks good` ``). Free-floating `/` characters in user-visible Markdown are a streaming-renderer hazard — fence them.

End with the EXACT prompt and STOP:

> _"Provide feedback to adjust, or say **approved** to finalise."_

**Wait for the user's answer. Do NOT suggest commits, PRs, follow-up commands, or next steps in this message.**

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

<!-- whole-component: command also uses SilentDiscovery — SilentDiscoveryDiscipline section is required for composition -->
@ST:StrictnessProtocol

---

**References:** Agent base (read FIRST for cache): `.software-teams/framework/components/meta/AgentBase.md` | Agent specs: `.claude/agents/software-teams-backend.md`, `.claude/agents/software-teams-frontend.md` | Orchestration: `.software-teams/framework/components/meta/AgentTeamsOrchestration.md` | Routing: `.software-teams/framework/components/meta/ComplexityRouter.md`, `.software-teams/framework/components/meta/AgentRouter.md`

**Plan to execute:** $ARGUMENTS
