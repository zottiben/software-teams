# Software Teams — Manual / No-Install Recipe

> **Plan:** `1-02-n8n-manual-cli` · **Deliverable:** T8 · **Status:** Normative (AC8, AC9).
>
> How to run Software Teams from n8n's **built-in Execute Command node** — no community-node
> package required. Four thin CLI verbs (`ingest`, `agent-turn`, `orchestrator-turn`, `output`)
> pipe `NodeEnvelope` JSON on stdin/stdout so every step is a single Execute Command node.
>
> For teams that **can** install the package, see [`n8n/README.md`](./README.md) (`1-01`).
> This recipe is the deliberately-deferred no-install counterpart.

---

## 1 · The Recipe — Execute Command command strings

Every verb reads a `NodeEnvelope` JSON on **stdin** and writes a single `NodeEnvelope` JSON on
**stdout** when `--json` is passed. Wire them with n8n's built-in **Execute Command** node by
piping the upstream envelope to stdin and parsing stdout with a **Code** node.

### Canonical command strings (verbatim from `CLI-RECIPE.md §7`)

| Verb | Execute Command — Command field |
|------|---------------------------------|
| `ingest` (ClickUp) | `software-teams ingest --source clickup --json` |
| `ingest` (Datadog) | `software-teams ingest --source datadog --json` |
| `agent-turn` | `software-teams agent-turn --json` |
| `orchestrator-turn` | `software-teams orchestrator-turn --json` |
| `output` (PR) | `software-teams output --mode pr --owner OWNER --repo REPO --json` |
| `output` (issue) | `software-teams output --mode issue --owner OWNER --repo REPO --json` |

> **`ingest` special case:** `ingest` also accepts `--ref <url-or-id>` and `--url <url>` flags
> for the ticket reference, or reads `input.prompt` from a piped envelope. When no upstream
> envelope is available, synthesise a minimal initial run using flags only.

### Stdin pipe pattern (safe-by-construction, R-08)

The upstream envelope reaches the verb **only via stdin** — never via command-string
interpolation. In n8n, use a **Code node** to write the envelope JSON to a temp file and pipe
from it:

**Code node (before each Execute Command):**
```javascript
// Write envelope to temp file — avoids shell injection (R-08).
// Envelope content may contain shell metacharacters; keep it out of the command string.
const fs = require('fs');
const tmpPath = '/tmp/st-envelope-' + Date.now() + '.json';
const envelope = $input.first().json.envelope; // NodeEnvelope object from upstream
fs.writeFileSync(tmpPath, JSON.stringify(envelope));
return [{ json: { tmpPath } }];
```

**Execute Command node:**
```
cat {{ $json.tmpPath }} | software-teams agent-turn --json ; rm -f {{ $json.tmpPath }}
```

The command string itself is **constant** — only `tmpPath` (a safe `/tmp/st-…` path generated
by us) is interpolated, never envelope content.

### Parsing stdout in a Code node (after each Execute Command)

```javascript
// Parse the verb's JSON output and check status.
const stdout = $input.first().json.stdout;
const envelope = JSON.parse(stdout.trim()); // exactly one NodeEnvelope line

if (envelope.status === 'error') {
  throw new Error('verb failed: ' + envelope.result.text);
}
// envelope.status is 'ok' or 'needs-input' (exit code 0 for both — AC7)
return [{ json: { envelope } }];
```

---

## 2 · Secrets via Environment Variables

Secrets reach the worker as **plain environment variables** — there is no n8n credential type in
manual mode. **Never** put secrets in node parameters, expressions, or envelope fields.

| Secret | Verb(s) | How to set on worker |
|--------|---------|----------------------|
| `ANTHROPIC_API_KEY` | `agent-turn`, `orchestrator-turn` | n8n worker environment (`.env`, systemd unit, Docker `--env`) |
| `CLICKUP_API_KEY` | `ingest --source clickup` | n8n worker environment |
| `DATADOG_API_KEY` | `ingest --source datadog` | n8n worker environment |
| `DATADOG_APP_KEY` | `ingest --source datadog` | n8n worker environment |
| `GITHUB_TOKEN` **or** `GH_TOKEN` | `output` | n8n worker environment |
| Slack token | user's canvas | Not used by the CLI verbs; wire with n8n's Slack node for HITL |

### Rules

- Tokens are read from `process.env` inside each verb — **they are never accepted as CLI args**
  and are **never written to stdout, stderr, or the envelope JSON**.
- If a token is missing, the verb produces a `status: 'error'` envelope (with a clear message)
  and exits non-zero — it never silently degrades or leaks.
- Do not include secrets in n8n node parameters, URL fields, or expression strings that might
  appear in execution logs.

---

## 3 · Execute Command Security Note (R-07)

> ⚠️ **n8n's Execute Command node runs arbitrary shell on the worker.**

This is an n8n platform property, not a Software Teams property. Every command in the
"Command" field is executed as a shell command on the n8n worker process with the worker's
full privileges.

**Mitigations (strongly recommended):**

1. **Dedicated non-root worker user.** Run n8n under a purpose-created, unprivileged user
   account. Do not run as `root` or as the same user as other sensitive services.
2. **Least-privilege.** The worker user should have access only to the `software-teams` binary,
   the temp directory (`/tmp`), and the env vars it needs. No write access to the repo or
   production infrastructure.
3. **Pin the command string.** The command field should be a constant string
   (e.g. `software-teams agent-turn --json`) or a string whose interpolated values come from
   trusted, canvas-configured fields — not from untrusted external input or webhook payloads.
