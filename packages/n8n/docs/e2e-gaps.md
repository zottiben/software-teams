# End-to-end integration: PR-feedback re-entry, multi-channel HITL, and merge-triggered cleanup

This document covers the three new nodes that close the Software Teams n8n end-to-end
integration gaps (plan `1-01-n8n-e2e-gaps`):

- **Software Teams PR Feedback** — reads GitHub PR review comments back into a running workflow
- **Software Teams HITL** — multi-channel (Slack, Discord, Email, notify) multi-round HITL
- **Software Teams Cleanup** — idempotent post-merge teardown of all run state

See [`ARCHITECTURE.md`](../ARCHITECTURE.md) ADR-005 for the full decision record, and
[`CONTRACT.md`](../CONTRACT.md) §7 for the additive envelope fields (`feedback`, `hitlChannel`,
and the PR-correlation tag).

---

## PR-feedback re-entry (AC2)

### How the PR-tag mechanism works

When the Output node opens a GitHub PR, it stamps a machine-parseable `correlationId` tag into
the PR body as an invisible HTML comment:

```
<!-- software-teams:correlationId=run-2026-06-03-CU-4821 -->
```

Two canonical helpers from the shared contract (`packages/cli/src/contract/envelope.ts`) own
this encoding:

| Helper | Used by | Purpose |
|--------|---------|---------|
| `buildCorrelationTag(correlationId)` | Output node | Writes the tag into the PR body |
| `parseCorrelationTag(body)` | PR-Feedback + Cleanup nodes | Extracts the `correlationId` from a PR body |

Round-trip invariant: `parseCorrelationTag(buildCorrelationTag(id)) === id` for any non-empty
`id` that contains no whitespace or `>` (asserted in the contract tests).

### PR Feedback node flow

```
GitHub PR review event (webhook)
  │
  ▼
SoftwareTeamsPrFeedback node
  │  1. Parse correlationId from PR body tag (parseCorrelationTag)
  │  2. Fetch PR review comments via GitHub API (GitHub Token from credential)
  │  3. Categorise comments via `feedback --json` CLI
  │  4. Emit continue-run NodeEnvelope with original correlationId + feedback.comments
  │
  ▼
SoftwareTeamsOrchestrator (continue-run path)
  │  The existing forward-only continue path at Orchestrator.node.ts:164-182
  │  receives the PR-feedback envelope and merges it into the run.
  ▼
  … (normal forward flow)
```

The PR-Feedback node is a **webhook-triggered source node** — not a return edge from an agent
to the Orchestrator. The forward-only DAG invariant (ADR-001 Decision C) is preserved.

### Canvas wiring

1. Add an n8n **GitHub trigger** node configured for `pull_request_review` events.
2. Wire it into the `SoftwareTeamsPrFeedback` node.
3. Wire the `SoftwareTeamsPrFeedback` output into the `SoftwareTeamsOrchestrator` node's
   continue-run input.
4. Set the Orchestrator's `Correlation ID` parameter to:
   ```
   {{ $json.correlationId }}
   ```

The `feedback.comments` field on the envelope carries the categorised review comments as
`FeedbackComment[]` (see CONTRACT.md §7.2). The Orchestrator's `software-teams-quality`
quality review pass reads them when deciding whether to refine the plan.

---

## Multi-channel, multi-round HITL (AC3, AC4)

### Channel selection

The `SoftwareTeamsHitl` node supports four HITL channels:

| Channel | Token source | Priority |
|---------|-------------|---------|
| `discord` | `discordBotToken` from `SoftwareTeamsApi` credential | **Default** — priority for the first live test |
| `slack` | `slackBotToken` from `SoftwareTeamsApi` credential | Explicit selection |
| `email` | `smtpUrl` from `SoftwareTeamsApi` credential | Explicit selection |
| `notify` | n8n native notification (no extra token) | Explicit selection |

Channel is selected in this order:
1. The `Channel` node parameter (explicit override always wins).
2. The optional `hitlChannel` field on the inbound envelope (hint from an upstream node, see
   CONTRACT.md §7.3).
3. Default: `discord`.

All channel tokens are read from the `SoftwareTeamsApi` credential — never from node
parameters, the envelope, or any logged field (AC8).

### Multi-round state machine

Unlike the legacy `SoftwareTeamsSlackHitl` node (which deletes state on the first resume),
`SoftwareTeamsHitl` re-parks state after each resume cycle, enabling genuine back-and-forth:

```
Agent emits status: 'needs-input'
  │
  ▼
SoftwareTeamsHitl — Ask mode
  │  saveState(correlationId, { envelope, agentSpec, ... })
  │  post question on selected channel
  │  putExecutionToWait()
  ▼
  (human replies)

SoftwareTeamsHitl — Resume mode
  │  loadState(correlationId)
  │  runAgentTurn(envelope with human reply in context)
  │
  ├── Agent asks another question (status: 'needs-input')
  │   │  saveState again   ← re-park for next round
  │   │  post follow-up on channel
  │   └  putExecutionToWait()
  │
  └── Agent completes (status: 'ok' or 'error')
      │  deleteState is NOT called here — Cleanup node owns that
      └─ emit terminal envelope → continue forward flow
```

State is cleaned up by the `SoftwareTeamsCleanup` node on merge (not on resume).

### Canvas wiring

Wire any upstream Agent node's output through `SoftwareTeamsHitl` the same way you would
wire through the legacy `SoftwareTeamsSlackHitl`:

```
Agent node
  │ (routes status: 'needs-input' to HITL)
  ▼
SoftwareTeamsHitl
  │
  ▼
next node (if status was 'ok' or 'error')
```

**Credential setup:** add `discordBotToken` (and optionally `smtpUrl` or `slackBotToken`) to
the `SoftwareTeamsApi` credential before using the corresponding channel.

**Webhook URL:** set `WEBHOOK_URL=https://n8n.yourdomain.com` on the n8n worker so the
signed resume URL is reachable from Discord/Slack/email servers. `localhost:5678` will not work.

---

## Merge-triggered cleanup (AC5)

### What gets cleaned up

When a PR that was opened by a Software Teams workflow is merged, the `SoftwareTeamsCleanup`
node removes all associated state — making the workflow immediately reusable for a new task:

| Resource | Cleanup operation |
|----------|------------------|
| Run-state | `deleteRunState(correlationId)` — removes `runs[correlationId]` from workflow global static data |
| Conversation state | `deleteState(correlationId)` — removes the HITL resume record |
| Git worktrees | `worktree-remove` CLI primitive for each worktree scoped to the run |
| Repo clone | Removes the shallow clone the Workspace node created |
| Agent memories | Clears per-agent memory files scoped to the `correlationId` |
| Plan / task artefacts | Removes `.software-teams/` plan and task files for the run |

**Idempotency:** each step is a no-op if the resource no longer exists. Running Cleanup twice
for the same `correlationId` is safe.

**Merge-only:** the Cleanup node verifies (via the GitHub API) that the PR was MERGED before
proceeding. A PR that was closed without merging does NOT trigger cleanup.

### Canvas wiring

1. Add an n8n **GitHub trigger** node configured for `pull_request` events with action `closed`.
2. Wire it into the `SoftwareTeamsCleanup` node.
3. Set the `Correlation ID` parameter to the result of parsing the PR body:

   ```
   {{ parseCorrelationTag($json.pull_request.body) }}
   ```

   (Or use a Code node to call `parseCorrelationTag` if the expression context does not have
   the helper available — the function is exported from `@websitelabs/software-teams`.)
4. Set the `Repository` parameter to `{{ $json.repository.full_name }}`.

### Credential requirement

The Cleanup node uses the `GitHub Token` from the `SoftwareTeamsApi` credential to verify merge
status. The same credential used by the Output and PR-Feedback nodes — no additional credential
setup is required if those are already configured.

---

## Prompt trigger source (AC6)

A plain free-text prompt is now a first-class trigger source in the `SoftwareTeamsTrigger`
Ingestion node alongside ClickUp and Datadog. Set `Source = Prompt` and supply the prompt text
directly — no external API call is made.

This makes simple prompt-driven workflows straightforward:

```
n8n Form Trigger  (fields: Prompt, Target Repository, Base Branch)
  │
  ▼
SoftwareTeamsTrigger  (Source = Prompt)
  │  emits NodeEnvelope with correlationId + input.prompt set to the form value
  ▼
SoftwareTeamsOrchestrator (plan)
  │  …
```

See [`docs/repo-execution.md`](./repo-execution.md) §"Providing the repo + prompt" for the
Form Trigger recipe with expressions.

---

## Secrets isolation (AC8)

All new channel tokens (`discordBotToken`, `smtpUrl`) are fields on the existing
`SoftwareTeamsApi` credential. They follow the same isolation contract as `ANTHROPIC_API_KEY`
and `githubToken`:

- Read from the credential at node execution time.
- Passed to the channel delivery function as a typed argument.
- **Never** written to the `NodeEnvelope`, node output, execution logs, or the model prompt.
- **Never** accepted as a node parameter (R-02).

The PR-tag (`<!-- software-teams:correlationId=... -->`) contains only the public `correlationId`
string — no secret material.
