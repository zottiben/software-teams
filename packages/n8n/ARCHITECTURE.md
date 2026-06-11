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

---
---

# ADR-002: Repo-scoped coding execution — queue-safe × worktree-per-agent × Finaliser-resolves-all-conflicts

> **Status:** Accepted (plan `1-04-n8n-repo-execution`, T1, `software-teams-architect`).
> Extends ADR-001 (single-turn model, canvas handoff, `correlationId` resume) and the
> [`CONTRACT.md`](./CONTRACT.md) addendum (the additive `repoContext`/`changeRef`
> fields). **This is the single source of truth every repo-execution slice (T2, T4,
> T7, T8, T9) builds against** — each one implements the decisions fixed here and
> re-opens NONE of them. No production TypeScript is written here.
> **Decides:** AC5, AC6, AC8, AC9, AC10, AC11. **Resolves** R-15, R-16, R-17, R-18
> (and reaffirms R-02). No "OR" / "and/or" is left for any implementer.

---

## Context

ADR-001 made Software Teams specialists run as n8n nodes, one single turn each,
handing off node-to-node over the `NodeEnvelope`. It cannot yet make **real code
changes against a target repository**. The spec (`n8n-repo-execution.spec.md`)
names four gaps and two shaping constraints:

1. **No working directory.** `runAgentTurn` (`src/execution/single-turn.ts`) calls
   `spawnClaude` with no `cwd`; every turn runs in the worker's `process.cwd()`.
   Nothing clones/checks out the configured repo.
2. **No portable change.** Agents emit `result.text` only; nothing captures the
   files an agent changed in a form another worker can re-apply.
3. **No aggregation.** The Orchestrator fans out one envelope per task and persists
   run-state to workflow static data, but never collects results — nothing to merge.
4. **Queue-mode constraint.** n8n **queue mode** dispatches items across workers, so a
   working copy made on one worker is not on the next. The run must be re-establishable
   on **any** worker — never assuming one worker or a shared `/tmp`.
5. **DAG-only constraint.** An n8n canvas is a directed acyclic graph; there is **no
   native return edge** from an Agent node back to the Orchestrator. Results cannot be
   "collected back" up an edge.

This ADR fixes six decisions (D–I) that reconcile these into one buildable design.

---

## Decision D — `RepoContext` shape + the SINGLE threading mechanism (AC5, AC10; resolves the T1/T2 "OR")

The run's repository checkout is described by ONE typed interface. Its members are
fixed and exhaustive:

```ts
export interface RepoContext {
  /** Clone URL of the target repo (https/ssh). NEVER contains an embedded token (R-02). */
  cloneUrl: string;
  /** Canonical "owner/repo" — the validated form used for gh/PR addressing. */
  ownerRepo: string;
  /** Branch the run is based on (e.g. "main"). All worktrees fork from here. */
  baseBranch: string;
  /** ADR-001 run id; the join key for run-state + aggregation. Carried unchanged. */
  correlationId: string;
  /** Absolute path to THIS turn's isolated git worktree on the current worker. */
  worktreePath: string;
  /** This turn's captured portable change (Decision E). Absent until the turn produces one. */
  changeRef?: ChangeRef;
}
```

**Amendment (revision 2 follow-up):** Repo *coordinates* (`cloneUrl`, `ownerRepo`,
`baseBranch`) cross Workspace→Agent via the additive optional top-level `repo` field
(`RepoDescriptor`) on the envelope — the DAG canvas has no other channel for seeding
these from the Workspace node to downstream Agent nodes. The `repo` field is non-secret
and never reaches `assemblePrompt` because it is a top-level sibling of `input`. The
full `RepoContext` (which adds the off-wire `worktreePath`) remains off-wire; each
Agent node constructs it locally from `envelope.repo` + `correlationId` + a locally
created worktree, and owns the worktree lifecycle. The thread-via-typed-param mechanism
for `runAgentTurn` is unchanged.

**Threading mechanism — CHOSEN: a typed optional parameter on `runAgentTurn`.**
`runAgentTurn` gains exactly one new optional argument, `repoContext?: RepoContext`.
This is the single mechanism; the alternative (a reserved envelope field consumed by
the adapter) is **rejected**.

- **Chosen** — typed param: explicit, type-checked at the call site, **never on the
  wire**, and trivially impossible to leak into the prompt (it is a function
  argument, not part of the envelope `assemblePrompt` reads). The Workspace/Agent
  node constructs it and passes it; with no argument, `runAgentTurn` behaves
  **byte-for-byte as today** (back-compat, AC10).
- **Rejected** — reserved envelope field: would put repo internals on the wire,
  require `assemblePrompt` to explicitly exclude a key, and risk serialisation into
  logs. The typed param removes the leak surface entirely.

So `runAgentTurn(input: NodeEnvelope, repoContext?: RepoContext)`. T2 implements this
ONE mechanism — no design choice remains. Inside the adapter, when `repoContext` is
present, `cwd` passed to `spawnClaude` is `repoContext.worktreePath` (resolves gap 1).

**Prompt isolation (tactical default `workDir_threading`).** `assemblePrompt`
([`src/execution/single-turn.ts`](../src/execution/single-turn.ts)) composes the
`claude -p` string from `input.prompt` + the §4 `## Upstream context` block **only**.
`RepoContext` is NOT part of `input`, NOT part of `input.context`, and NOT a parameter
`assemblePrompt` receives — it is consumed solely to set `cwd`. There is therefore no
path by which any `RepoContext` member (including `cloneUrl`) reaches the model prompt.
T2 MUST keep `assemblePrompt`'s signature/inputs free of `RepoContext` and assert this
in the back-compat test. **(Mitigates R-18: the field never bleeds into prompt/§4 merge.)**

---

## Decision E — The SINGLE canonical portable-change representation: `changeRef` (AC5, AC9; resolves the T1/T4/T9 "OR")

Each agent's file changes are captured as ONE canonical, self-contained artifact —
**base64-encoded `git format-patch` bytes** — carried on the envelope as `changeRef`:

```ts
export interface ChangeRef {
  /** Discriminant — the ONE canonical form. Reserved for future additive kinds. */
  kind: 'format-patch';
  /** base64 of `git format-patch` output (one or more patch files concatenated). */
  patchBase64: string;
}
```

**Why this one, and the trade-off vs the rejected option:**

- **Chosen** — base64 `git format-patch` bytes: fully **self-contained**. It needs
  **no shared storage**, so it is **queue-mode-safe** by construction — any worker
  re-establishes the change with `git apply` / `git am` regardless of which worker
  produced it. The patch rides the envelope as plain JSON-safe text.
  Trade-off accepted: a larger envelope payload for big diffs.
- **Rejected** — a commit SHA pushed to a per-agent ref on mandated shared storage
  (a shared remote/volume): a **smaller** envelope, but it requires every worker to
  reach the same remote/volume, reintroducing the single-worker / shared-`/tmp`
  assumption the spec forbids (constraint 4). The size win does not justify breaking
  queue-mode safety.

