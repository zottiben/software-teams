# Software Teams - modernisation plan (Claude 5 / Claude Code 2.1.x)

> **Status:** slice 0 shipped. Slices 1-9 not started.
> **Owner:** Ben. **Target:** Software Teams n8n nodes running production support tickets
> from ClickUp, billed against a Claude subscription rather than an API key.
> **Baseline:** repo at `0.13.0`; researched against Claude Code `2.1.220` and the
> Claude 5 model generation (Opus 5 / Sonnet 5 / Fable 5 / Haiku 4.5).
> **Verification standard:** every slice must leave `bun run typecheck`, `bun run lint`,
> `bun run test`, `bun run build`, and `bun run verify:node-load` green. Green tests alone
> are not proof (see `AGENTS.md` rule 1).

---

## 1. Why this exists

Software Teams was built against the Claude 4.x generation and an older Claude Code
harness. Three things have since changed:

1. **The harness grew native versions of things Software Teams hand-rolled.** Skills,
   `.claude/rules/` with path scoping, auto memory, subagent `memory:`/`effort:`/
   `isolation: worktree`/`skills:`, agent teams, dynamic workflows, `--agents` JSON,
   `--json-schema`, `--max-budget-usd`. Several Software Teams subsystems now duplicate
   harness features, at a context cost and a maintenance cost.
2. **The prompting doctrine inverted.** Anthropic's
   [new rules of context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)
   replaced "give Claude rules, examples, and repetition, all upfront" with "let Claude
   use judgement, design interfaces, use progressive disclosure, don't repeat yourself."
   Software Teams' 33 agent specs are written almost entirely in the old style.
3. **A set of things are silently broken.** They typecheck, lint, and pass tests, but do
   nothing (or the wrong thing) at runtime. Those come first.

---

## 2. Decisions (locked)

