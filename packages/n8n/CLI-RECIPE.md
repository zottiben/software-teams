# CLI surface contract — manual / no-install verbs

> **Status:** Accepted (W1 foundation). Normative source of truth for AC1, AC2, AC7.
> **Plan:** `1-02-n8n-manual-cli` · **Task:** T1 (`software-teams-architect`).
> **Implemented verbatim** by the shared envelope-I/O helper (T2) and the four
> verb wrappers (T3–T6); the `json-purity-gate` and `exit-code-gate` assert §3
> and §4; T8's Execute Command recipe and T9's string-match test derive from §7.
>
> **File-placement decision (recorded per T1):** this contract lives in a
> sibling `n8n/CLI-RECIPE.md`, NOT as a section appended to `n8n/CONTRACT.md`.
> Rationale: `CONTRACT.md` is a `1-01` artefact under its own `contract-check`
> gate and stays scoped to the wire envelope; the CLI surface is a `1-02`
> concern that *consumes* that contract. Keeping them separate means neither
> plan's gate re-litigates the other's document.

The four verbs are `agent-turn`, `orchestrator-turn`, `ingest`, `output` —
each a citty `defineCommand` registered in `src/index.ts`'s flat `subCommands`
map. Every verb is a **thin wrapper**: parse args → resolve input (§2) → call
its engine function (§5) → hand the resulting envelope to the shared
envelope-I/O helper, which applies the output rule (§3) and the exit-code
mapping (§4). No verb re-implements any of §2–§4 locally.

---

## 1. The envelope (reference — NOT redefined here)

The input and output of every verb is the **`NodeEnvelope`** defined in
[`n8n/CONTRACT.md` §1](./CONTRACT.md) and implemented in
`n8n/src/contract/envelope.ts`. This document does not restate or extend its
field table; the `contract-conformance` gate applies to every envelope a verb
emits (all six fields, status enum, `correlationId` carry-through, `artifacts`
append-not-replace). Input validation in §2 uses the existing contract module —
never a hand-rolled check.

---

## 2. Input resolution (normative)

Resolution order is strict precedence — the first source that *applies* is
used, and there is **no fallback past a failed parse** (a malformed
higher-precedence source is a parse error, exit 2, even if a lower-precedence
source would have been valid).

| Precedence | Source | Applies to | Behaviour |
|---|---|---|---|
| 1 | `--envelope <json>` | all verbs | Parse the flag value as a `NodeEnvelope`. Stdin is **ignored entirely** when the flag is present, even if piped. Malformed value → exit 2. |
| 2 | stdin (read to EOF) | all verbs | Read all of stdin and parse it as a `NodeEnvelope`. Malformed content → exit 2. |
| 3 | argument synthesis | `ingest` only | Synthesize a minimal **initial** envelope from the verb's own flags (the engine's job; the wrapper passes flags through). |
| 3 | — | `agent-turn`, `orchestrator-turn`, `output` | No input available → **input error**, exit 2. These verbs require an input envelope. |

**Stdin-absence rule (pins T2):** stdin is considered *absent* — falling
through to row 3 — when (a) stdin is a TTY (interactive invocation, do not
block on read), or (b) read-to-EOF yields zero bytes or whitespace only. Any
other stdin content MUST parse as a `NodeEnvelope` or the verb exits 2.

**Validation rule:** "parses" means both `JSON.parse` succeeds **and** the
object satisfies the `CONTRACT.md` §1 invariants, checked via the existing
contract module. A syntactically-valid JSON object that fails the invariants
is a parse error (exit 2).

---

## 3. Output rule (normative — the `json-purity-gate` spine, R-09)

| Mode | stdout | stderr |
|---|---|---|
| default (no `--json`) | Human-readable consola summary. No machine-parseable guarantee. | Diagnostics, logs, progress. |
| `--json` | **Exactly one** `NodeEnvelope`, serialised as `JSON.stringify(envelope)` plus a single trailing `\n`. **Nothing else** — no banners, no progress lines, no leading or trailing log output. | ALL diagnostics, logs, and progress. Consola is redirected to stderr or suppressed. |

**Hard invariant (R-09 — stdout contamination):** under `--json`, stdout is
reserved for the envelope alone. The `json-purity-gate` asserts this with a
byte-for-byte `JSON.parse(stdout)` of a piped fixture run; one stray stdout
byte blocks the wave. The shared helper is the **only** code path that writes
to stdout under `--json` — verbs never write to stdout directly.

**Exit-2 stdout rule (pins T2):** when input resolution fails (exit 2), there
is no valid envelope to emit — the helper writes the diagnostic to **stderr**
and writes **nothing to stdout**, in both modes. Consumers distinguish this
case by exit code, never by parsing stdout.

**Error-envelope rule:** when a turn produces `status: 'error'`, the envelope
IS still emitted (stdout under `--json`, summary otherwise) — the failure is
*in band* on the envelope and *out of band* on the exit code (§4).

---

## 4. Exit-code mapping (normative — the `exit-code-gate` spine)

