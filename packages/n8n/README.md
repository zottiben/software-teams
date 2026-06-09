# @websitelabs/n8n-nodes-software-teams

Software Teams specialist agents as first-class n8n community nodes.  
Runs one Claude specialist per node, hands off via the canvas, and pauses for human review in Slack — no separate server required.

---

## ⚠️ Self-hosted n8n — required

This package **only works on self-hosted n8n**. It executes the `claude` binary inline on the n8n worker process; n8n Cloud forbids arbitrary binary execution and is not supported.

**Every n8n worker that will run these nodes must have:**

| Requirement | How to satisfy |
|-------------|----------------|
| `claude` binary on `PATH` | `npm install -g @anthropic-ai/claude-code` (or your platform's package manager) |
| `ANTHROPIC_API_KEY` available to the worker | Set in the **Software Teams API** credential (see below) |

If the `claude` binary is missing at execution time the node fails fast with a descriptive error message — it will never silently degrade.

> **Cost / latency note (R-03):** Each Agent node makes one full `claude -p` invocation against the Anthropic API. A multi-agent workflow (Orchestrator → 2 agents → HITL) can make 3–5 API calls, each potentially consuming hundreds of tokens. Model selection per node lets you trade quality for cost — use `claude-haiku-3-5` for cheap triage passes and `claude-sonnet-4-5` (default) or `claude-opus-4` for substantive work. Review Anthropic's pricing before deploying high-volume workflows.

---

## Install

In your self-hosted n8n instance:

1. Go to **Settings → Community Nodes → Install**.
2. Enter the package name:

   ```
   @websitelabs/n8n-nodes-software-teams
   ```

3. Accept the security prompt and wait for the install to complete.
4. The five nodes (Agent, Trigger Ingestion, Orchestrator, Slack HITL, Output) appear in the **Software Teams** section of the node palette.
5. Create and configure the **Software Teams API** credential (see below).

> **CLI alternative:** on the worker host run `npm install @websitelabs/n8n-nodes-software-teams` in n8n's `~/.n8n/nodes/` custom-nodes directory, then restart n8n.

---

## Software Teams API credential

All secrets are stored in n8n's encrypted credential store and injected into the `claude` child process at runtime. **Secrets are never accepted as node parameters** and are never written to node output, execution logs, or the data envelope (R-02).

Create the credential at **Credentials → New → Software Teams API**.

| Field | Required | Description |
|-------|----------|-------------|
| **Anthropic API Key** | **yes** | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/). Injected as `ANTHROPIC_API_KEY` into the `claude` subprocess. |
| **ClickUp API Token** | for ClickUp triggers | ClickUp personal API token. Used by the Trigger Ingestion node to fetch ticket context. |
| **Datadog API Key** | for Datadog triggers | Datadog API key for issue context fetch. |
| **Datadog Application Key** | for Datadog triggers | Required alongside the API key for certain Datadog endpoints. |
| **GitHub Token** | for GitHub output | Personal access token (or fine-grained PAT) with `repo` + PR write scopes. Used by the Output node to open PRs and issues. |
| **Slack Bot Token** | for Slack HITL | Bot OAuth token (`xoxb-…`). Required by the Slack HITL node to post questions and handle resume. |

After saving, n8n will test the Anthropic key by listing available models. A ✓ confirms connectivity.

---

## Nodes

All five nodes share the **Software Teams API** credential and pass a single typed `NodeEnvelope` object between them. See [`CONTRACT.md`](./CONTRACT.md) for the full inter-node data contract.

### Software Teams Trigger Ingestion

**Purpose:** Fetches context from a ClickUp ticket or Datadog issue and emits an initial `NodeEnvelope` — the starting point of every Software Teams workflow.

Place this node **after** a native n8n ClickUp, Datadog, or Schedule trigger; it enriches the upstream data with PII-scrubbed ticket/issue context.