| # | Decision | Consequence |
|---|----------|-------------|
| **D-1** | **Subscription OAuth, not API key.** Using a Claude Code instance per node exists precisely so billing draws on the subscription. | Auth is `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, injected from an n8n credential. This is verified working in a clean container, not assumed. The one casualty is the `--bare` *flag*, which ignores the token; OAuth itself is unaffected. `ANTHROPIC_API_KEY` must be *actively kept out* of the spawn env. See §4. |
| **D-2** | **Breaking release is acceptable.** Nobody is on the project yet. | No back-compat shims. Contract v2 and commands → skills land clean. Target `1.0.0`. |
| **D-3** | **Keep the 8 `game-*` specialists, out of scope for this work.** | They get the mechanical fixes in slice 1 (tool names, model IDs) but are excluded from the spec-debloat pass. Revisit later. |
| **D-4** | **Ticket source is ClickUp.** Manual feed first; auto-pickup on a ClickUp tag is the end goal. | Slice 4 builds manual-input first and the tag trigger second, behind the same ingestion boundary. |
| **D-5** | **Production support tickets are the priority**, so the n8n path is sequenced ahead of the CLI prose work. | Order is `1 → 2 → 3 → 4`, then `5 → 8`, then `9`. |
| **D-6** | **Do not bump the version on intermediate slices.** | Merging to `main` publishes only when the version changes (rule 6), so leaving it at `0.13.0` means slices 1-8 can merge safely without shipping a half-migrated framework to npm. One deliberate bump to `1.0.0` in slice 9 publishes the finished result. The tracked `dist/index.js` is still rebuilt and committed per slice so the plugin path stays working. |

---

## 3. Research findings (the evidence base)

### 3.1 Confirmed broken today

| # | Finding | Evidence |
|---|---------|----------|
| B1 | **The `Task` tool does not exist.** It is `Agent`. 8 command files list `Task` in `allowed-tools` (grants nothing) and ~20 agent/command bodies instruct Claude to call `Task subagent_type=<name>`, teaching a nonexistent tool. | Live tool enumeration on 2.1.220 returns `Agent, Bash, Edit, Read, ReportFindings, Skill, ToolSearch, Workflow, Write, Cron*, EnterWorktree, ExitWorktree, NotebookEdit, ScheduleWakeup, SendMessage, Task{Create,Get,List,Output,Stop,Update}, WebFetch, WebSearch`. No `Task`. |
| B2 | **n8n model selection is a no-op.** `SoftwareTeamsAgent.node.ts:183` sets `process.env['ANTHROPIC_DEFAULT_MODEL']`, which is not a Claude Code env var, and `single-turn.ts` never passes `--model`. It also mutates shared worker `process.env`, leaking across executions. | `grep -c ANTHROPIC_DEFAULT_MODEL` on the env-vars reference returns `0`. Valid vars are `ANTHROPIC_MODEL` and `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`. |
| B3 | **Every pinned model ID is stale.** `config/config.yaml` profiles use `claude-opus-4-8` / `claude-opus-4-6` / `claude-sonnet-4-6`; the n8n picker offers `claude-sonnet-4-5`, `claude-opus-4-5` (not a real ID, labelled "Claude Opus 4"), `claude-haiku-3-5`. | Current: `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-haiku-4-5`; aliases `opus`/`sonnet`/`haiku`/`fable`/`best`. |
| B4 | **`templates/.claude/settings.json` pre-approvals never apply.** There is no top-level `allowedTools` settings key; the correct key is `permissions.allow`. The block is silently ignored (verified: no warning, session runs fine). It also lists `MultiEdit` and `Task`, neither of which exists. | Settings reference has no `allowedTools`. Probe with the template in place: session succeeded, `claude --debug` emitted no settings warning, so the key is dropped rather than rejected. |
| B5 | **`skills/st-support/AGENTS-MODELS.md` tool policy names tools subagents cannot have.** It lists `Task` (gone) and `AskUserQuestion`, which the harness strips from *every* subagent unconditionally. | Subagents doc: `AskUserQuestion` is in the always-removed filter list. |
| B6 | **The component-cost benchmark and its CI gate are inert.** Pre-existing and already documented. | `AGENTS.md` rule 7. |
| B7 | **The n8n credential forces API billing.** `SoftwareTeamsApi` marks `anthropicApiKey` as `required: true` and injects it as `ANTHROPIC_API_KEY`. Under D-1 this is exactly wrong: `ANTHROPIC_API_KEY` outranks `CLAUDE_CODE_OAUTH_TOKEN` in the auth precedence order, and in `-p` mode "the key is always used when present". | Auth precedence: cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → `/login` credentials. |

### 3.2 Doctrine changes to absorb

| # | Then | Now | Software Teams impact |
|---|------|-----|-----------------------|
| D1 | Give Claude rules | Let Claude use judgement | 33 specs are dense with `CRITICAL:` blocks, numbered pre-approval ceremonies, and "never do X" guardrails written for 4.x-era models. |
| D2 | Give Claude examples | Design interfaces | Specs teach by example; should instead expose expressive structured-return shapes and let the model choose. |
| D3 | Put it all upfront | Progressive disclosure | Verification and review should be skills loaded on demand, not spec preamble. Software Teams' bespoke `@ST:` component system is a hand-rolled version of this; skills + supporting files are the native form. |
| D4 | Repeat yourself | Say it once, in the right place | Rules are restated across `skills/st-support/AGENTS-MODELS.md`, each spec's preamble, `RULES.md`, and each command's strictness block. |
| D5 | Memory in CLAUDE.md | Auto memory | Claude now writes its own per-repo memory, and subagents can have their own via `memory: project`. The feedback-learner → `.software-teams/rules/` loop partly duplicates this. |
| D6 | Simple specs | Rich references | A spec can be a test suite, a rubric, an HTML artifact, or real code, not just markdown. |

### 3.3 Native features to adopt or defer to

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
  how capable; effort = how thorough. Guidance is to stay on the default and reach for the
  dial deliberately.
- **Fable 5** is for work "larger than a single sitting", verifies itself with less
  prompting, and explicitly does not want verification reminders.
- **Bundled skills already cover** `/verify`, `/code-review`, `/doctor`, `/debug`,
  `/loop`, `/batch`, `/run`, `/run-skill-generator`, `/deep-research`.
- **Native isolation**: `--worktree`, `isolation: worktree`, `EnterWorktree`/`ExitWorktree`,
  plus `WorktreeCreate`/`WorktreeRemove` hooks.
- **Headless flags that matter for n8n**: `--agents <json>`, `--agent <name>`,
  `--json-schema`, `--output-format json`, `--max-budget-usd`, `--max-turns`,
  `--fallback-model`, `--session-id <uuid>`, `--resume`, `--setting-sources`,
  `--strict-mcp-config`, `--tools` (restrict, unlike `--allowedTools` which only
  auto-approves), `--permission-mode dontAsk`, `--exclude-dynamic-system-prompt-sections`,
  `--append-subagent-system-prompt`, `--forward-subagent-text`, `--include-hook-events`.
  **Not `--bare`** - see §4.

### 3.4 Empirically verified on 2.1.220 (probes run against the local binary)

- `--agents '<json>' --agent <name>` correctly replaces the session system prompt. Probe
  agent answered with its pinned persona string.
- `--output-format json --json-schema '<schema>'` returns a validated `structured_output`
  object alongside `total_cost_usd`, `modelUsage`, `session_id`, `num_turns`,
  `permission_denials`, `stop_reason`. **This is the single biggest unlock for the n8n
  contract.**
- `--bare` refuses to run without an API key ("Not logged in · Please run /login") even
  with a valid subscription login present, consistent with the documented behaviour.
- `CLAUDE_CODE_OAUTH_TOKEN` is a working headless credential source in a clean container;
  `claude auth status` reports `authMethod: "oauth_token"`. See §4 for the full matrix.
- The legacy `context: |` + `!cmd` frontmatter block in Software Teams' commands **still
  injects** on 2.1.220. It is undocumented and now collides with `context: fork`, so it
  should be migrated to the documented inline `` !`command` `` form, but it is not
  currently broken.

---

## 4. The auth constraint (drives the whole n8n design)

Decision D-1 makes authentication the defining constraint, so it is worth stating exactly.

**How it must work.** Run `claude setup-token` once against the subscription account. It
opens the normal browser authorisation flow and prints a **one-year OAuth token**, which it
does not persist anywhere. That token goes into the n8n credential and is injected as
`CLAUDE_CODE_OAUTH_TOKEN` on the spawned process. It requires a Pro, Max, Team, or
Enterprise plan.

**This is verified, not assumed.** Probed in a clean `node:22-slim` container - no
keychain, no credentials file, nothing but the env var, which is exactly the n8n worker
shape:

| Invocation | `CLAUDE_CODE_OAUTH_TOKEN` | Result |
|------------|---------------------------|--------|
| `claude auth status` | unset | `{"loggedIn": false, "authMethod": "none"}` |
| `claude -p` | unset | `Not logged in · Please run /login` |
| `claude auth status` | set | `{"loggedIn": true, "authMethod": "oauth_token"}` |
| `claude -p` | set | reaches the API; returned 401 only because the probe value was deliberately fake |
| `claude --bare -p` | set | `Not logged in` - the flag ignores the token |

So an env var injected from an n8n secret is a first-class credential source for headless
Claude Code. `claude auth status` emits JSON, which also gives the credential test in
slice 3 something precise to assert.

The container install is a one-liner, so the worker image needs only:
`curl -fsSL https://claude.ai/install.sh | bash` (installs to `~/.local/bin/claude`).