| Condition | Exit code | Envelope emitted? | Rationale |
|---|---|---|---|
| resulting envelope `status: 'ok'` | **0** | yes | Success. |
| resulting envelope `status: 'needs-input'` | **0** | yes | Valid park-for-HITL outcome, not a failure — the canvas routes on the status field. |
| resulting envelope `status: 'error'` | **1** | yes | Turn/engine error; envelope carries the detail. |
| unparseable / missing / invariant-failing input (§2) | **2** | no | Usage/input error — distinct from a turn error so a workflow can tell "the turn failed" from "I piped garbage". |
| any other uncaught failure | non-zero (≥ 1), never 0 | no guarantee | Defensive floor; the helper catches what it can and maps it to 1. |

---

## 5. Verb → engine-function map (normative — T3–T6 are pure wiring)

| Verb | Engine function(s) | Module(s) |
|---|---|---|
| `agent-turn` | `runAgentTurn` | `n8n/src/execution/single-turn.ts` |
| `orchestrator-turn` | `planEpic` + `tasksToEnvelopes` / `initRunState` (+ `serialiseRunState` for §6) | `n8n/src/orchestration/run-state.ts` |
| `ingest` | `extractClickUpRef` / `extractDatadogIssue` + `buildClickUpContext` / `buildDatadogContext` | `src/utils/clickup.ts`, `src/utils/datadog.ts` + `n8n/src/ingestion/context.ts` |
| `output` | `createPullRequest` / `createIssue` + `extractBranchName` | `n8n/src/output/github.ts` |

No verb introduces engine logic. Anything beyond arg-parsing + helper-wiring +
the calls above fails the `reuse-check` gate and must be justified in the
slice's report.

### Shared flags (every verb)

| Flag | Type | Meaning |
|---|---|---|
| `--json` | boolean (default `false`) | Activate the §3 `--json` output mode. |
| `--envelope <json>` | string | Inline input envelope; precedence over stdin (§2). |

### Verb-specific flags (fixed here; further flags belong to T3–T6 slices)

| Verb | Flag | Values | Required |
|---|---|---|---|
| `ingest` | `--source` | `clickup` \| `datadog` | yes |
| `output` | `--mode` | `pr` \| `issue` | no (default `pr`) |

Additional verb-specific flags MAY be added by T3–T6 but MUST NOT collide with
the shared set and MUST NOT alter §2–§4 behaviour.

---

## 6. `orchestrator-turn` output-envelope layout (normative — pins T4)

The orchestrator's fan-out payload lives at **named fields** — T4 wires to
these verbatim; no "e.g." choices remain:

| Field | Content |
|---|---|
| `result.context.tasks` | The **ordered** array of per-task `NodeEnvelope`s (the `tasksToEnvelopes` output) that the canvas delegates. |
| `result.context.runState` | The serialised run state — the `serialiseRunState(state)` output for the state built via `initRunState`. |
| `result.text` | The human-readable waved breakdown (per `CONTRACT.md`, `result.text` is always a string). |

**Compatibility note:** `result.context` is an *additive* extension of the
`CONTRACT.md` §1 `result` shape. The §1 invariants assert required fields, not
a closed shape, so this layout passes `contract-conformance` unchanged.
Downstream Code/Set nodes read `result.context.tasks[i]` to fan out.

---

## 7. Execute Command command-string template (normative — pins T8/T9)

Every verb is invoked from n8n's built-in Execute Command node as a
**stdin-piped, `--json`** command. The upstream envelope reaches the process
via **stdin** — it is **NEVER string-concatenated or interpolated into the
command string** (R-08, safe-by-construction shell-injection rule: envelope
content never touches the shell parser). The command string is constant per
verb, modulo the closed-enum verb flags below — never derived from envelope
content. *How* the recipe delivers stdin inside n8n is T8's concern; the
command strings themselves are fixed here.

Canonical template: `software-teams <verb> [verb-flags] --json` (envelope on stdin)

| Verb | Exact command string |
|---|---|
| `agent-turn` | `software-teams agent-turn --json` |
| `orchestrator-turn` | `software-teams orchestrator-turn --json` |
| `ingest` | `software-teams ingest --source <clickup\|datadog> --json` |
| `output` | `software-teams output --mode <pr\|issue> --json` |

T8's recipe documents these strings verbatim; T9's string-match assertion
tests against this table — both derive from this single normative source.

**Secrets rule (restated for the recipe):** secrets reach the worker as env
vars (`ANTHROPIC_API_KEY`, `CLICKUP_API_KEY`, `DATADOG_API_KEY` /
`DATADOG_APP_KEY`, GitHub/Slack tokens) — never as CLI args, never in the
envelope, never on stdout/stderr.

---

## 8. Inherited hard invariants (for T2 and T8)

| ID | Invariant | Enforced by |
|---|---|---|
| R-09 | **Stdout purity under `--json`** — stdout carries exactly one envelope and nothing else (§3). | `json-purity-gate` (byte-for-byte parse test). |
| R-08 | **Stdin-pipe safe-by-construction** — envelope content reaches a verb only via stdin or `--envelope`; never interpolated into a shell command string (§7). | `security-gate` (T8 review). |