T4 **captures** exactly this (`git format-patch base..HEAD` in the worktree →
base64), and T9 **applies** exactly this (`git apply`/`git am` of the decoded bytes).
Neither slice references a second representation; the `kind` discriminant is the only
extension point. **(Mitigates R-15: filesystem worktree loss mid-run is recoverable
because the change lives on the envelope, not the disk.)**

---

## Decision F — Aggregation topology: FORWARD to the Finaliser via run-state on static data (AC5, AC8; resolves the T8 DAG gap)

An n8n canvas is **DAG-only** — there is no return edge from an Agent node to the
Orchestrator, so completed envelopes cannot flow back. The ONE buildable topology:

```
Orchestrator ──(one envelope per task)──▶ Agent (worktree turn)
                                              │
                                              │ T8 aggregation transition:
                                              │ getWorkflowStaticData('node').runs[correlationId]
                                              │   .tasks[taskId] ← { status, changeRef, detail }
                                              │   (serialiseRunState writes the plain object)
                                              ▼
                                   workflow static data  (runs[correlationId]: RunState)
                                              │
                                              │ T9 reads directly:
                                              │ deserialiseRunState(runs[correlationId])
                                              ▼
                                          Finaliser  ──▶ merge → push → branch artifact → summary
```

**Mechanism — reusing the ADR-001/T9 run-state primitive verbatim:**

- The Orchestrator already writes `staticData['runs'][correlationId] = serialiseRunState(plan.state)`
  where `RunState = { correlationId, createdAt, tasks: RunTaskState[] }`
  (`src/orchestration/run-state/shapes.ts`). Each `RunTaskState` is keyed by `taskId`
  and carries `agent`, `status`, `detail`.
- **Writer = T8** (the aggregation transition, invoked on each returning Agent item).
  It reads `getWorkflowStaticData('node')`, deserialises `runs[correlationId]`, finds
  the task entry by `taskId` (and `agentId` where a wave has parallel agents), records
  the agent's terminal `status` and its `changeRef`, and re-serialises via
  `serialiseRunState`. The key is `correlationId` + `taskId`/`agentId`. `RunTaskState`
  gains one additive optional field, `changeRef?: ChangeRef`, to carry the captured patch.
- **Reader = T9** (the Finaliser). It calls `getWorkflowStaticData('node')`, runs
  `deserialiseRunState(runs[correlationId])`, and **enumerates every task's `changeRef`**
  to build the merge set. It reads run-state directly; it does not receive envelopes
  back from agents.

**Direction is one-way and explicit:** aggregation flows **FORWARD to the Finaliser**
(which has the run-state read input on the canvas), **never backward to the
Orchestrator**. The Orchestrator stays a pure fan-out; no new wire-contract, no return
edge. **(Mitigates R-04: aggregation rides the existing `correlationId` run-state
mechanism, additive only.)**

---

## Decision G — Workspace node boundary (AC1, AC5; new node)

The **Workspace node** establishes the run's checkout and seeds `RepoContext`.

- **Inputs:** target repo (`owner/repo` or clone URL) + base branch from node params
  (validated/sanitised per T5, R-08); the inbound envelope (carries `correlationId`).
- **Fail-fast (R-01):** verifies the `git` binary is present before any work and
  throws a clear, actionable error if absent — the same pattern ADR-001 §B.7 used for
  `claude`. (T9 adds the equivalent fail-fast for `gh`.)
- **What it does:** clones the target repo at `baseBranch` (shallow per R-03) into a
  run-scoped checkout, then — for each Agent turn — a `git worktree` is forked from that
  checkout so parallel agents never collide on one index/working tree
  (worktree-per-agent). The worktree's absolute path becomes `RepoContext.worktreePath`.
- **What it seeds:** it constructs the `RepoContext` (`cloneUrl`, `ownerRepo`,
  `baseBranch`, `correlationId`, `worktreePath`) for downstream Agent turns per the
  Decision-D typed-param mechanism. `RepoContext` is **not** placed on the envelope —
  it is threaded as the `runAgentTurn` argument. `changeRef` is left absent until a
  turn produces a change. The GitHub token is **never** seeded into `RepoContext`
  (R-02; see Decision I).

**Amendment (revision 2 follow-up):** The non-secret repo coordinates (`cloneUrl`,
`ownerRepo`, `baseBranch`) are also written to the additive optional `repo` field
(`RepoDescriptor`) on the outbound envelope so downstream Agent nodes can read them
from the canvas wire without relying on a shared side-channel. `RepoContext` (with
`worktreePath`) remains off-wire; each Agent node constructs it locally. The Workspace
node owns seeding `envelope.repo`; the `SoftwareTeamsApi` credential (not `envelope.repo`)
carries the GitHub token (R-02).

---

## Decision H — Finaliser node boundary + BOUNDED conflict-free merge (AC6, AC7, AC8; resolves the T9 unbounded-loop gap, R-16)

The **Finaliser node** is the run's terminus. It reads the aggregated run-state
(Decision F), merges every agent's change onto one branch, **guarantees a conflict-free,
marker-free tree within a bound or fails cleanly**, pushes, and emits the `branch`
artifact + run summary.

**Merge strategy — bounded and guaranteed:**

1. Enumerate every task's `changeRef` from `runs[correlationId]` (Decision F).
2. Apply them onto a fresh branch off `baseBranch` via git's automatic merge
   (`git apply`/`git am`/three-way). Apply in a stable order (wave, then `taskId`).
3. **If git cannot auto-resolve** a conflict (textual or semantic), run an intelligent
   **claude conflict-resolver turn** (a single-turn invocation per ADR-001, Task
   disabled) over the conflicted files to produce a clean, buildable tree.
4. The resolver loop is **BOUNDED at max 3 conflict-resolver turns**. After each turn,
   the tree is checked for conflict markers and a clean apply.
5. **Within the bound:** as soon as a marker-free, conflict-free tree is reached, commit
   the merged work, push a feature branch, and proceed to artifact + summary.
6. **Bound exceeded:** if no clean, marker-free tree is reached within 3 resolver turns,
   the Finaliser **FAILS with a structured error** that surfaces the **conflicting file
   list** in the run summary. It **never loops indefinitely** and **never pushes a tree
   containing conflict markers**.

The conflict-free guarantee is therefore **bounded**: *"resolves within 3 attempts or
fails cleanly with a structured error (conflicting files surfaced)."* This bounded
failure is a **defined outcome**, not an escalation — T11 asserts both the within-bound
success and the bound-exceeded structured-failure paths. **(Resolves R-16.)**

