# ADR-001: `@websitelabs/n8n-nodes-software-teams` — package shape, execution model & canvas handoff

> **Status:** Accepted (W1 foundation). Pairs with [`CONTRACT.md`](./CONTRACT.md),
> which pins the inter-node data envelope this document references.
> **Plan:** `1-01-n8n-nodes` · **Task:** T1 (`software-teams-architect`).
> **Decides:** AC2 (single-turn execution model) and the package/canvas shape;
> defers AC3's wire format to `CONTRACT.md`. Answers AC2/AC3 from docs alone.

This is the single source of truth every downstream slice builds against. It
fixes four things: (a) the package layout, (b) the **inline single-turn
execution model**, (c) the **canvas handoff** that replaces Claude's native Task
tool, and (d) the open ecosystem questions T2 must resolve. No production
TypeScript is written here.

---

## Context

Software Teams runs today in three places: an interactive Claude Code session, the
`software-teams …` CLI, and the GitHub-Actions headless runner (`action/`). Agent
collaboration (Task tool / SendMessage) only works *inside* a live session — it
cannot be split across processes. The teams want event-driven, composable agents
on a visual canvas with Slack HITL. n8n is the substrate; each specialist becomes
a node and agents hand off **node-to-node** over an explicit JSON contract rather
than through Claude's in-session Task tool.

The grounding primitive already exists: `spawnClaude()` in
[`src/utils/claude.ts`](../src/utils/claude.ts) runs
`claude -p --output-format stream-json` via `Bun.spawn`, streams events, and
returns `{ exitCode, response }`. The GHA path
([`src/commands/action/run.ts`](../src/commands/action/run.ts) ~L820–940) drives a
**full, multi-turn session** with `Task` enabled and a conversation-history
prompt. n8n nodes need the opposite: **one turn, Task disabled, structured I/O.**

---

## Decision A — Package layout

`@websitelabs/n8n-nodes-software-teams` is a standard n8n community-node npm package
living under `n8n/` in this repo. It **depends on the root `@websitelabs/software-teams`
package** to reuse one source of truth for `spawnClaude`, the agent catalogue
(`agents/*.md`), and the ClickUp/Datadog PII-scrubbing fetch utils — the n8n
package never forks that logic.

```
n8n/
├── ARCHITECTURE.md            ← this file (T1)
├── CONTRACT.md                ← inter-node envelope (T1, implemented by T3)
├── package.json               ← name, n8n.nodes[] / n8n.credentials[] registry (T4)
├── tsconfig.json              ← build config (T4)
├── .eslintrc.js               ← eslint-plugin-n8n-nodes-base (T4/T12)
├── credentials/
│   └── SoftwareTeamsApi.credentials.ts   ← ANTHROPIC_API_KEY + optional model (T4)
├── nodes/
│   ├── Agent/                 ← Agent node: one specialist, one turn (T5)
│   ├── Orchestrator/          ← epic → waved breakdown → drives agents (T9)
│   ├── Trigger/               ← ClickUp-label / Datadog ingestion (T6)
│   └── GitHubOutput/          ← final PR/issue (T7)
├── shared/                    ← envelope types + adapter wrapper, canvas helpers
│   ├── envelope.ts            ← NodeEnvelope type (mirrors CONTRACT.md) (T3)
│   └── runAgentTurn.ts        ← single-turn wrapper over spawnClaude (T3, src-backed)
└── __tests__/                 ← contract + node tests (T8/T11/T15)
```

The **single-turn execution adapter is implemented in `src/`** (per the
orchestration's W2 split: T3 touches `src/`), re-exported through `n8n/shared/`.
This keeps the adapter unit-testable by the root `bun test` and importable by both
runtimes.

**Node style — recommendation pending T2.** Agent and Orchestrator nodes shell out
to a binary and stream output, which the **programmatic** style (an `execute()`
method on `INodeType`) supports; the **declarative** style targets pure REST and
cannot host inline process spawning. **Recommend programmatic for Agent/Orchestrator/
GitHubOutput; declarative is acceptable for any pure-REST trigger helper.** T2
confirms against current n8n conventions before T4/T5 build.

---

## Decision B — Inline single-turn execution model (AC2, addresses R-03)

Each Agent node runs **exactly one specialist turn** by shelling out to `claude`
in the n8n worker, built on `spawnClaude`. The contract for the wrapper
(`runAgentTurn`, T3) is:

1. **Single turn.** One `claude -p` call. No conversation loop; no follow-up turns
   inside the node. A multi-step workflow is multiple nodes, not multiple turns.
2. **Task tool disabled.** The wrapper passes an `allowedTools` list that **omits
   `Task`** — i.e. `DEFAULT_ALLOWED_TOOLS` minus `"Task"`. This is the mechanical
   enforcement of "no internal sub-agent spawning": a node cannot fan out to
   sub-agents, so all multi-agent work flows over the n8n canvas (Decision C).
3. **Agent selection.** The node's `agentId` (e.g. `software-teams-frontend`) selects a
   specialist from `agents/*.md`; the agent's system prompt/persona is loaded the
   same way the existing runtimes resolve it.
4. **Prompt assembly.** The wrapper composes the `claude -p` prompt string from the
   envelope's `input` per `CONTRACT.md` → *Upstream-context merge* (a fenced JSON
   `## Upstream context` block prepended to `input.prompt`). Unlike the GHA path it
   does **not** inject GitHub conversation history.