4. **Workflow-author trust boundary.** Only trusted team members should have edit access to
   n8n workflows that contain Execute Command nodes. A compromised workflow can run any shell
   command the worker user is permitted to run.

These are n8n recommendations we surface — this exposure cannot be removed from the recipe.

---

## 4 · Shell-Injection Safety (R-08)

> **Rule: pipe the envelope to stdin — never string-concatenate envelope/ticket text into the
> command string.**

Ticket titles, issue bodies, code review comments, and agent outputs can contain shell
metacharacters (`;`, `|`, `` ` ``, `$`, `"`, etc.). If any of this text appears in the
Execute Command "Command" field via an expression like `{{ $json.envelope.result.text }}`, it
can break out of the command string and execute arbitrary shell.

**Safe-by-construction pattern (what this recipe uses):**
1. A Code node writes the envelope JSON to a temp file (`/tmp/st-…json`).
2. The Execute Command field is: `cat {{ $json.tmpPath }} | software-teams <verb> --json`
3. Only `tmpPath` is interpolated — a path we generated (e.g. `/tmp/st-at-1234567890.json`),
   not envelope content.
4. The verb reads structured JSON from stdin; it never shell-expands it.

**`--envelope` flag — trusted/local escape hatch only:**
The `--envelope <json>` flag accepts the envelope inline as a CLI argument. Using it from an
Execute Command node requires the JSON to appear in the command string, which reintroduces
the injection surface. Use `--envelope` only for:
- Local development / manual testing from a terminal.
- Automated scripts where the envelope is a known-safe literal (e.g. a fixed fixture).

**Never** use `--envelope` in a production n8n workflow where the envelope content originates
from external (untrusted) data.

---

## 5 · Stdout Purity (R-09)

Under `--json`, every verb writes **exactly one** `NodeEnvelope` JSON object to stdout,
followed by a single newline. Nothing else — no banners, no progress lines, no log output.
All diagnostics go to **stderr**.

This guarantee means `JSON.parse(stdout.trim())` in your Code node will always succeed on
a successful run. Any stray byte on stdout would break the parse.

**Consequences for workflow authors:**
- Do **not** wrap the command in a shell script that adds `echo` lines or banners.
- Do **not** pipe through `tee` or other commands that write to stdout before the verb.
- If you see a `JSON.parse` error in your Code node, check the Execute Command node's `stderr`
  output for the actual diagnostic.

---

## 6 · Self-Hosted Constraint (AC9, R-01)

| Verb | Requires `claude` binary | Requires `ANTHROPIC_API_KEY` | Works on n8n Cloud? |
|------|--------------------------|------------------------------|---------------------|
| `ingest` | No | No | **Yes** (no Claude call) |
| `output` | No | No | **Yes** (no Claude call) |
| `agent-turn` | **Yes** | **Yes** | **No** |
| `orchestrator-turn` | **Yes** | **Yes** | **No** |

`agent-turn` and `orchestrator-turn` invoke the `claude` binary at runtime. n8n Cloud does not
allow arbitrary binary execution, so these verbs are **self-hosted only**.

**To satisfy the requirement on a self-hosted worker:**
```bash
# Install the Claude binary (Anthropic CLI)
npm install -g @anthropic-ai/claude-code

# Set the API key in the worker environment
export ANTHROPIC_API_KEY=sk-ant-...
```

If the `claude` binary is absent or `ANTHROPIC_API_KEY` is unset, the verb returns a
`status: 'error'` envelope with a descriptive message — it never silently degrades.

**Partial-Cloud option:** `ingest` and `output` work on n8n Cloud because they call external
APIs (ClickUp, Datadog, GitHub) directly, not the Claude binary. You can run a hybrid workflow:
ingest on Cloud → hand off to a self-hosted n8n for agent turns → output on Cloud. Wire this
with n8n's HTTP Request node or a webhook between the two instances.

---

## 7 · Exit Codes

| Exit code | Meaning | Envelope emitted? |
|-----------|---------|-------------------|
| `0` | `status: 'ok'` or `status: 'needs-input'` | Yes |
| `1` | `status: 'error'` (turn/engine failure) | Yes — check `result.text` |
| `2` | Unparseable or missing input | No |

Both `ok` and `needs-input` exit 0 — use the `status` field to distinguish them in your IF
node. `needs-input` means the agent asked a clarifying question; the question text is in
`result.text`.

---

## 8 · Manual Mode vs the Package

If your n8n worker allows community-node installs and you want a purpose-built UI with
n8n credential management, use the `@websitelabs/n8n-nodes-software-teams` package documented
in [`n8n/README.md`](./README.md) (`1-01`). That package provides dedicated node types
(Agent, Orchestrator, Trigger Ingestion, Slack HITL, Output) with a proper credential type
that stores `ANTHROPIC_API_KEY` in n8n's encrypted store.

Manual mode (this recipe) is the no-install alternative: four Execute Command + Code nodes,
env vars on the worker, same underlying engine.

---

## 9 · Importable Example Workflow

An importable n8n workflow JSON using **built-in nodes only** (Execute Command + Code + Set +
IF — no package node) is available at:

```
n8n/examples/manual-recipe.workflow.json
```

Import it via **Workflows → Import from file** in your n8n instance, then update the Set node
with your ticket URL, GitHub owner/repo, and ensure the env vars above are set on the worker.