**Artifact + summary (AC7, AC8, R-17):** on success the Finaliser emits a `branch`
artifact in **exactly** the shape `extractBranchName` / `resolveOutputRef` consume
(`{ type: 'branch', url: '…/tree/<branch>' }`, per CONTRACT.md §3 example) so the
existing Output node takes the **PR** path, not the issue fallback. It synthesises a
human-readable run summary (per-agent result, the branch, the PR) that rides the
envelope `result.text` and is included in the PR body. Fail-fast on a missing `gh`
binary (R-01).

---

## Decision I — Additive-only contract + secret handling (AC10, AC11; R-02, R-18)

- **Additive-only.** The repo-execution work adds **only** optional fields: the
  `RepoContext` typed param (off-wire, Decision D), the envelope `changeRef` carry and
  the `RunTaskState.changeRef` carry (CONTRACT.md addendum), and the `branch` artifact
  `type` (already open-vocabulary per CONTRACT.md §1). The **six top-level envelope
  fields, their invariants, and the §4 upstream-context merge are UNCHANGED.** Existing
  envelope/contract tests and `contract-check` stay green. **(Resolves R-18.)**
- **Secrets (R-02, AC11).** The GitHub token is **never** part of `RepoContext` (note
  `cloneUrl` carries no embedded credential) and **never** any envelope field. It is
  injected into the claude child process and git/gh environment from the
  `SoftwareTeamsApi` credential only (T3, mirroring `ANTHROPIC_API_KEY`), and never
  appears in the envelope, node output, logs, or the model prompt. T5 audits every new
  surface; tests assert its absence.

---

## Risk resolutions (downstream slices implement these verbatim)

| Risk | Resolved by (this ADR) |
|------|------------------------|
| **R-15** queue-mode worker loses the worktree mid-run | Decision E: the change lives on the envelope as base64 `format-patch` (`changeRef`), not on disk; any worker re-applies it. T4 makes the working copy re-establishable; T11 tests cross-directory reconstruction. |
| **R-16** Finaliser loops forever / pushes conflict markers | Decision H: claude resolver loop BOUNDED at max 3 turns; within bound guarantees a clean, buildable, marker-free tree before push; bound exceeded ⇒ structured error surfacing the conflicting file list. Never loops, never pushes markers. |
| **R-17** Output opens an issue instead of a PR | Decision H: the Finaliser emits a `branch` artifact in exactly the `extractBranchName`/`resolveOutputRef` shape; T11 asserts the Output node takes the PR path. |
| **R-18** new additive field breaks §4 merge / existing nodes | Decisions D + I: `RepoContext` is off-wire (typed param), `changeRef` is additive/optional, `assemblePrompt` excludes repo context; the six invariants + §4 merge are unchanged; contract-gate + T11 new-field tests stay green. |
| **R-02** token leak (reaffirmed) | Decision I: token via the `SoftwareTeamsApi` credential into child-process env only; never in `RepoContext`, any envelope field, output, logs, or prompt. |

---

## What downstream slices build (no design decisions remain)

- **T2** — add `repoContext?: RepoContext` to `runAgentTurn`; set `cwd =
  repoContext.worktreePath`; keep `assemblePrompt` free of repo context; back-compat
  with no arg. (Decision D)
- **T4** — git/worktree/patch core lib: shallow clone, `git worktree` per agent,
  capture `changeRef` (base64 `format-patch`), apply `changeRef` on any worker. (Decision E)
- **T7** — Workspace node: clone + worktree + seed `RepoContext`; fail-fast on `git`. (Decision G)
- **T8** — aggregation transition: write `{ status, changeRef }` into
  `runs[correlationId].tasks[taskId]` on workflow static data via `serialiseRunState`;
  forward-only, DAG-safe. (Decision F)
- **T9** — Finaliser node: read aggregated run-state, bounded (≤3) conflict-resolver
  merge, push feature branch, emit `branch` artifact, synthesise summary; fail-fast on
  `gh`. (Decisions F + H)

---
---

# ADR-003: n8n package module format = CommonJS for Node loadability

> **Status:** Accepted (plan `1-05-n8n-node-runtime`, T1, `software-teams-architect`).
> Extends ADR-001/ADR-002 — neither is re-opened. **This is the single source of truth
> the module-format slices (T2 mechanical edits, T3 Node-load gate) build against.** No
> production TypeScript or config is written here; this ADR only fixes the decisions.
> **Decides:** AC2 (CJS emit), AC3 (real entry), AC4 (shared lib resolves as CJS), AC5
> (`n8n-workflow` resolves as CJS), AC6 (Node-load gate contract); underwrites AC1/AC7.
> **Resolves** R-20, R-21, R-22, R-23. No "OR" / "and/or" is left for any implementer.

---

## Context

The package is built (`n8n-node build`, `tsc`-only, no bundler) but **not loadable by
Node** — so a self-hosted n8n (which runs on Node) registers none of its seven nodes.
`packages/n8n/tsconfig.json` sets `module: "preserve"` + `moduleResolution: "bundler"`,
so the emitted `dist/nodes/**/*.node.js` mix ESM `import`/`export` with CJS `require(...)`
and use **extensionless** relative imports; `package.json` declares no `"type"` while
`"main": "index.js"` names a file that does not exist anywhere in the package or its `dist`.

Empirically (re-verified at T1, with CWD = `packages/n8n/`):

```
$ node -e "require('./dist/nodes/SoftwareTeamsAgent/SoftwareTeamsAgent.node.js')"
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/.bun/n8n-workflow@2.16.0/
  node_modules/n8n-workflow/dist/esm/logger-proxy' imported from …/dist/esm/index.js
```

The emitted node opens with `import { NodeConnectionTypes … } from 'n8n-workflow';` +
extensionless `import … from '../../src/n8n-cast';`. Node treats the file as ESM, the
extensionless relative imports do not resolve, and the load **cascades into `n8n-workflow`
resolving its ESM build** (`dist/esm/index.js`) instead of its CJS build (`dist/cjs/index.js`).
The existing suite runs under **Bun**, which tolerates the mixed format — so it passed green
while the Node `dist` was unloadable. There is no gate that catches a Node-load regression.

A second-order constraint ripples across packages: the shared lib `@websitelabs/software-teams`
(`packages/cli`) is `"type": "module"` and its `exports` map resolves `require → ./lib/n8n-api.js`
(a real CJS build that exists) but `import → ./src/n8n-api.ts` (TS source Node cannot execute).
The n8n package MUST consume it via the **CJS (`require`) condition**. The fix therefore
touches BOTH packages and the `n8n-workflow` peer — the riskiest, most-novel decision, hence
architecture-first.

**Re-verified facts (T1):** `packages/cli/lib/n8n-api.js` exists and is CJS (`"use strict";`);
`packages/cli/package.json` `exports['.'].require === "./lib/n8n-api.js"`; `n8n-workflow`
`package.json` `main === "dist/cjs/index.js"` with **no `"type"`** (so its `main` is CJS under
Node), and both `dist/cjs/index.js` and `dist/esm/index.js` are present in the workspace
`node_modules`.