**What it can and cannot do.** The token can only make model requests. It cannot establish
Remote Control sessions or fetch claude.ai connectors. Locally configured MCP servers still
work, so per-agent `mcpServers` remains available.

**Three hard consequences for the code:**

1. **The `--bare` flag is unusable** - and only that flag. Bare mode skips credential
   discovery along with hooks, skills, plugins, MCP, and CLAUDE.md, so it needs an API key.
   Nothing else about OAuth is affected. Determinism on shared workers therefore comes from
   `--setting-sources`, `--strict-mcp-config`, `--tools`, inline `--settings` JSON, and
   `--exclude-dynamic-system-prompt-sections` instead.
2. **`ANTHROPIC_API_KEY` must be actively excluded from the spawn env.** It outranks the
   OAuth token, and in `-p` mode it is always used when present. If it leaks in from the
   worker's own environment, every ticket silently bills the API instead of the
   subscription. The spawn must build its env explicitly rather than spreading
   `process.env`, and should assert the key's absence.
3. **The credential's `anthropicApiKey` stops being required** and becomes an optional
   fallback for anyone who does want API billing, with the mode chosen explicitly rather
   than by which secret happens to be set.

**The risk to design around: one token is one seat's allowance.** Subscription usage draws
on a rolling five-hour window and a weekly window, shared across models, and a support
queue is exactly the workload that exhausts them. Hitting the limit mid-ticket surfaces as
"You've hit your session limit" / "You've hit your weekly limit"; switching model does not
restore access. So slice 3 must treat limit exhaustion as a first-class outcome:
detect it, emit a distinct envelope status rather than a generic error, and let the
workflow park and retry the ticket after the reset rather than failing it. Usage credits
and an API-key fallback are the two escape valves, and both should be a deliberate switch.

One point in subscription's favour: prompt cache lifetime is **one hour** on a subscription
versus five minutes on an API key, which suits bursty ticket work and makes
`--exclude-dynamic-system-prompt-sections` more valuable for cache reuse across executions.

---

## 5. Slices

Ordered per D-5: n8n production path first, CLI prose work after. Each slice is one PR,
independently shippable and verifiable. Merging to `main` publishes to npm when the version
changes (`AGENTS.md` rule 6), so version bumps are deliberate and per-slice.

### Slice 0 - Remove deprecated packages `[SHIPPED - PR #23]`

Dropped `packages/team-engine`, `apps/electron`, the `apps/*` workspace glob, and
`cockpit-release.yml`. Repo is now two packages. No version bump, so no publish.

---

### Slice 1 - Harness truth-up `[SHIPPED]`