5. **Structured output capture.** `spawnClaude` returns `{ exitCode, response }`.
   The wrapper maps:
   - `response` → `result.text`,
   - `exitCode === 0` → `status: 'ok'`; `exitCode !== 0` → `status: 'error'`,
   - a detected human-input request → `status: 'needs-input'` (the hook T10's Slack
     HITL keys on; marker convention pinned in `CONTRACT.md`),
   - `artifacts` defaults to `[]`; T7's GitHub node appends `{ type, url }` refs.
6. **Model selection per node (R-03).** The node exposes a `model` parameter passed
   through to `spawnClaude({ model })`, letting expensive agents downshift. Cost is
   one full invocation per node — documented in `n8n/` docs (T14).
7. **Self-hosted fail-fast (AC9, R-01).** `runAgentTurn` calls `findClaude()` first;
   if the binary or `ANTHROPIC_API_KEY` is absent it throws a clear, actionable
   error before any work — surfacing the self-hosted constraint at execution time.

**Why not reuse the GHA session runner?** It is multi-turn, Task-enabled, and
GitHub-comment-coupled. Nodes need a stateless, Task-disabled, envelope-in /
envelope-out turn. Single-turn is **new logic** layered on the same `spawnClaude`
primitive, not a refactor of `run.ts`.

---

## Decision C — Canvas handoff replaces the native Task tool (AC4, addresses R-04)

With `Task` disabled inside every node, agent-to-agent collaboration is
re-implemented as **n8n data flow**: node A's output port → node B's input port,
both speaking the `NodeEnvelope` (`CONTRACT.md`). Handoff = the downstream node
folds the upstream node's `result`/`artifacts` into its own `input.context`
(see `CONTRACT.md` → *Upstream-context merge* and the worked example).

**Orchestrator → agent delegation.** The Orchestrator node (T9) accepts an
epic/goal, re-derives the waved task breakdown the in-session orchestrator would
have produced, and **emits one envelope per planned sub-task** with `agentId` set
to the chosen specialist and `input.prompt` set to that sub-task's brief. On the
canvas these route to agent nodes by one of two equivalent patterns:

- **Static wiring** — the designer wires `Orchestrator → AgentA → AgentB`; each
  agent node is pre-bound to one `agentId`. Simple, fully visual.
- **Dynamic routing** — a `Switch`/`Filter` keyed on the envelope's `agentId` fans
  each item to the matching agent node. Lets one canvas serve a variable plan.

Either way the Orchestrator owns sequencing (waves/deps) explicitly — there is no
hidden Task-tool graph. This is the deliberate AC4 design and the R-04 mitigation;
the `contract-check` gate guards the envelope the whole graph depends on.

**Partial-failure & resume (addresses R-05).** Every envelope carries an immutable
`correlationId` and a `status`. A node emitting `status: 'error'` short-circuits its
branch; a node emitting `status: 'needs-input'` parks the run for Slack HITL (T10)
and resumes the **same** `correlationId` once a human replies. The Orchestrator
persists run state keyed by `correlationId` (T9) so a half-done run is resumable and
re-runs are idempotent. `correlationId` is the join key for both run-state (T9) and
Slack resume (T10).

---

## Risk resolutions (explicit design choices)

| Risk | Resolved by |
|------|-------------|
| **R-03** cost/latency per node | Single-turn + Task-disabled caps per-node work; per-node `model` selection; Orchestrator parallelises independent waves (Decision B). |
| **R-04** loss of native Task handoff | Explicit `NodeEnvelope` + canvas data-flow handoff; Orchestrator re-derives waves/deps; `contract-check` gate guards drift (Decision C). |
| **R-05** partial failure mid-run | `correlationId` + `status` on every envelope; `error` short-circuits, `needs-input` parks for HITL; Orchestrator persists state for resumable/idempotent re-runs (Decision C). |

---

## Open ecosystem questions for T2 (scoping handoff)

T2 (`software-teams-researcher`) must resolve, before T4/T5 build:

1. **Node style** — confirm programmatic (`execute()` on `INodeType`) is current
   best practice for inline-spawning nodes; capture any declarative constraints.
2. **Credential API** — how to define the `SoftwareTeamsApi` credential type
   (`ANTHROPIC_API_KEY`, optional default `model`), and the exact mechanism for
   exporting a credential into the child `claude` process's env (R-02: secrets via
   credentials only, never node params, never echoed into the envelope/logs).
3. **Registration & build** — the `package.json` `n8n.nodes[]` / `n8n.credentials[]`
   block, file-naming conventions, and a `tsc` build that satisfies
   `eslint-plugin-n8n-nodes-base` (AC8). Confirm the lint ruleset and any
   community-node packaging requirements.
4. **Slack wait/resume primitive** — the n8n mechanism for pause→resume
   (`Wait` node + resume webhook vs. `putExecutionToWait`) that T10 will build the
   HITL state machine on, and how execution state survives the wait (R-05).