---

## Decision 1 — tsconfig deltas (CJS emit; mirrors the official `@n8n/node-cli` template)

`packages/n8n/tsconfig.json` `compilerOptions` change to exactly these values (replacing the
two bug values; the rest of the block is unchanged):

| key | from (bug) | to (CHOSEN) | why |
|-----|------------|-------------|-----|
| `module` | `"preserve"` | `"commonjs"` | emit CJS `require`/`exports` — no ESM `import`/`export` in `dist` (AC2). |
| `moduleResolution` | `"bundler"` | `"node"` | Node's classic CJS resolver: extensionless relative imports resolve, and a CJS importer selects the `require` condition of any `exports` map (Decisions 3, 4). |
| `target` | `"ES2020"` | `"es2019"` | mirror the official `@n8n/node-cli` template. |
| `esModuleInterop` | `true` | `true` (**unchanged — keep on**) | the existing `import { … } from 'n8n-workflow'` / `import { randomUUID } from 'node:crypto'` default+named imports compile to interop-correct `require` calls. **Do NOT remove it** — removing it would break those interop sites. |

`lib` stays `["ES2020"]` (or may track `target`; not load-bearing). `declaration`,
`declarationMap`, `sourceMap`, `strict`, `skipLibCheck`, `forceConsistentCasingInFileNames`,
`resolveJsonModule`, `outDir`, `rootDir`, `include`, `exclude` are **unchanged**. No `"type"`
key is added to `tsconfig` (that is a `package.json` concern — Decision 2).

**This is the entire compiler-side fix. No bundler is introduced (non-goal).**

---

## Decision 2 — package entry + `"type"` (real `main`, CJS `.js`)

- **`"type"`: leave UNSET.** Do **not** add `"type": "module"`. With no `"type"`, every
  emitted `.js` is interpreted as **CommonJS** by Node — which is exactly what
  `module: "commonjs"` produces. Adding `"type": "module"` would re-introduce the ESM
  interpretation this ADR removes. (R-20.)
- **`"main"`: repoint to a real, always-present, side-effect-free built entry —
  `"dist/credentials/SoftwareTeamsApi.credentials.js"`.** The current `"index.js"` resolves
  to nothing (no root `index.*` source exists and the build emits no `dist` root index — the
  official `@n8n/node-cli` build emits only `dist/nodes/**` and `dist/credentials/**`).
  **No new index file is created** (that would be unbacked source / a build-shape change).
  The credential entry is in the `n8n.credentials[]` registry, exists in every build, and
  loads cleanly under CJS with the smallest dependency surface, satisfying AC3 (`main`
  resolves to a real file that loads). n8n itself loads nodes/credentials via the unchanged
  `n8n.nodes[]` / `n8n.credentials[]` block — `main` is the package's generic Node entry, not
  the n8n load path, so this choice does not affect node registration.

---

## Decision 3 — shared-lib `@websitelabs/software-teams` resolves via its `require` condition

Under Node, with the n8n package now CJS (Decision 1, `moduleResolution: "node"`), a `require`
of the shared lib selects the **`require` condition** of its `exports` map →
`./lib/n8n-api.js` (the real CJS build, confirmed present, `"use strict";`). It does **NOT**
select the `import` condition (`./src/n8n-api.ts`, TS source Node cannot execute). The
`NodeEnvelope` type, `slugify`, `sanitizeUserInput`, `enumerateAgentResults`, etc. are usable
at runtime via CJS. T2 changes nothing in `packages/cli` — the shared lib's `exports` map is
already correct; the n8n package consuming it as CJS is what flips the condition. (R-21; AC4.)

---

## Decision 4 — `n8n-workflow` peer + the exact Node-load gate mechanism

- **Peer resolution.** Under Node + CJS `moduleResolution: "node"`, `require('n8n-workflow')`
  resolves the peer's `main` → `dist/cjs/index.js` (confirmed present; `n8n-workflow` has no
  `"type"`, so its `main` is CJS). The ESM cascade (`dist/esm/logger-proxy`) that currently
  fails is the **Bun-install ESM path** — not the path a real n8n host or this gate uses. (AC5.)
- **The exact gate mechanism — PINNED, no "OR": the Node-load verifier runs with
  `CWD = packages/n8n/`.** From that CWD the workspace `node_modules` supplies
  `n8n-workflow`'s `dist/cjs/index.js` (present) and resolves the shared lib's `exports.require`
  condition → `lib/n8n-api.js` (present). **This is the host-equivalent resolution boundary**,
  reproducing locally how a real n8n host resolves the peer from its own Node-resolved
  `node_modules`. It is explicitly **NOT** the Bun-install ESM path
  (`.bun/n8n-workflow@…/…/dist/esm/index.js`) that currently fails. **T3 sets the verifier's
  CWD to `packages/n8n/` verbatim** and re-opens no part of this. (R-22; AC5.)

---

## Decision 5 — Node-load gate contract (the exact shape T3 implements)

A repeatable post-build verification that loads, **under Node (not Bun)**, every entry in the
`package.json` `n8n.nodes[]` array (all **seven**) plus the one `n8n.credentials[]` entry:

```
# run AFTER `bun run build`, with CWD = packages/n8n/ (Decision 4)
node -e "require('<built node/credential path>')"   # for each of the 8 entries
```

- The eight paths are read from / match the `n8n.nodes[]` + `n8n.credentials[]` arrays
  (the seven `dist/nodes/**/*.node.js` + `dist/credentials/SoftwareTeamsApi.credentials.js`).
- **Any** load failure (`ERR_MODULE_NOT_FOUND`, "require is not defined in ES module scope",
  "exports is not defined", or any throw) ⇒ the gate exits **non-zero**.
- It runs **explicitly under Node**, separate from the Bun test run, so a Bun-tolerated
  mixed-format regression (the exact original failure mode) is caught. T8/CI wires it as a
  distinct step. (R-23; AC6.)

---

## Resolution boundary (one statement)

The Node-load gate verifies the **host-equivalent CommonJS resolution boundary** — CWD =
`packages/n8n/`, where the workspace `node_modules` provides `n8n-workflow/dist/cjs/index.js`
and the shared lib's `require` condition (`lib/n8n-api.js`). It does **NOT** verify, and does
not depend on, the Bun-install ESM path (`.bun/.../dist/esm/index.js`) that is the current
failure. On a real n8n host the peer is provided by n8n's own Node-resolved `node_modules`;
running from `packages/n8n/` reproduces that resolution locally.

---

## Non-goals (explicit)

- **No bundler** (no esbuild/tsup/rollup). The fix is a tsconfig module-format change
  consistent with the official `@n8n/node-cli` template. (Spec Out of Scope.)
- **No return edge** from an Agent node to the Orchestrator — ADR-002 Decision F's
  forward-only DAG aggregation is untouched.