**Goal:** fix everything in §3.1 so the framework does what it says. No architecture change,
no behavioural redesign. Highest value-to-risk slice, and it unblocks the rest.

**What the sweep actually found.** The initial grep for tool-usage phrasings caught 12
sites. Running the built bundle end to end and grepping the *generated* project caught
another 30-odd that the source grep had missed, because the text was injected from a
component (`AgentBase.ts`), a router prompt, or a hook's user-facing error message rather
than living in the spec files. Three of them were error strings telling a user to
"delegate to a specialist via the Task tool". Lesson worth keeping: for a payload-driven
framework, grep the generated output, not just the sources.

Two further defects surfaced during the work and were fixed in the same slice:

- **The Orchestrator node had the same dead model wiring as the Agent node**, and its
  `model` parameter turned out to be entirely unreferenced once the dead env-var write was
  removed - it had never reached the CLI at all. Both nodes now share one model list from
  `shared/claude-code-surface.ts` so they cannot drift again.
- **The AC2 no-nested-spawn test was vacuous.** It asserted that
  `SINGLE_TURN_ALLOWED_TOOLS` omits `"Task"` - a tool that does not exist, so the
  assertion could never fail. Worse, `--allowedTools` only waives the permission prompt;
  it does not remove a tool. Enforcement now goes through `--disallowedTools Agent`, and
  the test asserts that.

- B1: `Task` → `Agent` in all `allowed-tools` and all body prose across `agents/` and
  `commands/`. Audit `src/` for the same string.
- B2: n8n passes `--model` explicitly through `spawnClaude`; delete the
  `ANTHROPIC_DEFAULT_MODEL` write and the `process.env` mutation.
- B3: replace every pinned model ID with the Claude 5 generation. Default the profiles to
  **aliases** (`opus`/`sonnet`/`haiku`/`fable`) so they track Anthropic's recommended
  version instead of rotting again; keep full IDs available for anyone who needs a pin.
- B4: rewrite `templates/.claude/settings.json` to use `permissions.allow`; drop
  `MultiEdit` and `Task`; re-derive the allow list from real tool names.
- B5: rewrite the `skills/st-support/AGENTS-MODELS.md` tool-allowlist policy against the real tool reference;
  remove `AskUserQuestion` from subagent role classes and note that the harness strips it.
- **New CI gate:** validate every agent and skill frontmatter `tools`/`disallowedTools`
  entry against a checked-in list of real Claude Code tool names, and every `model` value
  against the known alias/ID set. This is what stops §3.1 recurring. Add it as a job in
  `ci.yml` next to `component-validate`.

Applies to the `game-*` specs too - mechanical only, per D-3.

**Verify:** all five gates green, plus the new frontmatter gate failing on a seeded bad
value. Bundle rebuilt and committed with the version bump (rule 5).

---

### Slice 2 - Model and effort policy `[SHIPPED]`

**Goal:** make effort a first-class dial and stop treating model choice as the only knob.

**The design call worth recording: effort is sparse, not universal.** The obvious
implementation is an effort value for all 33 agents in every profile. That is wrong.
Anthropic's guidance is to stay on the model's default effort for most work and treat the
dial as a deliberate override, so pinning it everywhere would override the default
everywhere and defeat the point. An agent appears in a profile's `effort:` map only where
there is a stated reason - raised where the failure mode is "stopped too early"
(debugger, security, qa-tester, plan-checker, verifier), lowered where the work is
mechanical (committer, pr-generator, feedback-learner). Everything else emits no `effort:`
key at all. A test enforces the sparseness so a future maintainer cannot quietly
pre-populate it.

**Two things found while building it:**

- **`debugger` was on `haiku` in two profiles.** Root-cause analysis on a subtle bug is
  the canonical "pick a larger model" case: no amount of effort rescues a model that is
  confidently wrong. Raised to `sonnet` everywhere, and it now carries the highest effort
  of any role. Same argument that had already moved `qa-tester` off `haiku`.
- **Only one of three `convertAgents` call sites was wired.** `sync-agents` got effort;
  `init` and `sync-framework` did not, so a freshly initialised project got models but no
  effort - and every unit test still passed, because they pass the options directly. Found
  by running the built bundle's `init` and inspecting the generated specs. There is now a
  source-level guard test for it.

**Verified end to end:** `--effort` reaches the CLI; the valid set is exactly
`low|medium|high|xhigh|max` (an unknown value only *warns* and silently falls back, which
is why the slice-1 gate checks it); `effort:` frontmatter is accepted on a file-based
subagent; and a generated `software-teams-committer` (`model: haiku`, `effort: low`)
spawns and responds.

- Add `effort` to the `models:` profile schema in `config.yaml` and to the resolved
  `.claude/agents/*.md` frontmatter written by `sync-agents`.
