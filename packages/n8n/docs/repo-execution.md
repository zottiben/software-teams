# Repo-scoped execution: repo + prompt → real code changes → PR

This document covers the end-to-end flow of the **repo-scoped execution** path, which adds two new
nodes — **Software Teams Workspace** and **Software Teams Finaliser** — to the existing five-node
canvas. Together they enable the headline use case: point a workflow at a GitHub repository, supply
a prompt, and have Software Teams agents write real code changes that land as a PR.

**Flow summary:**

```
repo + prompt
  │
  ▼
Software Teams Workspace    (clone + worktree per agent)
  │  NodeEnvelope with additive repo descriptor on envelope
  ▼
Software Teams Orchestrator (plan epic into wave-tasks)
  │  [NodeEnvelope × N] — one per planned task
  ▼
Software Teams Agent(s)     (one specialist per node, isolated worktree, real file changes)
  │  each agent persists its changeRef + status → run-state (workflow static data)
  ▼
Software Teams Finaliser    (merge all agents, resolve conflicts ≤3 turns, push branch)
  │  branch artifact emitted
  ▼
Software Teams Output       (opens PR — branch artifact drives the PR path, not issue fallback)
```

See [`examples/repo-pr.workflow.json`](../examples/repo-pr.workflow.json) for an importable
end-to-end workflow wiring all seven nodes, fronted by an additive Form Trigger that supplies the
repo + prompt (see [Providing the repo + prompt](#providing-the-repo--prompt-entry-affordance-for-steps-12)).

---

## Prerequisites

This flow requires a **self-hosted n8n** instance (n8n Cloud is not supported — see below) with
the following binaries on the worker's `PATH`:

| Binary | Purpose | How to satisfy |
|--------|---------|----------------|
| `claude` | Runs every agent turn | `npm install -g @anthropic-ai/claude-code` |
| `git` | Clone, worktree, apply patches | System package manager or [git-scm.com](https://git-scm.com) |
| `gh` | Push feature branch + open PR | `brew install gh` or [cli.github.com](https://cli.github.com) |

**Fail-fast:** each of the three binaries is verified at the start of the node that first needs it.
The Workspace node verifies `git` before cloning; the Finaliser node verifies `gh` before pushing.
If either binary is missing the node fails immediately with a descriptive error — it never silently
continues and leaves a partial state.

> **n8n Cloud is not supported.** Inline `claude`, `git`, and `gh` execution require access to
> the worker filesystem; n8n Cloud forbids arbitrary binary execution.

---

## The seven-node flow

### Step 1 — Software Teams Workspace

**Node type:** `softwareTeamsWorkspace`

The Workspace node is the entry point for repo-scoped runs. It establishes the run's repository
checkout and seeds the repo descriptor onto the envelope so every downstream node knows what repo
it is working against.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| Target Repository | `owner/repo` (e.g. `acme/myapp`) or a full HTTPS/SSH clone URL |
| Base Branch | Branch to base all agent work on (e.g. `main`). All worktrees fork from here. |
| Correlation ID | Leave blank to auto-generate; or carry through an upstream `correlationId` to continue an existing run |

**What it does:**

1. Validates `git` is on `PATH` (fail-fast, R-01).
2. Validates and sanitises the `Target Repository` and `Base Branch` inputs against shell-injection
   patterns (R-08).
3. Performs a **shallow clone** of `baseBranch` into a run-scoped checkout directory on the
   current worker (shallow clone reduces cost and latency — R-03).
4. For each downstream Agent node turn, a **`git worktree`** is forked from that checkout so
   parallel or sequential agents never collide on the same index or working tree.
5. Writes the non-secret repo coordinates (`cloneUrl`, `ownerRepo`, `baseBranch`) onto an additive
   `repo` field on the outbound `NodeEnvelope` — the DAG canvas has no other channel for seeding
   these downstream.

**What it does not do:** it does not embed the GitHub token in the clone URL or the envelope. The
token lives only in the `SoftwareTeamsApi` credential and is injected into the child process env
at execution time (R-02).

#### Providing the repo + prompt (entry affordance for steps 1–2)

There are two interchangeable ways to supply the repo and the prompt that drive a run. Both reach
the same Workspace → Orchestrator path — pick whichever suits the trigger you want.

**A. Manual entry (default).** Run the Workspace node directly and type the values into its
literal parameters: `Target Repository`, `Base Branch`, and the prompt the Orchestrator plans
from. This is the original entry path and is unchanged.

**B. Form-Trigger recipe (additive, alternative).** Front the workflow with a built-in n8n
**Form Trigger** so the run is kicked off from a submitted form instead of hard-coded parameters.
This adds **no Software Teams node** and changes **no node contract** — it is a first-party n8n
trigger wired in front of the existing nodes. The
[`examples/repo-pr.workflow.json`](../examples/repo-pr.workflow.json) ships this recipe as the
`Repo + Prompt (Form Trigger)` node.

Configure the Form Trigger with three fields. Every repo/prompt consumer references the Form node
by name with `.first()` rather than `$json`/`.item`, so the values stay readable after the
Orchestrator fan-out and the summary aggregation:

| Form field | Type | Feeds | Expression on the consuming param |
|------------|------|-------|-----------------------------------|
| Target Repository | text (required) | Workspace `targetRepo`, Finaliser `ownerRepo`, Output `targetRepo` | `{{ $('Repo + Prompt (Form Trigger)').first().json["Target Repository"] }}` |
| Base Branch | text (optional, default `main`) | Workspace / Finaliser / Output `baseBranch` | `{{ $('Repo + Prompt (Form Trigger)').first().json["Base Branch"] \|\| "main" }}` |
| Prompt / Epic | textarea (required) | Orchestrator(plan) `epic` | `{{ $('Repo + Prompt (Form Trigger)').first().json["Prompt / Epic"] }}` |

Wire the Form Trigger into the existing Workspace node. The form's submitted values are read by
the existing `targetRepo`/`baseBranch`/`epic` and the Finaliser's `ownerRepo` parameters through
the expressions above — no new required parameters, no renames, no changed defaults, and `epic`
keeps its existing semantics (the planning prompt). The Orchestrator's `epic` references the Form
node directly because the **Workspace does not carry the prompt forward** — its emitted
`input.prompt` is empty; it only seeds `correlationId` and the `repo` descriptor. The Orchestrator's
`correlationId` is read from the Workspace envelope (`{{ $json.correlationId }}`). The Finaliser has
**no `correlationId` parameter** — it reads the run id from its inbound `NodeEnvelope` at runtime.
The topology becomes Form Trigger → Workspace → Orchestrator(plan) → …, identical from the
Workspace node onward, and the only value a user hand-edits is the credential id.

Both entries are interchangeable: the Form Trigger is an alternative front-end, not a replacement,
so the manual entry continues to behave exactly as before.

---

### Steps 2–3 — Orchestrator and Agent nodes

These two nodes are unchanged from the existing five-node canvas. In a repo-scoped run they gain
access to the `repo` descriptor on the envelope:

- The **Orchestrator** receives the envelope's `correlationId` and `input.prompt` and emits one
  envelope per planned task in wave order, exactly as before.
- Each **Agent node** constructs a local `RepoContext` from `envelope.repo` + `correlationId`,
  creates a fresh `git worktree` for its own turn, passes the worktree path as the `cwd` to
  `runAgentTurn`, and — after its turn completes — captures its file changes as a portable
  `changeRef` (base64 `git format-patch` bytes). The `changeRef` is aggregated forward into the
  Orchestrator's run-state on workflow static data (keyed by `correlationId`) for the Finaliser
  to read. Each agent also tears down its worktree after writing the `changeRef`.

---

### Step 4 — Software Teams Finaliser

**Node type:** `softwareTeamsFinaliser`

The Finaliser is the merge terminus. It reads all agents' changes from run-state, merges them
onto a single feature branch, guarantees a conflict-free result (bounded), pushes the branch, and
emits the `branch` artifact the Output node consumes to open a PR.

**Inputs the Finaliser reads:**

- The inbound `NodeEnvelope` (carries `correlationId`).
- The aggregated run-state from workflow static data (`runs[correlationId]`) — one entry per agent
  turn, each containing `{ status, changeRef, detail }`.

**Behaviour:**

1. Verifies `gh` is on `PATH` (fail-fast, R-01).
2. Reads every task's `changeRef` from `runs[correlationId]`.
3. Applies the `changeRef` patches onto a fresh feature branch off `baseBranch`, in a stable order
   (wave ascending, then `taskId` ascending), using `git apply` / `git am`.
4. **Bounded conflict-resolver:** if git's automatic apply produces a conflict:
   - Runs a `claude` conflict-resolver turn (single-turn, Task disabled) over the conflicted files.
   - Checks the result for conflict markers.
   - Repeats up to a **maximum of 3 resolver turns**.
   - As soon as a marker-free, conflict-free tree is reached it commits and proceeds.
   - If the bound is exceeded the Finaliser **fails cleanly** with a structured error that surfaces
     the **conflicting file list** — it never loops indefinitely and never pushes a branch
     containing conflict markers (resolves R-16).
5. Commits the merged work.
6. Pushes a feature branch named `st/<correlationId>` to the target repo.
7. Synthesises a **run summary**: what each agent did, which files changed, the pushed branch,
   and the PR (once opened). The summary rides the envelope `result.text` and is included in the
   PR body (AC8).
8. Emits a `branch` artifact in the shape `extractBranchName`/`resolveOutputRef` consume
   (`{ type: 'branch', url: 'https://github.com/owner/repo/tree/<branch>' }`), ensuring the
   Output node takes the PR path instead of the issue fallback (resolves R-17).

---

### Step 5 — Software Teams Output

Unchanged from the existing canvas. In a repo-scoped run the `branch` artifact emitted by the
Finaliser guarantees this node opens a **PR** against the target repository — the issue fallback
is not triggered.

---

## RepoContext and on-envelope `repo` descriptor

The `RepoContext` interface is the typed description of the run's repository checkout:

```ts
interface RepoContext {
  cloneUrl: string;     // HTTPS/SSH clone URL. Never contains an embedded token.
  ownerRepo: string;    // Validated "owner/repo" used for gh/PR addressing.
  baseBranch: string;   // Branch the run is based on.
  correlationId: string; // ADR-001 run ID; join key for run-state + aggregation.
  worktreePath: string; // Absolute path to THIS turn's isolated git worktree.
  changeRef?: ChangeRef; // Absent until the turn produces a change.
}
```

`RepoContext` is **never serialised onto the wire** — it is constructed locally by each node that
needs it and passed as a typed optional parameter to `runAgentTurn(input, repoContext?)`.

The non-secret repo coordinates (`cloneUrl`, `ownerRepo`, `baseBranch`) are written to the
additive optional `repo` field (`RepoDescriptor`) on the `NodeEnvelope` by the Workspace node.
This lets downstream Agent nodes read them from the canvas wire without a shared side-channel.
The `repo` field is a top-level sibling of `input` and is never read by `assemblePrompt`, so it
cannot bleed into the model prompt (resolves R-18).

---

## Portable change artifact (`changeRef`) and queue-mode safety

Each agent's file changes are captured as a **single canonical, self-contained artifact**:

```ts
interface ChangeRef {
  kind: 'format-patch';              // Discriminant — the one canonical form.
  patchBase64: string;               // base64 of `git format-patch` output.
}
```

The `changeRef` is carried on the `RunTaskState` entry in workflow static data, not on the
envelope wire. Any worker can reconstruct the change with `git apply` / `git am` of the decoded
bytes — **no shared volume is required** and **no shared `/tmp` is assumed**.

This makes the run **queue-mode-safe**: n8n queue mode dispatches items across multiple workers.
Because the change lives as base64 bytes in the run-state (backed by n8n's database), a worker
re-dispatch mid-run cannot lose it. The Finaliser reconstructs all agents' changes from the
run-state regardless of which worker produced each one (resolves R-15).

**Shared volume:** not required and not assumed. A shared volume between workers would give a
smaller envelope (a commit SHA instead of patch bytes) but would reintroduce a single-worker /
shared-storage assumption. The portable patch representation is the deliberate choice.

---

## Bounded conflict-resolution guarantee

The Finaliser guarantees a **conflict-free, marker-free merged branch** within a bounded number
of attempts, or fails cleanly:

- **Within bound (up to 3 resolver turns):** as soon as git plus the claude resolver produces a
  clean, buildable tree the Finaliser commits and pushes. The result is always marker-free before
  push.
- **Bound exceeded (> 3 resolver turns without a clean tree):** the Finaliser fails with a
  structured error that includes the **conflicting file list**. The run summary surfaces the
  list to the human. No branch is pushed, no infinite loop runs.

This is a defined outcome — not a system failure. A conflict that exceeds 3 resolver turns
typically means the agents made large, incompatible structural changes that need human review.

---

## Cost and latency

A repo-scoped run incurs additional time and API calls beyond the base agent turns:

| Step | Cost driver |
|------|-------------|
| Workspace: shallow clone | ~1–10 s depending on repo size and network |
| Orchestrator turn | 1 claude API call (planning) |
| Each Agent turn | 1 claude API call + git worktree setup/teardown |
| Finaliser: apply + push | git I/O only, no claude call (unless conflicts) |
| Finaliser: each conflict-resolver turn | 1 claude API call (up to 3) |
| Total API calls (typical 2-agent run, no conflicts) | 3 calls (planner + 2 agents) |
| Total API calls (worst case: 2 agents + 3 resolver turns) | 6 calls |

Use `claude-haiku-3-5` on the Orchestrator for cheap planning and `claude-sonnet-4-5` (default)
for Agent turns where substantive coding work happens (R-03).

---

## Secret handling

The GitHub token is **never** part of the `RepoContext`, the `repo` descriptor, or any envelope
field. It is injected from the `SoftwareTeamsApi` credential into the child process environment
(`GITHUB_TOKEN`) at execution time only — mirroring the `ANTHROPIC_API_KEY` pattern. It never
appears in node output, execution logs, or the model prompt (resolves R-02, AC11).