- **`spawnClaude` stays on `node:child_process`** — do NOT touch it (it is already
  Node-compatible). (Spec Out of Scope.)
- **`NodeEnvelope` contract unchanged** — its six top-level fields, invariants, and the §4
  upstream-context merge are not altered. This is a module **FORMAT** change only;
  behaviour is preserved (the existing Bun suite, typecheck, lint stay green — AC7). (R-20.)

---

## Implementer checklist for T2/T3 (no design decisions remain)

**T2 — mechanical CommonJS edits (`tsconfig.json` / `package.json` / imports only):**

1. `packages/n8n/tsconfig.json` → set `module: "commonjs"`, `moduleResolution: "node"`,
   `target: "es2019"`; **keep `esModuleInterop: true`**; leave every other key as-is.
2. `packages/n8n/package.json` → set `"main": "dist/credentials/SoftwareTeamsApi.credentials.js"`;
   do **NOT** add `"type"`; create no index file.
3. Make relative imports resolvable under Node's CJS resolver — `module: commonjs` +
   `moduleResolution: node` emits extension-correct `require`s for the existing
   `../../src/...` imports; do not hand-edit import specifiers beyond what the compiler needs.
4. Change nothing in `packages/cli` — the shared lib's `exports.require` is already correct
   (Decision 3). Do not touch `spawnClaude`, `NodeEnvelope`, or the §4 merge.
5. Gate: existing Bun suite + `tsc --noEmit` + lint + build stay green (AC7).

**T3 — Node-load verification gate:**

1. After `bun run build`, run `node -e "require('<path>')"` for each of the 8
   `n8n.nodes[]` + `n8n.credentials[]` entries, **with CWD = `packages/n8n/`** (Decision 4).
2. Exit non-zero on any load failure; run under Node, separate from the Bun suite (Decision 5).
3. Wire as a distinct CI/quality-gate step (T8) so a mixed-format regression is caught.

---
---

# ADR-004: Cross-node forward-aggregation via global static data + both-layout persona resolution + publish-ready packaging

> **Status:** Accepted (plan `1-06-n8n-repo-pr-e2e`, T1, `software-teams-architect`).
> Extends ADR-001/ADR-002/ADR-003 — none is re-opened. **This is the single source of
> truth the Wave-2 slices (T2 Gap A, T3 Gap B, T4 packaging, T5 entry affordance) build
> against** — each one implements the decisions fixed here and re-opens NONE of them. No
> production TypeScript or config is written here; this ADR only fixes the decisions.
> **Decides:** AC1 (mechanism pinned); underwrites AC2/AC3/AC4/AC5/AC6 (Gap A),
> AC7/AC8/AC9 (Gap B persona), AC10 (packaging), AC11 (entry affordance).
> **Resolves** R-25, R-26, R-27, R-28, R-29, R-30 (and reaffirms R-02). No "OR" / "and/or"
> is left for any implementer.

---

## Context

The 7-step repo→agents→PR workflow does NOT genuinely work on a fresh Node-based n8n
host even though the Bun suite is green (the suite mocks `getWorkflowStaticData` as one
shared object — the "Bun-masks-runtime" pattern 1-05 exposed for module loading, now
recurring for cross-node state). Two blocking gaps plus packaging polish stand between
the implemented nodes and the acceptance scenario.

**Re-verified facts (T1, empirical — not guessed):**

- **Gap A is real.** The plan Orchestrator writes run-state to
  `getWorkflowStaticData('node')['runs'][correlationId]`
  (`SoftwareTeamsOrchestrator.node.ts:144`). The summary mode reads its OWN node store
  (`:194`). The Finaliser reads its OWN node store (`SoftwareTeamsFinaliser.node.ts:184`)
  and THROWS "No aggregated run-state found" when empty (`:189-197`). The Agent node only
  emits `changeRef` on the wire (`SoftwareTeamsAgent.node.ts:354-355`) and NEVER calls
  `getWorkflowStaticData`/`recordAgentResult`. The only writer, `recordAgentResult`
  (`transitions.ts:114`), is reached ONLY by the Orchestrator continue-run path
  (`:164-182`, the `recordAgentResult` call at `:169`) — a forbidden return edge a
  forward-only DAG never traverses. n8n keys `'node'` static data per node NAME, so each
  of the three consumers gets a DIFFERENT empty object on a real host.
- **The transitions are correct.** `recordAgentResult` (`:114`), `enumerateAgentResults`
  (`:166`), `summarise`, and `serialiseRunState`/`deserialiseRunState` need NO change. The
  gap is purely WHO calls them and WHERE the state lives (node vs global).
- **Gap B climb is off by one.** `single-turn.ts` builds to `dist/src/execution/single-turn.js`,
  so `__dirname` at runtime is `<pkg>/dist/src/execution`. The current `resolveAgentSpecPath`
  climbs 4 (`join(__dirname, "../../../..")`, `:135`) → `…/software-teams/packages` (NOT the
  repo root `…/software-teams`). Reaching the repo root needs climb 5. The package ships NO
  specs (`packages/n8n/agents/` and `dist/agents/` do not exist today), so on a fresh
  npm/custom-extensions install `resolveAgentSpecPath` returns `null` → `agentSpecBody` empty
  (`:198-209`) → every specialist runs an identical bare prompt.
- **The bundled-spec set is unambiguous.** `SPECIALIST_OPTIONS`
  (`SoftwareTeamsAgent.node.ts:30-64`) is EXACTLY 33 `software-teams-*` values; the repo
  has EXACTLY 33 `.claude/agents/software-teams-*.md` files; a both-ways `comm` diff is
  EMPTY. "Lean (only SPECIALIST_OPTIONS)" and "all 33" are the SAME set. There is no choice.
- **Packaging.** `package.json` has a real `main` (`dist/credentials/…`, 1-05) and the
  `n8n.nodes[]`/`n8n.credentials[]` registry, but NO `files` allowlist and NO `publishConfig`
  (`:1-58`), so `npm pack` would be incorrect/bloated and would omit the bundled specs.
- **Entry.** The runnable example (`examples/repo-pr.workflow.json`) starts at the Workspace
  node (`targetRepo`/`baseBranch`/`correlationId` params) feeding the Orchestrator (`epic`
  param holds the prompt); the live entry is Manual Trigger → Workspace. There is no
  dedicated repo+prompt input affordance.

---

## Decision J — Gap A forward-aggregation mechanism: GLOBAL static data (`getWorkflowStaticData('global')`)

**CHOSEN: option (a) — global static data. Option (b) wire-based is REJECTED.**

All run-state for a correlationId lives in ONE workflow-global object every node shares:
`getWorkflowStaticData('global')['runs'][correlationId]` (a serialised `RunState`). This is
the SAME `runs[correlationId]` shape used today — only the static-data SCOPE moves from
`'node'` to `'global'`. ADR-002 Decision F's `runs[correlationId]` mechanism is preserved
verbatim; only the keying scope changes.