- Re-tier the profiles on the model-vs-effort framing: capability where the problem is
  genuinely hard, effort where the failure mode is "didn't try hard enough". Introduce a
  `fable` tier for the long-autonomous roles (planner, architect, producer) and document
  that Fable specs should **drop** verification reminders rather than add them.
- Thread `--effort` through the n8n execution path and expose it on the Agent node.
- Reconcile the profile-overrides-frontmatter precedence documented in `skills/st-support/AGENTS-MODELS.md`
  with the harness's own resolution order (`CLAUDE_CODE_SUBAGENT_MODEL` → per-invocation →
  frontmatter → session).

**Verify:** gates green; `sync-agents` snapshot tests cover effort resolution; a probe run
confirms `--effort` reaches the CLI.

---

### Slice 3 - n8n: subscription auth + execution engine v2 `[SHIPPED]`

**Goal:** make the n8n path production-grade on subscription billing. Prerequisite for
trusting it with real tickets. Read §4 before starting.

**The find that shaped the slice: `--json-schema` fails silently under tool restriction.**
Structured output is delivered by a tool named `StructuredOutput`, injected into the
session by `--json-schema`. An agent that restricts its `tools` list and omits that name
gets the tool filtered out, cannot emit the object, and returns `structured_output: null` -
with no error, no warning, and an otherwise successful run. Since this slice wanted both
tool restriction (for safety) and typed envelopes, the two would have quietly cancelled
out. Every agent definition the engine builds now appends the tool, and the shared surface
documents it.

**Verified live, not asserted:**

- A specialist spawned through `--agents` + `--agent` behaves as its spec, returns a typed
  `needs-input` from the schema, and reports `usage` (cost, turns, models, terminalReason)
  and a resumable `sessionId`.
- Resume works: turn 2 recalled a reference given in turn 1.
- **Auth, proven in a clean `node:22-slim` container** - no keychain, no credentials file,
  which is the worker shape. With a stray `ANTHROPIC_API_KEY` in the parent environment and
  a deliberately invalid OAuth token, the run failed with `401 OAuth access token is
  invalid`: the key was stripped and the OAuth token was genuinely the credential used, and
  the failure classified as `error` rather than `retry-later`. **A developer machine cannot
  verify this** - a local keychain login masks the result, and my first attempt on macOS
  wrongly reported success.
- Terminal signals read from real runs: budget cap is `subtype: error_max_budget_usd` /
  `terminal_reason: budget_exhausted`; turn cap is `error_max_turns` / `max_turns`. The
  budget cap is enforced *between* turns, so a run overshoots it - a $0.0001 cap spent
  $0.085. It is a brake, not a guarantee, and the node parameter says so.

**Deferred to slice 4:** per-agent `mcpServers` (lands with ClickUp, where it has a
concrete use), and `--fallback-model` is plumbed but not yet surfaced as a node parameter.

**Auth first (B7, D-1):**
- Credential gains `claudeCodeOauthToken`; `anthropicApiKey` becomes optional. An explicit
  `authMode` picks between them rather than inferring from which secret is populated.
- The spawn builds its environment explicitly and **asserts `ANTHROPIC_API_KEY` is absent**
  in subscription mode, so a worker-level key cannot silently divert billing.
- Credential test replaced: the current test hits `api.anthropic.com/v1/models` with
  `x-api-key`, which cannot validate an OAuth token. Replace with `claude auth status`,
  which emits `{"loggedIn", "authMethod", "apiProvider"}` as JSON - so the test can assert
  `authMethod: "oauth_token"` specifically, catching the case where a stray
  `ANTHROPIC_API_KEY` has silently taken over. It also verifies the binary is on PATH.
- Usage-limit exhaustion becomes a distinct envelope status, not a generic error, so a
  workflow can park and retry after the window resets.

**Then the engine:**
- **Agent identity via `--agents` JSON + `--agent <name>`** instead of reading the spec
  file, stripping frontmatter, and concatenating the body into the user prompt. This gives
  the agent its real system prompt, tool restrictions, model, and effort, and removes the
  fragile three-candidate `resolveAgentSpecPath` lookup.
- **Typed output via `--output-format json --json-schema`.** Replaces the `NEEDS_INPUT:`
  regex and the "last assistant text wins" stream heuristic with a schema the envelope is
  parsed from. Bump `NodeEnvelope` to v2 to carry the structured result.
- **Cost and turn caps:** `--max-budget-usd`, `--max-turns`, `--fallback-model`. Surface
  `total_cost_usd` and `modelUsage` on the envelope for per-ticket reporting. Note these
  are client-side estimates and, on a subscription, informational rather than billing.
