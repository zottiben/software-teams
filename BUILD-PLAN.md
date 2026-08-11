# Software Teams - modernisation plan (Claude 5 / Claude Code 2.1.x)

> **Status:** slice 0 shipped. Slices 1-9 not started.
> **Owner:** Ben. **Target:** Software Teams n8n nodes running production support tickets.
> **Baseline:** repo at `0.13.0`; researched against Claude Code `2.1.220` and the
> Claude 5 model generation (Opus 5 / Sonnet 5 / Fable 5 / Haiku 4.5).
> **Verification standard:** every slice must leave `bun run typecheck`, `bun run lint`,
> `bun run test`, `bun run build`, and `bun run verify:node-load` green. Green tests alone
> are not proof (see `AGENTS.md` rule 1).

---

## 1. Why this exists

Software Teams was built against the Claude 4.x generation and an older Claude Code
harness. Two things have since changed:

1. **The harness grew native versions of things Software Teams hand-rolled.** Skills,
   `.claude/rules/` with path scoping, auto memory, subagent `memory:`/`effort:`/
   `isolation: worktree`/`skills:`, agent teams, dynamic workflows, `--agents` JSON,
   `--json-schema`, `--max-budget-usd`. Several Software Teams subsystems are now
   duplicating harness features, at a context cost and a maintenance cost.
2. **The prompting doctrine inverted.** Anthropic's
   [new rules of context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)
   replaced "give Claude rules, examples, and repetition, all upfront" with "let Claude
   use judgement, design interfaces, use progressive disclosure, don't repeat yourself."
   Software Teams' 33 agent specs are written almost entirely in the old style.

On top of that, a set of things are **silently broken**: they typecheck, lint, and pass
tests, but do nothing (or the wrong thing) at runtime. Those come first.

---

## 2. Research findings (the evidence base)

### 2.1 Confirmed broken today