| Port | Direction | Type | Notes |
|------|-----------|------|-------|
| (none) | Input | — | No input port; receives data from n8n trigger node before it |
| Main | Output | `NodeEnvelope` | Fresh envelope with `correlationId`, `status: 'ok'`, and `input.context` populated from the fetched ticket/issue |

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| Source | `ClickUp` or `Datadog` |
| ClickUp Task Ref | Task URL or bare task ID (supports n8n expressions) |
| Datadog Issue URL | Issue URL with `issueId` param (supports n8n expressions) |
| Workflow Prompt | Initial task instruction for the first downstream Agent node |
| First Agent ID | Specialist hint for the first downstream node (e.g. `software-teams-researcher`) |

If the credential keys are missing or the ref is unreachable the node proceeds with `context: null` and logs a diagnostic — it does not block the workflow.

---

### Software Teams Agent

**Purpose:** Runs exactly **one** Software Teams specialist for **one** turn via the `claude` CLI (Task tool disabled — AC2). Wire multiple Agent nodes A → B for multi-agent handoff; each hop passes the upstream result in `input.context`.

| Port | Direction | Type | Notes |
|------|-----------|------|-------|
| Main | Input | `NodeEnvelope` or any | When the input carries a valid envelope (has `correlationId` + `agentId` + `status`), the node folds the upstream `result`/`artifacts` into `input.context`. First-node mode uses the optional Context parameter. |
| Main | Output | `NodeEnvelope` | Completed envelope; `status` is `ok`, `error`, or `needs-input`. Route on `{{ $json.status === 'needs-input' }}` to feed the Slack HITL node. |

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| Specialist | Which Software Teams specialist to invoke (dropdown — 33 options including Frontend Engineer, Researcher, Programmer, UX Designer, QA Tester, …) |
| Prompt | Task instruction for this turn. Supports n8n expressions. |
| Context (JSON) | Optional JSON context for the first node in a chain; ignored when an upstream envelope is present |
| Model | `claude-sonnet-4-5` (default), `claude-opus-4`, or `claude-haiku-3-5` |

---

### Software Teams Orchestrator

**Purpose:** Accepts an epic/sprint goal, runs a planning turn as `software-teams-planner`, and **emits one `NodeEnvelope` per wave-task** in dependency order — the canvas delegation mechanism. Downstream Agent nodes consume these items (static wiring or a Switch keyed on `agentId`). Also bubbles `needs-input` and `error` envelopes from sub-agents up to the Slack HITL / error branch.

| Port | Direction | Type | Notes |
|------|-----------|------|-------|
| Main | Input | `NodeEnvelope` or plain | Upstream trigger/ingestion output. A `needs-input` or `error` envelope is passed through unchanged for HITL/error routing. |
| Main | Output | `NodeEnvelope[]` | One item per wave-task, each a full envelope with the task prompt and `agentId` preset to the planned specialist. Also includes a `run` meta-block (`correlationId`, `taskCount`). |

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| Epic / Sprint Goal | The epic, user story, or project goal to plan. Supports n8n expressions. |
| Correlation ID | Leave blank to auto-generate. Reuse an upstream envelope's `correlationId` to continue an existing run. |
| Planner Model | Claude model for the planning turn |

Run state (waves, task statuses) is persisted to workflow static data keyed by `correlationId` so partial failures are resumable (R-05).

---

### Software Teams Slack HITL

**Purpose:** Implements the ask → wait → resume state machine (AC7). When an upstream Agent emits `status: 'needs-input'`, this node posts the question to Slack (Block Kit, threaded, with the `correlationId`), pauses the n8n workflow execution, and on resume re-runs the same agent with the human's Slack reply folded into context.

Three execution modes determined at runtime:

| Mode | Trigger | What happens |
|------|---------|--------------|
| **Ask** | Input envelope `status === 'needs-input'` | Posts question to Slack, persists state, calls `putExecutionToWait()` |
| **Resume** | Input has `hitlAnswer` + `correlationId` fields (from Slack interactivity webhook) | Loads stored state, re-invokes `runAgentTurn`, emits continued envelope |
| **Pass-through** | `status === 'ok'` or `'error'` | Passes envelope unchanged |