**Why chosen (and the trade-off vs the rejected option):**

- **Queue-mode-safe (R-27).** n8n's `'global'` static data is persisted to n8n's database and
  shared across every node AND every worker, so an Agent persisting on worker A and a
  Finaliser reading on worker B see the same state. `'node'` static data is keyed per node
  NAME (the root cause of Gap A) and is the wrong sharing boundary.
- **Smallest behaviour-preserving diff.** It is a one-token change at each of the existing
  three call sites (`'node'` → `'global'`) plus ONE new Agent persist call. It reuses
  `recordAgentResult`/`enumerateAgentResults`/`summarise`/`serialiseRunState`/`deserialiseRunState`
  UNCHANGED. No new wire contract, no envelope change, no topology change.
- **Holds the forward-only DAG (R-25).** The Agent writes FORWARD into shared state; the
  Finaliser/summary read it forward. No Agent→Orchestrator edge is added; the example
  topology `Workspace → Orchestrator(plan) → [Agent×N] → Orchestrator(summary) → Finaliser
  → Output(PR)` is unchanged — the scope move is invisible in the workflow JSON.
- **REJECTED — wire-based input-item aggregation:** the Finaliser/summary would aggregate
  `changeRef`s/results from their INPUT ITEMS. It avoids global state, but (1) it can only
  see the items wired into THAT node's single input port — partial-failure / resumable runs
  (R-05) and a summary that reads a run independent of the current item set both need the
  durable run-state, not the transient wire; (2) it would bypass `RunState`/`summarise`
  entirely, duplicating aggregation logic the transitions already own (DRY, R-31); (3) it
  would require re-wiring the example so every agent fans into one collector node. Global
  static data keeps the durable, resumable, single-source run-state the design already has.

### The exact contract the three consumers implement (T2)

The key is `correlationId` + `taskId` (`taskId` read from `envelope.input.context.taskId`,
exactly as `recordAgentResult` already does at `transitions.ts:120-122`). A shared accessor
(extracted into the run-state module to keep the node files ≤400 lines and DRY, R-31) reads
and writes `getWorkflowStaticData('global')['runs']`.

- **Agent node — WRITES (new; AC2).** After it computes its terminal envelope (the
  `{ ...agentResult, changeRef }` returned at `SoftwareTeamsAgent.node.ts:355`, and the
  non-repo path), and BEFORE pushing to `returnData`, the Agent node:
  1. `const staticData = this.getWorkflowStaticData('global')`;
  2. reads `runs[envelope.correlationId]`, `deserialiseRunState` it (skip persist if `null` —
     the plan Orchestrator must have seeded it, see Decision J-seed);
  3. `recordAgentResult(state, envelope)` (UNCHANGED transition — it records terminal
     `status` + `changeRef`, keyed by `taskId`; idempotent for an already-terminal task);
  4. `runs[envelope.correlationId] = serialiseRunState(updated)`.
  The Agent still emits its envelope on the wire unchanged (the wire carry is additive and
  preserved); persistence is in ADDITION to, not instead of, the wire emit. Only terminal
  `status` + `changeRef` enter run-state — never credentials (R-02 / AC12).
- **Finaliser — READS (re-pointed; AC4).** Change `getWorkflowStaticData('node')` →
  `getWorkflowStaticData('global')` at `SoftwareTeamsFinaliser.node.ts:184`. Then
  `deserialiseRunState(runs[correlationId])` and `enumerateAgentResults` (UNCHANGED, `:199`)
  to build the merge set. **Remove the false-trigger THROW path's premise** (`:189-197`): the
  Finaliser must no longer throw because its OWN node store is empty — on the global store the
  state is present once agents have run. (A genuinely-empty global run-state for a real
  correlationId — i.e. zero agents ran — may still be a structured failure; but the
  per-node-isolation false trigger is removed.)
- **Summary Orchestrator — READS (re-pointed; AC3).** Change
  `getWorkflowStaticData('node')` → `getWorkflowStaticData('global')` at
  `SoftwareTeamsOrchestrator.node.ts:144` (the single `staticData`/`runs` binding used by both
  the plan and summary branches). The summary branch (`:186-227`) then reads the SHARED
  `runs[resolvedId]` aggregated by distinct Agent nodes and reports per-agent results +
  outcome via `enumerateAgentResults`/`summarise` (UNCHANGED) — it no longer emits "No
  run-state found" when agents have run.

### Decision J-seed — the plan Orchestrator must seed into the SAME global store

The plan Orchestrator writes the initial `RunState` at `SoftwareTeamsOrchestrator.node.ts:144`
via `getWorkflowStaticData('node')`. T2 changes that ONE binding to
`getWorkflowStaticData('global')` so the Agent's later write lands in a state the
Finaliser/summary can read. This is the single binding shared by the plan and summary branches,
so flipping it to `'global'` fixes seeding AND the summary read together.

**The continue-run path is NOT the forward mechanism.** `SoftwareTeamsOrchestrator.node.ts:164-182`
(the `recordAgentResult` at `:169`) is the FORBIDDEN return edge — it presumes an Agent envelope
flows BACK into the Orchestrator. It stays in place and behaviourally harmless under a
forward-only DAG (it is simply never reached on the pinned topology), but it is explicitly NOT
the Gap A fix. T2 does NOT route agents back through it. (R-25.)

### Confirms no transition change

`recordAgentResult` (`:114`), `enumerateAgentResults` (`:166`), `summarise`, and
`serialiseRunState`/`deserialiseRunState` are CORRECT and UNCHANGED. The keying
(`correlationId` + `taskId`) is what these functions already use. The ONLY new logic is the
Agent-side persist (write) and the two scope flips (`'node'`→`'global'`). (R-04.)

### Aggregation-wiring note for T5 (sole owner of the example)

Under the global-static-data mechanism the example topology does NOT change — the scope move
is internal and invisible in `examples/repo-pr.workflow.json`. **T2's hand-off note to T5 is:
"NO example node-wiring change required — global static-data scope move only."** T5 edits the
example for the entry affordance (Decision N) only.

---

## Decision K — Gap B persona resolution: bundled location `dist/agents/` + both-layout `__dirname`-relative candidates

**Packaged location — CHOSEN: `dist/agents/`** (a sibling of `dist/src/`, `dist/nodes/`,
`dist/credentials/`). The specs are copied there by the build (Decision M), so the SAME `dist`
that ships the nodes ships the personas, and `__dirname`-relative resolution from the built
`single-turn.js` is a short, stable climb. Rejected alternatives: an un-built top-level
`agents/` dir (would need a separate `files` entry and a longer climb that re-introduces the
repo-vs-package ambiguity) — `dist/agents/` keeps everything under the one built tree.