| # | Finding | Evidence |
|---|---------|----------|
| B1 | **The `Task` tool does not exist.** It is `Agent`. 8 command files list `Task` in `allowed-tools` (grants nothing) and ~20 agent/command bodies instruct Claude to call `Task subagent_type=<name>`, teaching a nonexistent tool. | Live tool enumeration on 2.1.220 returns `Agent, Bash, Edit, Read, ReportFindings, Skill, ToolSearch, Workflow, Write, Cron*, EnterWorktree, ExitWorktree, NotebookEdit, ScheduleWakeup, SendMessage, Task{Create,Get,List,Output,Stop,Update}, WebFetch, WebSearch`. No `Task`. |
| B2 | **n8n model selection is a no-op.** `SoftwareTeamsAgent.node.ts:183` sets `process.env['ANTHROPIC_DEFAULT_MODEL']`, which is not a Claude Code env var, and `single-turn.ts` never passes `--model`. It also mutates shared worker `process.env`, leaking across executions. | `grep -c ANTHROPIC_DEFAULT_MODEL` on the env-vars reference returns `0`. Valid vars are `ANTHROPIC_MODEL` and `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`. |
| B3 | **Every pinned model ID is stale.** `config/config.yaml` profiles use `claude-opus-4-8` / `claude-opus-4-6` / `claude-sonnet-4-6`; the n8n picker offers `claude-sonnet-4-5`, `claude-opus-4-5` (not a real ID, labelled "Claude Opus 4"), `claude-haiku-3-5`. | Current: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-haiku-4-5`; aliases `opus`/`sonnet`/`haiku`/`fable`/`best`. |
| B4 | **`templates/.claude/settings.json` pre-approvals never apply.** There is no top-level `allowedTools` settings key; the correct key is `permissions.allow`. The block is silently ignored (verified: no warning, session runs fine). It also lists `MultiEdit` and `Task`, neither of which exists. | Settings reference has no `allowedTools`. Probe with the template in place: session succeeded, `claude --debug` emitted no settings warning, so the key is dropped rather than rejected. |
| B5 | **`AGENTS-MODELS.md` tool policy names tools subagents cannot have.** It lists `Task` (gone) and `AskUserQuestion`, which the harness strips from *every* subagent unconditionally. | Subagents doc: `AskUserQuestion` is in the always-removed filter list. |
| B6 | **The component-cost benchmark and its CI gate are inert.** Pre-existing and already documented. | `AGENTS.md` rule 7. |

### 2.2 Doctrine changes to absorb

| # | Then | Now | Software Teams impact |
|---|------|-----|-----------------------|
| D1 | Give Claude rules | Let Claude use judgement | 33 specs are dense with `CRITICAL:` blocks, numbered pre-approval ceremonies, and "never do X" guardrails written for 4.x-era models. |
| D2 | Give Claude examples | Design interfaces | Specs teach by example; should instead expose expressive structured-return shapes and let the model choose. |
| D3 | Put it all upfront | Progressive disclosure | Verification and review should be skills loaded on demand, not spec preamble. Software Teams' bespoke `@ST:` component system is a hand-rolled version of this; skills + supporting files are the native form. |
| D4 | Repeat yourself | Say it once, in the right place | Rules are restated across `AGENTS-MODELS.md`, each spec's preamble, `RULES.md`, and each command's strictness block. |
| D5 | Memory in CLAUDE.md | Auto memory | Claude now writes its own per-repo memory, and subagents can have their own via `memory: project`. Software Teams' feedback-learner → `.software-teams/rules/` loop partly duplicates this. |
| D6 | Simple specs | Rich references | A spec can be a test suite, a rubric, an HTML artifact, or real code, not just markdown. |

### 2.3 Native features Software Teams should adopt or defer to

- **Skills have absorbed commands.** `.claude/commands/*.md` still works, but skills are the
  supported path and win on name collision. Skills add: supporting-file directories,
  `disable-model-invocation`, `user-invocable`, `context: fork` + `agent:`, `model:`,
  `effort:`, `paths:`, `hooks:`, `arguments:`, `allowed-tools`/`disallowed-tools`.
- **`.claude/rules/` with `paths:` frontmatter.** Path-scoped instruction files that load
  only when Claude touches matching files - and they reach subagents, because subagents
  receive the whole CLAUDE.md hierarchy including project rules.
- **Subagent frontmatter now supports** `effort`, `memory` (`user`/`project`/`local`),
  `isolation: worktree`, `skills` (preload), `maxTurns`, `permissionMode`,
  `disallowedTools`, `mcpServers`, `background`, `color`, `initialPrompt`.
  Plugin-shipped agents may use all of these except `hooks`, `mcpServers`,
  `permissionMode`.
- **Effort is a second dial.** `low|medium|high|xhigh|max` (+ `ultracode`). Model =
  how capable; effort = how thorough. Guidance is to stay on the default and reach for
  the dial deliberately.
- **Fable 5** is for work "larger than a single sitting", verifies itself with less
  prompting, and explicitly does not want verification reminders.
- **Bundled skills already cover** `/verify`, `/code-review`, `/doctor`, `/debug`,
  `/loop`, `/batch`, `/run`, `/run-skill-generator`, `/deep-research`.
- **Native isolation**: `--worktree`, `isolation: worktree`, `EnterWorktree`/`ExitWorktree`,
  plus `WorktreeCreate`/`WorktreeRemove` hooks.
- **Headless flags that matter for n8n**: `--agents <json>`, `--agent <name>`,
  `--json-schema`, `--output-format json`, `--max-budget-usd`, `--max-turns`,
  `--fallback-model`, `--session-id <uuid>`, `--resume`, `--bare`, `--setting-sources`,
  `--strict-mcp-config`, `--tools` (restrict, unlike `--allowedTools` which only
  auto-approves), `--permission-mode dontAsk`, `--exclude-dynamic-system-prompt-sections`,
  `--append-subagent-system-prompt`, `--forward-subagent-text`, `--include-hook-events`.

### 2.4 Empirically verified on 2.1.220 (probes run against the local binary)

- `--agents '<json>' --agent <name>` correctly replaces the session system prompt. Probe
  agent answered with its pinned persona string.
- `--output-format json --json-schema '<schema>'` returns a validated `structured_output`
  object alongside `total_cost_usd`, `modelUsage`, `session_id`, `num_turns`,
  `permission_denials`, `stop_reason`. **This is the single biggest unlock for the n8n
  contract.**
- `--bare` does not read OAuth credentials; it needs `ANTHROPIC_API_KEY`.
- The legacy `context: |` + `!cmd` frontmatter block in Software Teams' commands **still
  injects** on 2.1.220. It is undocumented and now collides with `context: fork`, so it
  should be migrated to the documented inline `` !`command` `` form, but it is not
  currently broken.

---

## 3. Slices

Ordered by dependency, then by value to the production support-ticket goal. Each slice is
one PR, independently shippable and verifiable. Merging to `main` publishes to npm when
the version changes (`AGENTS.md` rule 6), so version bumps are deliberate and per-slice.

### Slice 0 - Remove deprecated packages `[SHIPPED - PR #23]`

Dropped `packages/team-engine`, `apps/electron`, the `apps/*` workspace glob, and
`cockpit-release.yml`. Repo is now two packages. No version bump, so no publish.

---

### Slice 1 - Harness truth-up

**Goal:** fix everything in §2.1 so the framework does what it says. No architecture
change, no behavioural redesign. This is the highest value-to-risk slice and it unblocks
the rest.

- B1: `Task` → `Agent` in all `allowed-tools` and all body prose across `agents/` and
  `commands/`. Audit `src/` for the same string.
- B2: n8n passes `--model` explicitly through `spawnClaude`; delete the
  `ANTHROPIC_DEFAULT_MODEL` write and the `process.env` mutation. Pass model per
  invocation instead of via ambient env.
- B3: replace every pinned model ID with the Claude 5 generation. Default the profiles to
  **aliases** (`opus`/`sonnet`/`haiku`/`fable`) so they track Anthropic's recommended
  version instead of rotting again; keep full IDs available for anyone who needs a pin.
- B4: rewrite `templates/.claude/settings.json` to use `permissions.allow`; drop
  `MultiEdit` and `Task`; re-derive the allow list from real tool names.
- B5: rewrite the `AGENTS-MODELS.md` tool-allowlist policy against the real tool
  reference; remove `AskUserQuestion` from subagent role classes and note that the
  harness strips it.
- **New CI gate:** validate every agent and skill frontmatter `tools`/`disallowedTools`
  entry against a checked-in list of real Claude Code tool names, and every `model` value
  against the known alias/ID set. This is what stops §2.1 recurring. Add it as a job in
  `ci.yml` next to `component-validate`.

**Verify:** all five gates green, plus the new frontmatter gate failing on a seeded bad
value. Bundle rebuilt and committed with the version bump (rule 5).

---

### Slice 2 - Model and effort policy

**Goal:** make effort a first-class dial and stop treating model choice as the only knob.

- Add `effort` to the `models:` profile schema in `config.yaml` and to the resolved
  `.claude/agents/*.md` frontmatter written by `sync-agents`.
- Re-tier the profiles on the model-vs-effort framing: capability where the problem is
  genuinely hard, effort where the failure mode is "didn't try hard enough". Introduce a
  `fable` tier for the long-autonomous roles (planner, architect, producer) and document
  that Fable specs should **drop** verification reminders rather than add them.
- Thread `--effort` through the n8n execution path and expose it on the Agent node.
- Reconcile the profile-overrides-frontmatter precedence documented in
  `AGENTS-MODELS.md` with the harness's own resolution order
  (`CLAUDE_CODE_SUBAGENT_MODEL` → per-invocation → frontmatter → session).

**Verify:** gates green; `sync-agents` snapshot tests cover effort resolution; a probe run
confirms `--effort` reaches the CLI.

---

### Slice 3 - Commands become skills

**Goal:** move the 21 command files onto the supported extension point and use the
frontmatter that only skills have.

- Convert `commands/<name>.md` → `skills/<name>/SKILL.md`; update the plugin manifest,
  `init`, and `sync-framework` writers, and the `files` array in `package.json`.
- Migrate the legacy `context: |` blocks to inline `` !`command` `` so `context:` is free
  for `fork`.
- Apply `disable-model-invocation: true` to everything with side effects
  (`commit`, `generate-pr`, `worktree*`, `statusline`, `orchestrator-mode`) so Claude
  cannot fire them on its own.
- Use `context: fork` + `agent:` where a command's whole job is to run one specialist in
  isolation, replacing hand-written delegation prose.
- **Retire native duplicates:** `/st:verify` against bundled `/verify` (likely becomes a
  recorded `.claude/skills/verify/` recipe instead of a bespoke gate runner);
  `/st:pr-review` against bundled `/code-review` + the `ReportFindings` tool.
- Keep supporting material in the skill directory rather than in `commands/_shared/`,
  referenced from `SKILL.md` so it loads on demand.

**Verify:** gates green; bundle smoke test still runs `init` end to end; a probe session
confirms each skill is discoverable and that the side-effecting ones refuse model
invocation.

---

### Slice 4 - Rules move to `.claude/rules/`

**Goal:** delete the bespoke rules layer in favour of the native one.

- Move `rules/*.md` to path-scoped `.claude/rules/*.md` with `paths:` frontmatter
  (`backend.md` → server globs, `frontend.md` → component globs, and so on) so they load
  only when relevant.
- Delete the "**Rules**: Read `.software-teams/rules/general.md` and ..." preamble from all
  33 specs. Subagents already receive the CLAUDE.md hierarchy including project rules, so
  the instruction is both redundant and a per-spawn token cost.
- Repoint `feedback-learner` at `.claude/rules/` and reconcile its dedupe logic with auto
  memory, so the two learning loops do not fight. Decide explicitly which learnings belong
  in committed rules (team conventions) versus auto memory (machine-local discoveries).
- Update `templates/CLAUDE-SHARED.md` and the generated CLAUDE.md routing block against
  the memory docs: under 200 lines, gotchas over derivable facts, `@AGENTS.md` import
  pattern for repos that keep an AGENTS.md.

**Verify:** gates green; a probe confirms a path-scoped rule loads on touching a matching
file and does not load otherwise.

---

### Slice 5 - Agent spec debloat

**Goal:** rewrite the 33 specs for Claude 5. This is the largest prose change and the one
most likely to reduce per-spawn cost.

- Strip `CRITICAL:` shouting, the numbered Pre-Approval Workflow ceremony, the
  "Match the Codebase" boilerplate now covered by the harness's own system prompt, and
  duplicated deviation rules.
- Replace teaching-by-example with expressive structured-return interfaces.
- Push multi-step procedures out of specs into skills, and preload them with the
  `skills:` frontmatter field where a specialist always needs one.
- Adopt `memory: project` for the specialists that benefit from accumulating codebase
  knowledge (codebase-mapper, debugger, qa-tester, security), and `maxTurns` where a role
  should be bounded.
- **Decision needed (Q3):** the 8 `game-*` specialists are a quarter of the surface and
  irrelevant to the support-ticket use case. Delete, or keep and debloat with the rest.
- Repair or delete the component-cost benchmark (`AGENTS.md` rule 7) so this slice can be
  measured rather than asserted. A slice that claims a context saving without a working
  measurement is not verifiable.

**Verify:** gates green; before/after per-spawn token measurement on a working benchmark;
behavioural spot-check that a debloated specialist still produces the same artefacts.

---

### Slice 6 - Defer to native orchestration

**Goal:** delete Software Teams code that the harness now does better. Expect this slice
to be mostly removal.

- Worktrees: replace the bespoke `worktree` / `worktree-merge` / `worktree-remove`
  commands and the `SoftwareTeamsWorktreeCleanup` hook with `isolation: worktree` on the
  specs that need it, `--worktree` for sessions, and `WorktreeCreate`/`WorktreeRemove`
  hooks for the project-specific setup steps that genuinely have no native equivalent
  (database seeding, env files).
- Agent teams: evaluate `--team` and `AgentTeamsOrchestration` against native agent teams
  and `SendMessage`. Keep only the parts that add something native lacks.
- Workflows: evaluate `compile-workflow` against native dynamic workflows, `/workflows`,
  and `--effort ultracode`. The native `Workflow` tool is stripped from subagents, which
  constrains where compiled workflows can run - confirm before keeping.
- `@ST:` component system: assess against skills plus supporting files. If skills cover
  it, the registry, resolver, validator, and the `component-validate` CI job all go.

**Verify:** gates green; each removal accompanied by a probe demonstrating the native
replacement does the job.

---

### Slice 7 - n8n execution engine v2

**Goal:** make the n8n path production-grade. This is the prerequisite for trusting it
with real support tickets.

- **Agent identity via `--agents` JSON + `--agent <name>`** instead of reading the spec
  file, stripping frontmatter, and concatenating the body into the user prompt. This gives
  the agent its real system prompt, tool restrictions, model, and effort, and removes the
  fragile three-candidate `resolveAgentSpecPath` lookup.
- **Typed output via `--output-format json --json-schema`.** Replaces the
  `NEEDS_INPUT:` regex and the "last assistant text wins" stream heuristic with a schema
  the envelope is parsed from. Bump `NodeEnvelope` to v2 to carry the structured result.
- **Cost and turn caps:** `--max-budget-usd`, `--max-turns`, `--fallback-model`. Surface
  `total_cost_usd` and `modelUsage` on the envelope so an n8n workflow can budget and
  report per ticket.
- **Real multi-turn:** `--session-id <uuid>` derived from `correlationId`, plus `--resume`,
  so HITL resumption continues a conversation instead of replaying a fresh one.
- **Determinism on shared workers:** `--setting-sources`, `--strict-mcp-config`, and
  `--exclude-dynamic-system-prompt-sections` for prompt-cache reuse across executions.
  `--bare` where the credential supplies `ANTHROPIC_API_KEY` (**Q4**).
- **Actual tool restriction** with `--tools`; today `--allowedTools` only auto-approves and
  restricts nothing.
- **Lifecycle correctness:** handle SIGTERM/exit 143, surface `system/api_retry`, and
  respect the background-agent wait ceiling.
- Optional per-agent `mcpServers` so a specialist can reach ClickUp or Slack without those
  tool descriptions costing context in every other node.

**Verify:** gates green including `verify:node-load` under Node; new tests for schema
parsing, budget cap, and resume; an end-to-end run against a real self-hosted n8n worker
before this is called done.

---

### Slice 8 - The support-ticket path

**Goal:** the actual production objective. Today's nodes are shaped for a dev flow
(plan → implement → PR); support work is triage → diagnose → answer or fix → escalate.

- A support triage specialist and a reference n8n workflow: ingest ticket → classify
  (question / bug / change request / escalation) → route → act → HITL → close or hand off.
- **Decision needed (Q1):** whether to add a generic "Claude Code" node (arbitrary prompt,
  agent, tools, schema; envelope in and out) alongside the specialist nodes, so workflows
  can be composed without shipping a new node per role. This is the second option Ben
  raised and it changes the node surface materially.
- **Decision needed (Q5):** ticket source. The repo already has ClickUp utilities; confirm
  whether that is the real source and what the payload looks like.
- Guardrails suited to unattended support work: budget cap per ticket, read-only-by-default
  tools with explicit escalation, `permissionMode: dontAsk`, and an audit trail of what
  each agent did.

**Verify:** gates green; a live run against real (or realistically shaped) tickets on the
self-hosted instance, reviewed before enabling for customers.

---

### Slice 9 - Documentation and release

- `README.md`, `packages/n8n/CONTRACT.md`, `packages/n8n/ARCHITECTURE.md` (new ADRs for the
  execution-engine rewrite and the contract bump), `agents/AGENTS-MODELS.md`,
  `templates/CLAUDE-SHARED.md`, `templates/RULES.md`.
- Migration notes for anyone on `0.13.x`: commands → skills, rules relocation, contract v2.
- Version bump and publish. Both packages are public and the publish is irreversible.

---

## 4. Sequencing notes

- **1 → 2 → 3/4 → 5 → 6** is a hard chain on the CLI side: truth-up before policy, policy
  before conversion, conversion before debloat, debloat before deletion.
- **7 depends on 1 and 2** (real model and effort plumbing) but not on 3-6. It can run in
  parallel with the CLI prose work if that is the faster route to production.
- **8 depends on 7.** Do not put real tickets through the current execution path; it has no
  budget cap, no typed output, and no working model selection.
- **9 last**, or the docs describe a moving target.

If the goal is "support tickets in production soonest", the shortest credible path is
**1 → 2 → 7 → 8**, with 3-6 and 9 following. That is a legitimate reordering and worth
choosing deliberately.

---

## 5. Open questions

| # | Question | Why it changes the work |
|---|----------|-------------------------|
| Q1 | Generic "Claude Code" node in addition to the specialist nodes, or instead of them? | Materially changes the Slice 8 node surface and whether the 33-specialist palette stays. |
| Q2 | Is a breaking release acceptable (`0.14.0` or `1.0.0`), or do existing installs need back-compat shims? | Contract v2 and commands → skills are both breaking. Shims roughly double slices 3 and 7. |
| Q3 | Keep or delete the 8 `game-*` specialists? | A quarter of the agent surface, irrelevant to support tickets. |
| Q4 | On the n8n worker: `ANTHROPIC_API_KEY`, or subscription OAuth? | `--bare` needs an API key. Determines whether deterministic bare-mode runs are available. |
| Q5 | Where do support tickets actually come from - ClickUp, Zendesk, Slack, email? And what should an agent be allowed to do unattended? | Shapes Slice 8's ingestion, and the guardrails. |