- **Real multi-turn:** `--session-id <uuid>` derived from `correlationId`, plus `--resume`,
  so HITL resumption continues a conversation instead of replaying a fresh one.
- **Determinism without `--bare`:** `--setting-sources`, `--strict-mcp-config`, inline
  `--settings`, and `--exclude-dynamic-system-prompt-sections` for cross-execution cache
  reuse.
- **Actual tool restriction** with `--tools`; today `--allowedTools` only auto-approves and
  restricts nothing.
- **Lifecycle correctness:** handle SIGTERM/exit 143, surface `system/api_retry`, respect
  the background-agent wait ceiling.
- Optional per-agent `mcpServers` so a specialist can reach ClickUp or Slack without those
  tool descriptions costing context in every other node.

**Verify:** gates green including `verify:node-load` under Node; new tests for schema
parsing, budget cap, resume, and the API-key-absence assertion; an end-to-end run against
the real self-hosted n8n worker with a subscription token before this is called done.

---

### Slice 4 - The ClickUp support-ticket path `[SHIPPED]`

**Goal:** the actual production objective. Today's nodes are shaped for a dev flow
(plan → implement → PR); support work is triage → diagnose → answer or fix → escalate.

- **Manual feed first (D-4):** a node that takes a pasted or expression-supplied ticket and
  runs the support flow, so the whole path is exercisable before any trigger exists.
- **Then the ClickUp tag trigger:** poll or webhook on a tag, behind the same ingestion
  boundary as the manual path so both share one code path and one test surface. Reuses
  `src/utils/clickup.ts` and its PII scrubbing.
- **A support triage specialist** and a reference workflow JSON: ingest → classify
  (question / bug / change request / escalation) → route → act → HITL → close or hand off.
- **A generic Claude Code node.** Per D-1 the point of a Claude-Code-per-node is
  subscription billing, not a per-role node surface, so one general node (prompt, agent,
  tools, schema; envelope in and out) is the natural composition primitive. Keep the
  specialist nodes that carry real logic; the rest of the 33-role palette becomes an
  `agent` parameter on the generic node.
- Guardrails suited to unattended support work: budget cap per ticket, read-only-by-default
  tools with explicit escalation, `permissionMode: dontAsk`, and an audit trail of what each
  agent did.

**What shipped:**

- `Software Teams Ticket Intake`: pasted/expression JSON and ClickUp references terminate at
  one PII-scrubbed `SupportTicket` boundary with an initial cumulative ticket budget and
  audit event.
- `Software Teams ClickUp Trigger`: real n8n poller over ClickUp's workspace `tags[]` API,
  new-tickets-only on first activation by default, optional List allowlist, boundary-ID
  deduplication, separate observed/emitted watermarks with a three-batch pending buffer, and comment
  truncation at 200 entries.
  Timestamp alone is insufficient: a per-poll cap can cut through tasks sharing the same
  `date_updated` millisecond, after which strict `date_updated_gt` would lose the tail.
- `Software Teams Claude Code`: one generic composition node with all 34 specialists,
  read-only tools by default (`Read`, `Glob`, `Grep`), explicit write/spec/custom escalation,
  `dontAsk`, custom schema results in `result.data`, model/effort/fallback controls, eight-turn
  default cap, resume, cumulative budget accounting, and non-secret audit events.
- `software-teams-support-triage` and an inactive importable reference canvas where manual and
  tag-driven entry converge on the same typed four-way route: question, bug, change request,
  or escalation, with every branch reaching human review.
- A dedicated `SoftwareTeamsClickUpApi` credential. The poller no longer receives Claude,
  GitHub, Slack, SMTP, or Datadog secrets; ClickUp API calls receive the token explicitly and
  never mutate a shared worker environment.

**Findings caught by live probes:**

- Claude StructuredOutput rejects top-level `oneOf`, `allOf`, and `anyOf` despite those being
  standard JSON Schema. The generic node rejects them before spawn. `question` is required
  globally (empty unless needed), since conditional-required fields are unavailable.
- Fresh sessions were using `correlationId` as `--session-id`; an execution retry collided
  with the first session. Fresh IDs are now generated by Claude and carried on the envelope;
  only continuation uses `--resume`.
- Unknown text from a non-zero Claude process exit could classify as `ok`. Exit code now wins.
- Both HITL nodes fetched credentials but resumed Claude without auth options or the session
  ID. Resume now carries OAuth/API mode, the original tool restriction, `dontAsk`, remaining
  ticket budget, and `--resume`, then records usage.

