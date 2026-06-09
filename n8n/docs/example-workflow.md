# Example workflow: IT-support ticket → GitHub PR

This walkthrough covers the end-to-end loop demonstrated by
[`examples/it-support-pr.workflow.json`](../examples/it-support-pr.workflow.json).

**Flow:**  
ClickUp label `issues-ai` applied → Trigger Ingestion → Orchestrator → Researcher Agent → Programmer Agent → Slack HITL → GitHub Output (PR)

---

## Prerequisites

| Item | Where to set it |
|------|-----------------|
| Self-hosted n8n (Cloud not supported) | Your infrastructure |
| `claude` binary on the n8n worker `PATH` | `npm install -g @anthropic-ai/claude-code` |
| **Software Teams API** credential configured | n8n Credentials → New → Software Teams API |
| `WEBHOOK_URL` env var set to your n8n FQDN | n8n worker environment (e.g. `https://n8n.acme.com`) |
| ClickUp API token (in credential) | [app.clickup.com](https://app.clickup.com) → Settings → Apps |
| GitHub token with `repo` + PR write scopes (in credential) | [github.com/settings/tokens](https://github.com/settings/tokens) |
| Slack bot token `xoxb-…` (in credential) | [api.slack.com/apps](https://api.slack.com/apps) |

---

## Import the workflow

1. In n8n go to **Workflows → Import from file**.
2. Select `n8n/examples/it-support-pr.workflow.json`.
3. The canvas loads with seven pre-wired nodes.
4. Open each node, attach the **Software Teams API** credential, and fill in the parameters below.
5. Save and activate the workflow.

---

## Node-by-node configuration

### Node 1 — ClickUp Trigger (n8n built-in)

This is a standard n8n **ClickUp Trigger** node — not part of the Software Teams package.

| Setting | Value |
|---------|-------|
| Events | `taskUpdated` |
| Filter (label) | `issues-ai` |

When a ClickUp task gains the `issues-ai` label the trigger fires and passes the task payload downstream.

---

### Node 2 — Software Teams Trigger Ingestion

Fetches the full ClickUp task context (PII-scrubbed) and emits an initial `NodeEnvelope`.

| Parameter | Example value |
|-----------|---------------|
| Source | `ClickUp` |
| ClickUp Task Ref | `{{ $json.task.url }}` (expression — pulls from the ClickUp trigger payload) |
| Workflow Prompt | `Investigate the reported issue and propose a code fix. If you need clarification, ask.` |
| First Agent ID | `software-teams-researcher` |

**Output:** `NodeEnvelope` with a fresh `correlationId` (e.g. `run-2026-06-03-clickup-abc123`), `input.context` populated with the task details, and `status: 'ok'`.

---

### Node 3 — Software Teams Orchestrator

Takes the envelope prompt and runs one planning turn, emitting one `NodeEnvelope` per wave-task.

| Parameter | Example value |
|-----------|---------------|
| Epic / Sprint Goal | `{{ $json.input.prompt }}` |
| Correlation ID | `{{ $json.correlationId }}` (carry through from the trigger) |
| Planner Model | `Claude Sonnet 4.5 (Default)` |

**Output:** Multiple items — one per planned task — each with `agentId` set to the planned specialist. In this example the planner produces two tasks: a research task (`software-teams-researcher`) and an implementation task (`software-teams-programmer`).

> **Canvas tip:** wire the Orchestrator's output into the first Agent node. n8n processes each emitted item through the remaining chain in order. If you want wave-parallel execution, split via a Switch on `$json.agentId` and fan out.

---

### Node 4 — Software Teams Agent: Researcher

Runs `software-teams-researcher` for one turn to investigate the issue.

| Parameter | Example value |
|-----------|---------------|
| Specialist | `Researcher` |
| Prompt | `{{ $json.input.prompt }}` |
| Model | `Claude Sonnet 4.5 (Default)` |

**A→B handoff:** the node detects an upstream `NodeEnvelope` (via `correlationId` + `agentId` + `status` fields) and automatically folds the Orchestrator's `result`/`artifacts` into its own `input.context` per [CONTRACT.md §3](../CONTRACT.md). No manual expression mapping needed.

**Output:** `NodeEnvelope` with `agentId: 'software-teams-researcher'` and the research findings in `result.text`. If the researcher needs clarification, `status` is `needs-input` and `result.text` holds the question.

---

### Node 5 — Software Teams Agent: Programmer

Receives the researcher's output and implements the fix.

| Parameter | Example value |
|-----------|---------------|
| Specialist | `Programmer` |
| Prompt | `{{ $json.input.prompt }}` |
| Model | `Claude Sonnet 4.5 (Default)` |

**Output:** `NodeEnvelope` with `agentId: 'software-teams-programmer'` and the implementation summary in `result.text`. If the programmer needs a human decision (e.g. "which module should this change touch?"), `status` is `needs-input`.

---

### Node 6 — Software Teams Slack HITL

Handles any `needs-input` status from the agent chain. Operates transparently for `ok` and `error` statuses (pass-through).

| Parameter | Example value |
|-----------|---------------|
| Slack Channel | `#ai-questions` |
| Wait Timeout (Hours) | `24` |

**Ask mode** (if upstream `status === 'needs-input'`):

1. Posts the agent's question to `#ai-questions` in Slack as a Block Kit message with the `correlationId` and a reply button.
2. Persists conversation state to disk (path controlled by `HITL_STATE_PATH` env var).
3. Pauses the n8n execution — n8n serialises the execution to its DB (survives worker restarts).
4. Emits a waiting envelope with the `hitl` state block (question, Slack channel, thread timestamp, resume URL).

**Resume mode** (when a human replies via the Slack interactivity handler):

The Slack app POSTs `{ hitlAnswer: "…", correlationId: "…" }` to the signed resume URL. n8n resumes the workflow; the HITL node:

1. Loads the stored conversation state.
2. Posts a threaded `✅ Reply received` acknowledgement to Slack.
3. Merges the human's answer into `input.context` under the `hitl` key.
4. Re-invokes `runAgentTurn` (Task tool disabled — AC2) directly with the merged context.
5. Emits the continued `NodeEnvelope` downstream.
6. Deletes the persisted state.

**Pass-through mode** (`ok` / `error`): passes the envelope unchanged directly to the GitHub Output node.

> **Slack app setup:** configure the Slack app's **Interactivity Request URL** to `https://n8n.yourdomain.com/webhook/<id>` where `<id>` is your Slack webhook node ID. The interactivity handler must forward `hitlAnswer` and `correlationId` to the n8n resume URL. See the [Slack API docs on Block Kit actions](https://api.slack.com/messaging/interactivity).

---

### Node 7 — Software Teams Output (GitHub PR)

Opens a GitHub pull request with the final agent result.

| Parameter | Example value |
|-----------|---------------|
| Output Mode | `Pull Request (Default)` |
| Target Repository | `acme/myapp` |
| Base Branch | `main` |
| Title | (leave blank — defaults to `[Software Teams] {correlationId}`) |

The node looks for a `branch` artifact in the upstream envelope (added by the Programmer Agent when it creates a feature branch). If no branch artifact is found it falls back to opening a GitHub issue with a note explaining the fallback.

**Output:** `NodeEnvelope` with the PR URL appended to `artifacts`:
```json
{ "type": "pr", "url": "https://github.com/acme/myapp/pull/42" }
```

---

## Data flow summary

```
ClickUp Trigger
  │  { task.url, task.name, … }
  ▼
Trigger Ingestion ──── reads: ClickUp token (credential)
  │  NodeEnvelope { correlationId, status:'ok', input.context: <ticket detail> }
  ▼
Orchestrator ────────── reads: ANTHROPIC_API_KEY (credential)
  │  [NodeEnvelope×N] one per planned task, in wave order
  ▼
Agent: Researcher ───── reads: ANTHROPIC_API_KEY (credential)
  │  NodeEnvelope { agentId:'software-teams-researcher', result.text: <findings> }
  ▼
Agent: Programmer ───── reads: ANTHROPIC_API_KEY (credential)
  │  NodeEnvelope { agentId:'software-teams-programmer', status:'ok'|'needs-input', result.text: <fix summary> }
  ▼
Slack HITL ─────────── reads: Slack bot token (credential)
  │  (pass-through if status='ok'; ask+wait+resume if status='needs-input')
  │  NodeEnvelope { status:'ok', result.text: <final answer> }
  ▼
GitHub Output ──────── reads: GitHub token (credential)
  │  NodeEnvelope { artifacts: […, { type:'pr', url:'https://github.com/…/pull/42' }] }
  ▼
  (end)
```

---

## Acceptance check (AC10)

After importing and configuring:

1. Apply the `issues-ai` label to a ClickUp task.
2. The workflow executes: trigger fires → context fetched → plan generated → two agent turns → Slack question posted (if `needs-input`) → PR opened.
3. Verify the PR appears in the target GitHub repository with the agents' result as the body.
4. If `needs-input` was triggered, reply in the Slack thread and verify the agent resumes and the PR opens after your reply.

> **AC10 is user-gated:** the live-run import/run acceptance point requires a configured self-hosted n8n instance. The structural export artifact (`it-support-pr.workflow.json`) validates automatically — see the README for the JSON validity check command.