### The VERBATIM `resolveAgentSpecPath` candidate list (T3 implements this literally)

At runtime `__dirname` is `<pkg>/dist/src/execution` (empirically confirmed: the file builds
to `dist/src/execution/single-turn.js`). T3 replaces the body of `resolveAgentSpecPath` with
the following ORDERED candidate list and `return candidates.find(existsSync) ?? null;`
(the graceful `null` degrade is preserved):

```ts
function resolveAgentSpecPath(agentId: string): string | null {
  const candidates = [
    // 1. Installed/packaged layout: bundled specs under dist/agents/
    //    __dirname = <pkg>/dist/src/execution  →  ../../agents  =  <pkg>/dist/agents
    join(__dirname, "..", "..", "agents", `${agentId}.md`),
    // 2. Dev layout (running from the repo): repo-root .claude/agents/
    //    climb 5 from dist/src/execution reaches the repo root (the old climb-4
    //    landed in packages/ — the off-by-one this fixes).
    join(__dirname, "..", "..", "..", "..", "..", ".claude", "agents", `${agentId}.md`),
    // 3. Dev layout fallback: repo-root agents/
    join(__dirname, "..", "..", "..", "..", "..", "agents", `${agentId}.md`),
  ];
  return candidates.find(existsSync) ?? null;
}
```

- **Candidate 1 (installed layout, AC8):** `join(__dirname, "..", "..", "agents", …)` resolves
  to `<pkg>/dist/agents/<agentId>.md` — the bundled spec, present in a fresh
  npm/custom-extensions install. This is checked FIRST so the shipped persona wins in
  production.
- **Candidates 2 & 3 (dev layout, AC8):** climb 5 (`../../../../..`) from
  `dist/src/execution` reaches the repo root `…/software-teams`, where `.claude/agents/` (33
  specs, confirmed) and an optional `agents/` live. This FIXES the climb-4 off-by-one (old
  `join(__dirname, "../../../..")` → `…/packages`). Dev resolution keeps working from a repo
  checkout. (R-28.)
- **Null degrade preserved (AC8 close):** an unknown `agentId` matches no candidate →
  `null` → `agentSpecBody` empty → bare prompt, exactly as today. The fix makes bundled specs
  FINDABLE; it does not make a missing spec fatal.

Two different known `agentId`s therefore resolve to two DIFFERENT spec files → two DIFFERENT
persona bodies (AC9). `stripSpecFrontmatter` (`:143-150`) is unchanged.

---

## Decision L — Bundled-spec SET: all 33 `software-teams-*` specs (== SPECIALIST_OPTIONS)

The set to ship is the 33 specialist specs at `.claude/agents/software-teams-*.md`. This
EQUALS `SPECIALIST_OPTIONS` one-to-one (empirically confirmed — the both-ways `comm` diff is
empty), so **lean (only SPECIALIST_OPTIONS) == all 33; there is no "lean vs all 33" choice for
T4 to make.** (R-29.)

- **Source:** `.claude/agents/software-teams-*.md` (repo root).
- **Packaged destination:** `dist/agents/software-teams-*.md` (Decision K).
- **Copy:** wired into `n8n-node build` (Decision M). Only `software-teams-*.md` is copied —
  no other `.claude/agents/*.md` (the framework/JDI specs) ship.

---

## Decision M — Spec-bundling build glue + Decision N's packaging

- **Build glue (T4).** The `package.json` `build` script (`"n8n-node build"`) gains a copy
  step that, AFTER the tsc build emits `dist`, copies `.claude/agents/software-teams-*.md` →
  `dist/agents/`. The lowest-risk shape consistent with ADR-003's no-bundler constraint is a
  tiny Node `.cjs` script (mirroring `scripts/verify-node-load.cjs`) invoked as a postbuild,
  e.g. `"build": "n8n-node build && node scripts/bundle-specs.cjs"`. It introduces NO bundler
  (esbuild/tsup) — it is a file copy. The script reads from the repo `.claude/agents/` and
  writes to `dist/agents/`, creating the dir if absent. The 1-05 node-load gate and `main`
  entry are unchanged.

---

## Decision N — Packaging: `files` allowlist + `publishConfig` (publish-READY, not published)

`packages/n8n/package.json` gains:

```jsonc
"files": [
  "dist",
  "README.md",
  "CONTRACT.md",
  "ARCHITECTURE.md",
  "LICENSE"
],
"publishConfig": {
  "access": "public"
}
```

- **`files` allowlist (AC10).** `"dist"` covers the seven built nodes
  (`dist/nodes/**/*.node.js`), the credential (`dist/credentials/…`), the compiled `dist/src/`,
  AND the bundled specs (`dist/agents/*.md`, Decision M) — so one entry ships the code AND the
  personas. Docs/licence are included for npm hygiene. Everything NOT listed —
  `nodes/`/`credentials/`/`src/` TS source, `__tests__/`, `scripts/`, `tsconfig.json`,
  `.eslintrc`, `examples/`, dev configs — is EXCLUDED from the tarball, so `npm pack` is
  correct/minimal and carries no source/test/dev cruft (R-29) and no env/secret files (R-02).
  (`package.json`, `README.md`, `LICENSE`, and `main` are always included by npm regardless.)
- **`publishConfig` (AC10).** `{ "access": "public" }` makes the scoped
  `@websitelabs/...` package publishable as public — the minimal shape that makes `npm pack`
  and a future publish correct.
- **Publish-READY only (Out of Scope).** This makes `npm pack` produce a correct/minimal
  tarball; it does NOT publish. No `npm publish`, no verified-community submission.

---

## Decision O — Entry affordance (steps 1-2): documented Form-Trigger recipe + minor additive param ergonomics

**CHOSEN: a documented Form-Trigger recipe + minor additive parameter ergonomics — NOT a new
node.** This is the lowest-risk additive option (R-30): n8n ships a first-party Form Trigger;
no new node code, registry entry, build surface, or node-load-gate entry is added.

- **The recipe (T5, documented + in the example).** A built-in n8n **Form Trigger** with three
  fields — "Target Repository" (`owner/repo`), "Base Branch" (default `main`), and "Prompt /
  Epic" — feeds the Workspace node (`targetRepo`, `baseBranch`) and the Orchestrator (`epic`)
  via n8n expressions (`{{ $json["Target Repository"] }}` etc.). Topology becomes Form
  Trigger → Workspace → Orchestrator(plan) → … with NO change to any node's contract.
- **Minor additive param ergonomics (T5, optional + additive).** If a node param needs to
  accept the form value, it is supplied via an n8n expression on the EXISTING param
  (`targetRepo`/`baseBranch`/`epic`) — no new required params, no renamed params, no changed
  defaults. Any ergonomics are purely additive (e.g. an updated param description /
  placeholder), preserving `epic` semantics (R-30).