**Verified:** realistic ClickUp task/comment fixtures cover the custom-ID form represented by
`NDP-34603`, chronological comments, PII scrubbing, task/comment pagination, tag filters,
and timestamp-boundary batching. A live local support probe used the bundled triage agent,
read-only override, custom schema, and a synthetic ticket to produce a typed `needs-input`
escalation with usage and a fresh resumable session. Per the rollout decision, staging
installation, credentials, MCP access, and the REAL NDP-34603 run remain intentionally
deferred until slice 9 so the operator installs one finished product rather than moving
intermediate builds.

---

### Slice 5 - Commands become skills `[SHIPPED]`

**Goal:** move the 21 command files onto the supported extension point and use the
frontmatter that only skills have.

- Convert `commands/<name>.md` → `skills/<name>/SKILL.md`; update the plugin manifest,
  `init`, and `sync-framework` writers, and the `files` array in `package.json`.
- Migrate the legacy `context: |` blocks to inline `` !`command` `` so `context:` is free
  for `fork`.
- Apply `disable-model-invocation: true` to everything with side effects (`commit`,
  `generate-pr`, `worktree*`, `statusline`, `orchestrator-mode`) so Claude cannot fire them
  on its own.
- Use `context: fork` + `agent:` where a command's whole job is to run one specialist in
  isolation, replacing hand-written delegation prose.
- **Retire native duplicates:** former `/st-verify` against bundled `/verify` (which can
  record a `.claude/skills/verify/` recipe rather than use a bespoke gate runner);
  former `/st-pr-review` against bundled `/code-review` + the `ReportFindings` tool.
- Keep supporting material in the skill directory rather than `commands/_shared/`,
  referenced from `SKILL.md` so it loads on demand.

**What shipped:**

- Replaced 21 flat command files with 19 native `skills/<name>/SKILL.md` entrypoints;
  the two omitted files are the native duplicates now served by `/verify` and `/code-review`.
- The common bare invocation surface is `/st-<name>` for both distribution modes. CLI init
  writes `.claude/skills/st-<name>/SKILL.md`; plugin discovery reads `skills/` directly and
  also exposes the explicit `/software-teams:<name>` namespace. Upgrade init removes the
  generated legacy `.claude/commands/st/` tree.
- Moved all 12 legacy `context: |` blocks into body-level `` !`command` `` injection and
  moved shared lazy references into the non-invocable `skills/st-support/` directory.
- Added direct-user invocation guards to operational state, git, PR, and worktree skills.
  Model-invocable implementation and deterministic-workflow skills have exact current-turn
  intent gates, so plan approval alone cannot cross the implementation boundary.
  `create-dev-plan` and `pr-feedback` now run in foreground specialist forks instead of
  spending a second delegation turn on hand-written `Agent(...)` prose.
- `sync-framework` now detects and repairs native-skill drift as well as rules and agents;
  npm publishes `skills/` and no longer includes `commands/`.
- The frontmatter gate now recursively validates only `SKILL.md` entrypoints, rejects legacy
  skill context blocks, and ignores supporting markdown that is not a Claude Code surface.

**Verified:** focused migration tests, typecheck, Claude's plugin validator, npm dry-run
(19 skill entrypoints, six support files, zero legacy commands), bundled `init` into an
empty project (19 skills, 34 agents, no command tree), and real Claude Code 2.1.220
resolution probes for every `/st-*` skill in both plugin and generated-project modes. A
model-invocation probe confirmed guarded `software-teams:statusline` is absent from the
Skill tool while model-invocable read-only skills remain visible.

---

### Slice 6 - Rules move to `.claude/rules/`

**Goal:** delete the bespoke rules layer in favour of the native one.

- Move `rules/*.md` to path-scoped `.claude/rules/*.md` with `paths:` frontmatter
  (`backend.md` → server globs, `frontend.md` → component globs, and so on) so they load
  only when relevant.
- Delete the "**Rules**: Read `.software-teams/rules/general.md` and ..." preamble from all
  33 specs. Subagents already receive the CLAUDE.md hierarchy including project rules, so
  the instruction is both redundant and a per-spawn token cost.
- Repoint `feedback-learner` at `.claude/rules/` and reconcile its dedupe logic with auto
  memory so the two learning loops do not fight. Decide explicitly which learnings belong
  in committed rules (team conventions) versus auto memory (machine-local discoveries).
- Update `templates/CLAUDE-SHARED.md` and the generated CLAUDE.md routing block against the
  memory docs: under 200 lines, gotchas over derivable facts, `@AGENTS.md` import pattern
  for repos that keep an AGENTS.md.

**Verify:** gates green; a probe confirms a path-scoped rule loads on touching a matching
file and does not load otherwise.

---

### Slice 7 - Agent spec debloat

**Goal:** rewrite the 25 non-game specs for Claude 5. Largest prose change, and the one most
likely to reduce per-spawn cost. `game-*` excluded per D-3.

