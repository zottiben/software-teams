---
name: build
description: "Software Teams: Guided setup and state-aware entry point for new and returning users"
allowed-tools: Read, Glob, Bash, AskUserQuestion
argument-hint: "[no arguments]"
context: |
  !cat .software-teams/config/state.yaml 2>/dev/null | head -20
  !ls .software-teams/plans/*.plan.md 2>/dev/null | tail -5
---

# /st:build

State-aware entry point for new and returning users. Silently detects project state before asking anything, then routes to the right next step. Deterministic workflow — every invocation follows the same numbered steps in order, without skipping.

**This skill follows `@ST:StrictnessProtocol` and `@ST:SilentDiscovery`. Read those components before executing any step below.**

This skill is **read-only**. It never writes files, never spawns agents, never advances state. Its only job is to hand the user a clear next action.

---

## Orchestration

The steps below are numbered and ordered. Do NOT skip, merge, or reorder them. Never auto-run the next skill — the user picks their next step.

### 1. Silent Discovery

Execute `@ST:SilentDiscovery` now. Store the result internally as `DISCOVERED_STATE`. Do NOT print discovery output to the user at this step.

If any scaffolding file is missing, record `missing: true` in `DISCOVERED_STATE` and continue. Missing scaffolding is expected on first run — it is not an error.

### 2. Returning-User Fast-Path

Check both conditions:

- `DISCOVERED_STATE.state.position.plan` is non-null AND `DISCOVERED_STATE.state.position.status` is one of `plan-ready`, `approved`, `executing`
- OR `DISCOVERED_STATE.state.progress.plans_completed > 0` OR any plan file exists with `status: complete` in its frontmatter

If EITHER is true, the user is returning. Short-circuit the onboarding flow with this exact message (substitute the bracketed fields from `DISCOVERED_STATE`):

> "Looks like you're already set up — phase **{phase}** ({phase_name}), plan **{plan}** ({plan_name}), status **{status}**. Want to pick up where you left off?
>
> - `/st:create-plan "<feature>"` — start a new plan
> - `/st:implement-plan` — continue executing the current plan
> - `/st:status` — show full state"

Then **STOP**. Do not proceed to step 3. Do not invoke any other skill. Wait for the user to choose.

If NEITHER condition is true, the user is new — proceed to step 3.

### 3. Four-Option Gate

Present exactly these four options. Frame them for software projects — no game-specific language, no engine/prototype vocabulary.

**Preferred: AskUserQuestion.** Use AskUserQuestion with:
- **header:** `STAGE`
- **question:** `Which of these describes your situation best?`
- **options:**
  1. label: `No idea yet` — description: `I want to figure out what to build`
  2. label: `Vague idea` — description: `I know the problem but not the shape of the solution`
  3. label: `Clear concept` — description: `I know what I want to build and roughly how`
  4. label: `Existing work` — description: `There's already code or scaffolding I want to continue from`

The automatic "Other" option covers situations that don't fit. Route based on the selected option — same branch logic as step 4.

**Fallback (if AskUserQuestion is unavailable):** Present as plain markdown instead:

> **Welcome to Software Teams.**
>
> Before I suggest anything, I'd like to understand where you are. Which of these describes your situation best?
>
> **A) No idea yet** — I want to figure out what to build.
>
> **B) Vague idea** — I know the problem I'm solving but not the shape of the solution.
>
> **C) Clear concept** — I know what I want to build and roughly how.
>
> **D) Existing work** — There's already code or scaffolding in this repo I want to continue from.

**Wait for the user's answer. Do not proceed until they respond.** Do not assume. Do not pick for them.

### 4. Route Based on Answer

Each branch below is its own script. Follow the one that matches the user's choice — do not blend them.

#### Branch A: No idea yet

1. Acknowledge that starting from zero is fine.
2. Ask one open question: "What domain are you curious about? Even a one-word hint is enough — 'search', 'pipelines', 'chat', anything."
3. Once they answer, recommend: `/st:create-plan "exploration: <their hint>"` with exploration framing ("the planner will turn a fuzzy goal into concrete tasks").
4. Proceed to step 5.

#### Branch B: Vague idea

1. Ask the user to share the idea in their own words — even a few sentences is enough.
2. Ask 2-3 targeted follow-ups to narrow scope: *"What problem does this solve? Who benefits? Any constraints — stack, deadline, scale?"*
3. Recommend: `/st:create-plan "<sharpened phrasing derived from their answers>"`.
4. Proceed to step 5.

#### Branch C: Clear concept

1. Ask 2-3 targeted follow-ups to lock in details: *"What's the stack? What's the scope boundary (MVP vs full feature)? Any hard constraints?"*
2. Recommend: `/st:create-plan "<concept phrased concisely>"`.
3. Proceed to step 5.

#### Branch D: Existing work

1. Refresh discovery — re-run step 1's silent reads to catch anything missed. Store as `DISCOVERED_STATE_REFRESHED`.
2. Surface what you found in plain language: *"I can see {n} plans, {n} completed. Your active phase is {phase}. Tech stack is {tech_stack}."*
3. Recommend: `/st:status` first (to show the full state clearly), then `/st:create-plan "<next feature>"` as the follow-up.
4. Proceed to step 5.

### 5. Confirm Before Handing Off

After presenting your recommendation, confirm with the user before proceeding.

**Preferred: AskUserQuestion.** Use AskUserQuestion with:
- **header:** `NEXT`
- **question:** `Ready to proceed?`
- **options:**
  1. label: `{recommended command}` — description: `Start with the recommended next step`
  2. label: `Something else` — description: `I want to do something different`

**Fallback (if AskUserQuestion is unavailable):** Ask as plain text instead:

> "Would you like to start with **{recommended command}**, or something else?"

**Wait for the user's answer. Do not auto-run anything.** The user may pick the recommended command, pick a different Software Teams command, or describe a situation that doesn't fit — follow their lead.

### 6. Hand Off

Once the user has chosen their next step, print it as a single line they can copy:

> "Next step: `/st:{chosen-command} "<args>"`"

Then **STOP**. The `/st:build` skill's job is done.

---

## Edge Cases

Pre-written responses for known deviations. When one applies, follow the scripted response rather than improvising.

| Situation | Response |
|-----------|----------|
| User picks D but `.software-teams/plans/` is empty and no state.yaml exists | Gently redirect: "The project looks fresh — no plans or state yet. Would A, B, or C fit better?" Do NOT force them into D. |
| User picks A but existing source code is present (`src/`, `lib/`, `app/` with files) | Mention what you found: "I noticed there's already code in `{path}`. Did you mean D (existing work)?" Let them re-pick. |
| Discovery shows returning user but state is in `failed` or unknown status | Surface the status and let the user decide: "Your plan is in status `{status}`. Want to resume, reset, or start fresh?" Do NOT auto-resume. |
| User's situation doesn't fit any option | Listen to their description, then map it to the closest option or ask a clarifying question. The 4 options are starting points, not a prison. |
| User tries to skip straight to implementation ("just build X for me") | Redirect to the gate: "Implementation goes through `/st:create-plan` first — it lets us agree on scope before writing code. Want me to help you phrase the plan prompt?" |
| `.software-teams/` directory doesn't exist at all | The project hasn't been initialised. Recommend `/st:init` first, then return to `/st:build`. Do NOT attempt to create scaffolding yourself — that's `/st:init`'s job. |
| User asks what Software Teams is | Give a one-paragraph explanation: "Software Teams is a context-efficient AI development framework that structures work into phases, plans, and tasks. You work with it through slash commands." Then return to the 4-option gate. |

---

## HARD STOP

The `/st:build` skill's job is **DONE** once the user has a clear next action.

- Do NOT invoke the next skill yourself.
- Do NOT spawn planners, implementers, or any other agents.
- Do NOT advance state.
- Do NOT write files.

Planning, implementation, and every other phase are separate human-gated steps. This skill is a signpost, not a conveyor belt.

---

## Collaborative Protocol

<!-- whole-component: command also uses SilentDiscovery — SilentDiscoveryDiscipline section is required for composition -->
@ST:StrictnessProtocol