- **Back-compat (AC11, R-30).** The existing Manual Trigger → Workspace → Orchestrator entry
  MUST keep working byte-for-byte — the Form Trigger is an ALTERNATIVE entry, additive only.
- **Example ownership.** T5 is the SOLE owner of `examples/repo-pr.workflow.json`; it adds the
  Form-Trigger recipe (and applies T2's hand-off note, which under Decision J is "no wiring
  change"). T2 does NOT touch the example.

---

## Non-goals (explicit — no implementer re-opens these)

- **No Agent→Orchestrator return edge.** Aggregation is forward-only (ADR-002 Decision F);
  the continue-run path (`Orchestrator:164-182`) is NOT the mechanism. (R-25.)
- **No bundler.** The spec-copy is a file copy (Decision M), consistent with ADR-003's
  tsc-only build. No esbuild/tsup/rollup.
- **`spawnClaude` unchanged.** It stays on `node:child_process` (ADR-003 non-goal).
- **`NodeEnvelope` unchanged.** Six top-level fields + additive `repo?`/`changeRef?` (1-04) +
  the §4 upstream-context merge are not altered. `recordAgentResult`/`enumerateAgentResults`/
  `summarise`/`serialise`/`deserialise` are unchanged.
- **Not published.** Publish-READY (`files`/`publishConfig` + correct `npm pack`) only.
- **No new node for the entry affordance** — a Form-Trigger recipe, not a node (Decision O).
- **No new "lean vs all 33" decision** — the set is the 33 `software-teams-*` specs (Decision L).

---

## Risk resolutions (downstream slices implement these verbatim)

| Risk | Resolved by (this ADR) |
|------|------------------------|
| **R-25** aggregation fix introduces an implicit return edge / breaks the DAG | Decision J: forward-only — Agent writes global static data; Finaliser/summary read it; the continue-run path is explicitly NOT the mechanism; example topology + Finaliser PR path unchanged. |
| **R-26** aggregation gate passes by mocking `getWorkflowStaticData` into one shared object | Decision J pins the global-store contract; T6 (not this slice) MUST exercise DISTINCT per-node objects (and a shared `'global'` object only for `('global')`) — a shared object for `('node')` across node names is forbidden and is itself the regression. |
| **R-27** `'global'` static data behaves differently under queue mode | Decision J chose `'global'` BECAUSE it is n8n DB-backed and shared across workers (queue-mode-safe); the rejected wire path is moot. |
| **R-28** `resolveAgentSpecPath` fixed for one layout regresses the other | Decision K pins an ORDERED candidate list covering BOTH layouts (installed `dist/agents/` first, dev repo-root `.claude/agents/`+`agents/` next); null degrade preserved. |
| **R-29** bundled specs bloat the tarball / wrong set ships | Decision L: the set is the 33 `software-teams-*` specs == SPECIALIST_OPTIONS (no ambiguity); Decision N's `files` allowlist scopes the tarball to `dist` + docs only. |
| **R-30** entry affordance breaks the existing entry / `epic` semantics | Decision O: a Form-Trigger recipe + additive-only param ergonomics, NOT a new node; existing Manual Trigger entry unchanged; `epic` semantics preserved. |
| **R-02** secrets leak via the new aggregation surface / tarball | Decision J persists ONLY terminal `status` + `changeRef` (no credentials enter run-state); Decision N's `files` allowlist excludes source/env/secret files; T8 audits run-state/global static data/summary/tarball. |

---

## Implementer checklist for T2/T3/T4/T5 (no design decisions remain)

**T2 — Gap A forward-aggregation (backend; `Agent`/`Finaliser`/`Orchestrator` nodes +
run-state module):**

1. Extract a shared global-store accessor into the run-state module (DRY, R-31): read/write
   `getWorkflowStaticData('global')['runs']`, `deserialiseRunState`/`serialiseRunState` round-trip.
2. **Agent node — add the persist (write):** after the terminal envelope is computed and BEFORE
   `returnData.push`, read the global store, `recordAgentResult(state, envelope)` (UNCHANGED
   transition), write back via `serialiseRunState`. Keyed by `correlationId` + `taskId`. Skip if
   the global state for `correlationId` is `null`. Keep the wire emit unchanged.
3. **Orchestrator — flip the scope:** `getWorkflowStaticData('node')` →
   `getWorkflowStaticData('global')` at `:144` (seeds the plan run-state AND backs the summary
   read at `:186-227`). Do NOT route agents through the continue-run path (`:164-182`).
4. **Finaliser — flip the scope + remove the false throw:** `getWorkflowStaticData('node')` →
   `getWorkflowStaticData('global')` at `:184`; the `:189-197` THROW no longer fires from
   per-node isolation (state is present on the global store once agents ran).
5. Hand-off note to T5: "NO example node-wiring change required — global static-data scope move
   only."
6. Do NOT change `recordAgentResult`/`enumerateAgentResults`/`summarise`/`serialise`/`deserialise`,
   `NodeEnvelope`, the §4 merge, or `spawnClaude`. Keep files ≤400 lines (extract the accessor).

**T3 — Gap B persona resolution (backend; `single-turn.ts` only):**

1. Replace `resolveAgentSpecPath`'s body with the VERBATIM ordered candidate list in Decision K
   (installed `join(__dirname,"..","..","agents",…)` FIRST; dev climb-5
   `.claude/agents` then `agents` next); `return candidates.find(existsSync) ?? null`.
2. Preserve the graceful `null` degrade and `agentSpecBody`'s empty-⇒-bare-prompt behaviour
   (`:198-209`). Do NOT change `stripSpecFrontmatter`, `assemblePrompt`, or `spawnClaude`.

**T4 — Packaging + spec bundling (programmer; `package.json` + `scripts/`):**

1. Add `scripts/bundle-specs.cjs`: copy `.claude/agents/software-teams-*.md` → `dist/agents/`
   (create the dir; copy ONLY `software-teams-*.md`). No bundler.
2. `package.json` `"build": "n8n-node build && node scripts/bundle-specs.cjs"`.
3. Add the `files` allowlist (`["dist","README.md","CONTRACT.md","ARCHITECTURE.md","LICENSE"]`)
   and `"publishConfig": { "access": "public" }`.
4. Keep `main`, the `n8n.nodes[]`/`n8n.credentials[]` registry, and the node-load gate unchanged.
   Do NOT publish.

**T5 — repo+prompt entry affordance (backend; example + docs, SOLE owner of the example):**

1. Add a documented Form-Trigger recipe (fields: Target Repository, Base Branch, Prompt/Epic)
   feeding Workspace (`targetRepo`/`baseBranch`) + Orchestrator (`epic`) via expressions.
2. Apply T2's hand-off note (under Decision J: no wiring change). Refresh the example/docs.
3. Keep the existing Manual Trigger → Workspace → Orchestrator entry working byte-for-byte; any
   param ergonomics are additive only (no new required params, no `epic`-semantics change).