- Strip `CRITICAL:` shouting, the numbered Pre-Approval Workflow ceremony, the "Match the
  Codebase" boilerplate now covered by the harness's own system prompt, and duplicated
  deviation rules.
- Replace teaching-by-example with expressive structured-return interfaces.
- Push multi-step procedures out of specs into skills, and preload them with the `skills:`
  frontmatter field where a specialist always needs one.
- Adopt `memory: project` for specialists that benefit from accumulating codebase knowledge
  (codebase-mapper, debugger, qa-tester, security), and `maxTurns` where a role should be
  bounded.
- Repair or delete the component-cost benchmark (`AGENTS.md` rule 7) so this slice can be
  measured rather than asserted. A slice that claims a context saving without a working
  measurement is not verifiable.

**Verify:** gates green; before/after per-spawn token measurement on a working benchmark;
behavioural spot-check that a debloated specialist still produces the same artefacts.

---

### Slice 8 - Defer to native orchestration

**Goal:** delete Software Teams code the harness now does better. Expect mostly removal.

- Worktrees: replace the bespoke `worktree` / `worktree-merge` / `worktree-remove` commands
  and the `SoftwareTeamsWorktreeCleanup` hook with `isolation: worktree` on the specs that
  need it, `--worktree` for sessions, and `WorktreeCreate`/`WorktreeRemove` hooks for the
  project-specific setup steps that genuinely have no native equivalent (database seeding,
  env files).
- Agent teams: evaluate `--team` and `AgentTeamsOrchestration` against native agent teams
  and `SendMessage`. Keep only what native lacks.
- Workflows: evaluate `compile-workflow` against native dynamic workflows, `/workflows`, and
  `--effort ultracode`. The native `Workflow` tool is stripped from subagents, which
  constrains where compiled workflows can run - confirm before keeping.
- `@ST:` component system: assess against skills plus supporting files. If skills cover it,
  the registry, resolver, validator, and the `component-validate` CI job all go.

**Verify:** gates green; each removal accompanied by a probe demonstrating the native
replacement does the job.

---

### Slice 9 - Documentation and release

- `README.md`, `packages/n8n/CONTRACT.md`, `packages/n8n/ARCHITECTURE.md` (new ADRs for the
  auth switch, the execution-engine rewrite, and the contract bump),
  `skills/st-support/AGENTS-MODELS.md`, `templates/CLAUDE-SHARED.md`, `templates/RULES.md`.
- A start-to-finish n8n operator runbook: worker prerequisites; installing/loading the
  community-node package; confirming all entries load; creating the Claude and ClickUp
  credentials; building or importing the first workflow; running ClickUp ticket NDP-34603
  manually; inspecting executions and audit output; enabling tag-driven pickup safely; and
  recovery, usage-limit, and credential-rotation procedures.
- Connect this harness to staging through n8n's native instance-level MCP only now, then run
  the deferred live-ticket verification before release.
- A setup guide for `claude setup-token`, where the token goes, and why
  `ANTHROPIC_API_KEY` must not be set on the worker.
- Migration notes from `0.13.x`: commands → skills, rules relocation, contract v2, auth.
- Version bump to `1.0.0` and publish. Both packages are public and the publish is
  irreversible.

---

## 6. Sequencing notes

- **1 → 2 → 3 → 4** is the production path and a hard chain. Slice 3 generates `--agents`
  JSON from spec frontmatter, so slice 1's tool-name and model fixes must land first;
  slice 2's effort plumbing rides the same interface.
- **5 → 6 → 7 → 8** is the CLI chain: conversion before relocation before debloat before
  deletion. It can run in parallel with 3-4 by anyone not blocked on the n8n work.
- Debloating specs (7) after the engine (3) is safe: with `--agents`, a spec body is just a
  `prompt` string, so rewriting bodies does not change the engine's shape.
- **9 last**, or the docs describe a moving target.

## 7. Open risks

| Risk | Mitigation |
|------|------------|
| One subscription token is one seat's allowance; a support queue can exhaust the five-hour or weekly window mid-ticket. | Slice 3 treats exhaustion as a distinct status with park-and-retry. Usage credits and an API-key fallback are deliberate switches, not accidents. |
| The one-year OAuth token expires, and an unattended queue stalls with no one watching. | Surface token age and expiry in the credential test; monitor for the `Login expired` failure mode explicitly. |
| Unattended agents acting on customer tickets. | Read-only default tools, explicit escalation, per-ticket budget cap, `dontAsk` permission mode, and an audit trail. Reviewed before enabling for customers. |
| `bun test` + `bun run build` do not typecheck (`AGENTS.md` rule 1), and the context benchmark is inert (rule 7). | Every slice runs all five gates. Slice 1 adds the frontmatter gate; slice 7 repairs or removes the benchmark. |