| Port | Direction | Type | Notes |
|------|-----------|------|-------|
| Main | Input | `NodeEnvelope` | See modes above |
| Main | Output | `NodeEnvelope` | Ask mode: waiting envelope with `hitl` state block. Resume mode: continued agent envelope. |

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| Slack Channel | Channel ID (`C0123456`) or name (`#ai-questions`) |
| Wait Timeout (Hours) | Max hours to wait before execution times out (default 24) |

> **Self-hosted requirement:** set `WEBHOOK_URL=https://n8n.yourdomain.com` on the n8n worker so the signed resume URL is reachable from Slack's servers. `localhost:5678` will not work.

---

### Software Teams Output

**Purpose:** Terminal node — reads the final `NodeEnvelope` and opens a **GitHub PR** (default) or **GitHub issue** with the agents' result. Appends the created URL to `artifacts` and passes the envelope downstream for further processing or logging.

| Port | Direction | Type | Notes |
|------|-----------|------|-------|
| Main | Input | `NodeEnvelope` | Must carry a valid envelope (`correlationId` required). PR mode also needs a `branch` artifact from an upstream agent; falls back to an issue if absent. |
| Main | Output | `NodeEnvelope` | Envelope with the PR/issue URL appended to `artifacts`. `status: 'error'` if GitHub rejects the PR. |

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| Output Mode | `Pull Request (Default)` or `Issue` |
| Target Repository | `owner/repo` format, e.g. `acme/myapp` |
| Base Branch | Branch the PR merges into (default `main`; PR mode only) |
| Title | PR/issue title. Defaults to `[Software Teams] {correlationId}` when blank. |
| Issue Labels | Comma-separated labels (Issue mode only; must already exist in the repo) |

---

## Inter-node data contract

Every node emits and accepts a single `NodeEnvelope` JSON object:

```ts
interface NodeEnvelope {
  correlationId: string;               // Stable run ID — carried unchanged node-to-node
  agentId: string;                     // e.g. "software-teams-frontend"
  status: 'ok' | 'error' | 'needs-input';
  input: { prompt: string; context: unknown };
  result: { text: string };
  artifacts: Array<{ type: string; url?: string }>;
}
```

See **[`CONTRACT.md`](./CONTRACT.md)** for the full normative contract, field invariants, producer/consumer rules, the upstream-context merge strategy, and worked examples of A→B handoff.

---

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design decision record covering node style, the single-turn execution model, and canvas handoff.

---

## Risks

| ID | Risk | Mitigation |
|----|------|------------|
| R-01 | Inline `claude` execution requires the binary on the self-hosted worker | Documented above; node fails fast with a clear error on missing binary |
| R-02 | API keys must not leak into node output/logs | All tokens stored in the `SoftwareTeamsApi` credential; never in node parameters or the envelope |
| R-03 | One `claude` call per agent node → cost & latency per workflow run | Single-turn execution caps per-node work; per-node model selection; see cost/latency note above |

---

## Example workflow

See [`docs/example-workflow.md`](./docs/example-workflow.md) for a step-by-step walkthrough of the ClickUp label → Orchestrator → two agents → Slack HITL → GitHub PR end-to-end loop.

Import the ready-made workflow from [`examples/it-support-pr.workflow.json`](./examples/it-support-pr.workflow.json).

---

## No-Install Alternative (Manual / CLI Recipe)

If you **cannot install the community-node package** (n8n Cloud, locked worker node directory,
or simply want to try Software Teams before committing to an install), use the
**manual CLI recipe** instead:

- **Docs:** [`n8n/MANUAL-RECIPE.md`](./MANUAL-RECIPE.md) — Execute Command command strings,
  secrets-via-env, security notes, self-hosted constraint.
- **Example workflow:** [`n8n/examples/manual-recipe.workflow.json`](./examples/manual-recipe.workflow.json)
  — importable built-in-node-only workflow (Execute Command + Code + IF), no package required.

The same underlying engine powers both modes; the manual recipe is a thin CLI surface
(`software-teams ingest | agent-turn | orchestrator-turn | output`) over it.
