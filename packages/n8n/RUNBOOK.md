# Operator runbook - Software Teams on n8n

Start-to-finish setup for running support tickets through Software Teams on a
self-hosted n8n instance, billed against a Claude subscription rather than the
Anthropic API.

Read [§1 Prerequisites](#1-prerequisites) and [§4 Credentials](#4-credentials)
before you install anything: the two mistakes that cost the most time are a
worker without the `claude` binary and a worker with a stray `ANTHROPIC_API_KEY`.

| Section | Do this when |
|---|---|
| [1. Prerequisites](#1-prerequisites) | Before install |
| [2. Install the package](#2-install-the-package) | Once per instance |
| [3. Confirm every entry loads](#3-confirm-every-entry-loads) | After install and after each upgrade |
| [4. Credentials](#4-credentials) | Once, then on rotation |
| [5. Import the reference workflow](#5-import-the-reference-workflow) | First workflow |
| [6. First run: one ticket, by hand](#6-first-run-one-ticket-by-hand) | Before any automation |
| [7. Read the execution](#7-read-the-execution) | After every run while piloting |
| [8. Turn on tag-driven pickup](#8-turn-on-tag-driven-pickup) | Only after §6 and §7 look right |
| [9. Operations](#9-operations) | Ongoing |

---

## 1. Prerequisites

**The `claude` binary must be on the n8n worker.** Every node shells out to
`claude -p`. n8n's own container does not ship it, so a stock
`docker.n8n.io/n8nio/n8n` image will fail every execution with a spawn error.

On the worker host or in your derived image:

```bash
npm install -g @anthropic-ai/claude-code
claude --version    # 2.1.218 or later
```

Also required:

- **Self-hosted n8n.** Community nodes execute arbitrary code on the worker, so
  n8n Cloud does not run them. See the warning at the top of the README.
- **Node 18+** on the worker. Software Teams' n8n code is Node-only; it must
  never call a `Bun.*` API.
- **A persistent `N8N_ENCRYPTION_KEY`.** Credentials are encrypted with it. In
  queue mode every worker needs the *same* key, or workers cannot decrypt the
  credential and every execution fails to authenticate.
- **Git and network access** for any node that touches a repository or the
  ClickUp API.

> **Multi-worker note.** The OAuth token is one seat's allowance. Running many
> workers against one token does not multiply capacity; it exhausts the window
> faster. See [§9 Usage limits](#usage-limits).

---

## 2. Install the package

In n8n: **Settings → Community Nodes → Install**, then enter:

```
@websitelabs/n8n-nodes-software-teams
```

Accept the security prompt and wait for the install to finish.

CLI alternative, on the worker host:

```bash
cd ~/.n8n/nodes
npm install @websitelabs/n8n-nodes-software-teams
# restart n8n
```

---

## 3. Confirm every entry loads

A community node that fails to load is silently missing from the palette rather
than reported as an error, so check explicitly.

Open the node palette and search `Software Teams`. You should see **13 nodes**,
including **Ticket Intake**, **ClickUp Trigger**, and **Claude Code**.

If nodes are missing, check the worker log for a load error. The usual causes
are a mixed ESM/CJS resolution failure or a partially-extracted install; both
show up as a `require` error naming the entry file.

---

## 4. Credentials

Secrets live in n8n's encrypted credential store. They are injected into the
`claude` child process at runtime and are never node parameters, never written
to node output, and never appear in the execution data.

### 4a. Generate the OAuth token

On any machine logged into the Claude subscription account you want billed:

```bash
claude setup-token
```

This prints a long-lived token. Copy it straight into the n8n credential field
in the next step.

> Do not paste the token into a shell profile, a `.env`, a repository file, or
> a chat window. n8n's encrypted store is the only place it belongs.

### 4b. Create the Software Teams API credential

**Credentials → New → Software Teams API**

| Field | Value |
|---|---|
| **Authentication** | `Claude Subscription (OAuth Token)` — the default |
| **Claude Code OAuth Token** | the token from §4a |

Fill the GitHub, Slack, Discord, or SMTP fields only for the nodes you actually
use. Leave the **Anthropic API Key** field empty in subscription mode.

Click **Test**. The test runs `claude auth status` on the worker and asserts the
reported `authMethod` matches the mode you selected. It deliberately does not
accept a bare `loggedIn: true`, because a worker with `ANTHROPIC_API_KEY` set
reports exactly that while quietly billing the API.

### 4c. Keep `ANTHROPIC_API_KEY` off the worker

`ANTHROPIC_API_KEY` **outranks** the OAuth token. If it is set in the worker
environment, Claude uses it and your subscription is bypassed: runs succeed and
bill the API instead. Software Teams strips it from the child environment in
subscription mode, but do not rely on that as your only defence - keep it out of
the worker environment entirely.

Verify on the worker:

```bash
env | grep -E 'ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN' || echo "clean"
```

### 4d. Create the ClickUp credential

**Credentials → New → Software Teams ClickUp API**

It holds only the ClickUp token and API base URL. It is deliberately separate so
the poller never receives Claude, GitHub, Slack, SMTP, or Datadog secrets.

---

## 5. Import the reference workflow

`examples/support-ticket.workflow.json` ships with the package.

**Workflows → Import from File.** It imports **inactive** by design.

Both entry points converge on one triage step, which routes four ways -
question, bug, change request, escalation - and every branch reaches Human
Review before anything leaves the system:

```
Manual Trigger ─→ Ticket Intake ─┐
                                 ├─→ Claude Code (triage) ─→ Switch ─┬─→ question
ClickUp Trigger ────────────────┘                                    ├─→ bug
                                                                     ├─→ change request
                                                                     ├─→ escalation
                                                                     └─→ error / retry-later
                                                                          └─→ Human Review
```

Assign both credentials to their nodes after import.

---

## 6. First run: one ticket, by hand

Do this before enabling any trigger. The manual path exercises the whole chain
with a ticket you choose.

1. Open **Ticket Intake**.
2. Set **Source** to `ClickUp Task`.
3. Put the ticket reference in **ClickUp Task URL or ID** — a full URL works:
   `https://app.clickup.com/t/36826178/NDP-34603`
4. Set **ClickUp Workspace ID** if the reference is a bare custom ID.
5. Leave **Ticket Budget USD** at its default for the first run.
6. Click **Execute Workflow**.

Expected: the ticket is fetched, PII-scrubbed, and passed to triage; triage
returns a typed result; the Switch routes it; Human Review receives it.

A first run that returns `needs-input` is a success, not a failure - it means
the agent identified missing information rather than guessing.

---

## 7. Read the execution

Open the execution and check the envelope on each node's output.

| Field | What to check |
|---|---|
| `status` | `ok`, `needs-input`, `error`, or `retry-later` |
| `result.text` | The summary, or the question when `needs-input` |
| `result.data` | The validated structured result for custom schemas |
| `budget` | `limitUsd` and cumulative `spentUsd` across the ticket |
| `audit[]` | One non-secret event per step: actor, action, tool policy, cost |
| `usage` | Tokens and cost reported by the run |
| `sessionId` | Present when the run is resumable |

The audit trail deliberately carries policy and cost only. Prompts, ticket
bodies, result prose, and API responses are excluded so it does not become a
second copy of your customer data.

**Confirm the billing went where you intended.** On the worker:

```bash
claude auth status     # expect authMethod: "oauth_token"
```

---

## 8. Turn on tag-driven pickup

Only after §6 and §7 look right.

1. Open **ClickUp Trigger**.
2. Set **Workspace ID** and the **Tag** to poll (default `software-teams`).
3. Optionally restrict to specific **List IDs**.
4. Leave **Process Existing Tickets** **off**.
5. Set **Max Tickets per Poll** — start at `1` or `2` while piloting.
6. Save, then activate the workflow.

> **Why leave "Process Existing" off.** On first activation the trigger marks
> everything currently tagged as already-seen and picks up only tickets updated
> afterwards. Turning it on drains the entire historical backlog through Claude
> on the first poll, which can exhaust the subscription window in minutes.

Tag one ticket, wait for the poll, and confirm exactly one execution appears.
Then widen the tag or raise the cap.

To pause automation, deactivate the workflow. The watermark is preserved, so
reactivating resumes from where it stopped rather than replaying.

---

## 9. Operations

### Usage limits

Subscription allowance is finite per five-hour and weekly window. When it is
exhausted, a run returns **`retry-later`** — a distinct status, not a ticket
failure. The ticket is not lost and must not be retried in a tight loop.

Handle it by routing `retry-later` to a wait-and-retry path, or leaving it in
Human Review for a person to re-run after the window resets.

### Token expiry and rotation

The OAuth token is long-lived but not permanent. When it expires, runs fail with
an authentication error rather than degrading quietly.

To rotate: run `claude setup-token` again, edit the credential, and click
**Test**. No workflow changes are needed. Rotating on a schedule ahead of expiry
avoids an unattended queue stalling overnight.

### Budgets

Ticket budget is cumulative across every node in a ticket. The cap is enforced
**between turns**, so a single expensive turn can overshoot it — treat it as a
brake, not a guarantee. Set it per ticket at Ticket Intake.

### Recovery

| Symptom | Cause | Action |
|---|---|---|
| Every execution fails to spawn | No `claude` on the worker | §1 |
| Credential test fails on `authMethod` | Wrong mode, or a stray API key | §4b, §4c |
| Runs succeed but bill the API | `ANTHROPIC_API_KEY` set on the worker | §4c |
| All runs fail after a worker change | `N8N_ENCRYPTION_KEY` differs between workers | §1 |
| One ticket errors, the rest proceed | Ticket inaccessible, deleted, or rate-limited | Quarantined as an error item by design; recover it from Human Review |
| Poll returns nothing after tagging | Watermark is ahead, or the tag/List filter excludes it | §8 |
| Poll fails naming ascending order | ClickUp returned tasks out of order | The poller refuses to advance a partial watermark rather than skip tickets; re-run |

### Upgrades

After upgrading the package, repeat [§3](#3-confirm-every-entry-loads). A load
failure after upgrade removes nodes from the palette without failing loudly.
