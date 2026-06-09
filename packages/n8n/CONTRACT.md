# Inter-node data contract — `NodeEnvelope`

> **Status:** Accepted (W1 foundation). Normative source of truth for AC3.
> **Plan:** `1-01-n8n-nodes` · **Task:** T1 (`software-teams-architect`).
> **Implemented verbatim by T3**; the `contract-check` gate asserts this shape;
> T8 tests it. Pairs with [`ARCHITECTURE.md`](./ARCHITECTURE.md).
>
> Every agent node, the Orchestrator node, the trigger nodes, and the GitHub
> output node **emit on their output port and accept on their input port the
> single JSON object defined here.** A node consuming an upstream node's output
> needs only this contract — nothing about the upstream node's internals.

---

## 1. The envelope (normative)

```ts
/**
 * The one and only object passed between every Software Teams n8n node.
 * No field is optional except where stated; no field is `undefined`.
 */
export interface NodeEnvelope {
  /** Stable run/conversation id. Carried UNCHANGED node-to-node. The key the
   *  Slack resume (T10) and run-state (T9) match on. (R-05) */
  correlationId: string;

  /** The specialist that produced (output) / should consume (input) this
   *  envelope — e.g. "software-teams-frontend". Matches a name in agents/*.md. */
  agentId: string;

  /** Exactly these three values — string-literal union, nothing else.
   *  'needs-input' triggers the Slack HITL flow (T10). */
  status: 'ok' | 'error' | 'needs-input';

  /** The turn's inputs. */
  input: {
    /** The user-turn instruction for this node. */
    prompt: string;
    /** The upstream agent's structured handoff. `unknown` on the wire; folded
     *  into the prompt by the merge strategy in §4. */
    context: unknown;
  };

  /** The agent's structured turn output. */
  result: {
    /** The primary result body (the agent's final text). */
    text: string;
  };

  /** Produced references. MAY be empty `[]`, never absent. T7 appends the
   *  created PR/issue URL here. */
  artifacts: Array<{
    /** e.g. "pr" | "issue" | "comment" — open vocabulary. */
    type: string;
    /** Absolute URL of the artifact, when one exists. */
    url?: string;
  }>;
}
```

### Field table (the table `contract-check` asserts)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `correlationId` | `string` | **yes** | Stable run/conversation id; carried unchanged node-to-node; the key the Slack resume (T10) and run-state (T9) match on (R-05). |
| `agentId` | `string` | **yes** | The specialist that produced/should consume this envelope (e.g. `software-teams-frontend`), matching a name in `agents/*.md`. |
| `status` | `'ok' \| 'error' \| 'needs-input'` | **yes** | String-literal union — **exactly these three values**. `needs-input` triggers the Slack HITL flow (T10). |
| `input` | `{ prompt: string; context: unknown }` | **yes** | `prompt` is the user-turn instruction; `context` carries the upstream agent's structured handoff (see §4). |
| `result` | `{ text: string }` | **yes** | The agent's structured turn output; `text` is the primary result body. |
| `artifacts` | `Array<{ type: string; url?: string }>` | **yes** (may be empty `[]`) | Produced refs — e.g. `{ type: 'pr', url: '…' }`, `{ type: 'issue', url: '…' }`; T7 appends the created PR/issue URL here. |

**Invariants the gate checks:**

- All six top-level fields are present; none is `undefined`.
- `status` ∈ `{ 'ok', 'error', 'needs-input' }` — no other value passes.
- `input` has both `prompt: string` and `context` (any JSON value, incl. `null`).
- `result.text` is a `string` (possibly `""`).
- `artifacts` is an array (possibly `[]`); each element has `type: string` and an
  optional `url: string`.
- `correlationId` is identical across every envelope of one run (carry-through).

### Status semantics

| `status` | Meaning | Canvas effect |
|----------|---------|---------------|
| `ok` | Turn completed; `result.text` is the answer. | Flows to the next node. |
| `error` | Turn failed (non-zero `claude` exit, or the agent reported failure). | Short-circuits the branch; Orchestrator surfaces it (R-05). |
| `needs-input` | The agent needs a human decision/answer; the question is in `result.text`. | Parks the run for Slack HITL (T10); resumes the same `correlationId`. |

---

## 2. Producer / consumer rules

- **`correlationId` is immutable.** Every node copies it through verbatim. It is
  generated once at run start (trigger or Orchestrator) and is the join key for
  run-state (T9) and Slack resume (T10).
- **`agentId` is rewritten per hop.** On a node's *output* it names the producing
  specialist. When the next node consumes it, that node sets `agentId` to **its
  own** specialist before invoking (the consumer owns its identity).
- **`input.context` is the only handoff channel.** A consumer never reaches into
  the producer's internals — it reads the upstream envelope and folds it into its
  own `input.context` per §4.
- **`artifacts` accretes.** Downstream nodes append; they do not drop upstream
  refs. The final GitHub node (T7) appends the PR/issue URL.
- **Secrets never appear** in any field (R-02). Credentials reach the worker via
  the `SoftwareTeamsApi` credential type only; they are never written into the
  envelope or logged.

---

## 3. Worked example — agent → agent handoff (context carry-through)

A frontend specialist implements a component, then hands off to QA. The
correlation id is constant; the **frontend's `result` + `artifacts` become the QA
node's `input.context`** — that is the carry-through `contract-check`/T8 assert.

**(a) Envelope emitted by the `software-teams-frontend` Agent node:**

```json
{
  "correlationId": "run-2026-06-03-CU-4821",
  "agentId": "software-teams-frontend",
  "status": "ok",
  "input": {
    "prompt": "Add a dismissible cookie-consent banner to the marketing site.",
    "context": null
  },
  "result": {
    "text": "Added <CookieBanner/> in src/components/CookieBanner.tsx, wired it into App.tsx, and persisted consent to localStorage under key `cookie-consent`."
  },
  "artifacts": [
    { "type": "branch", "url": "https://github.com/acme/site/tree/feat/cookie-banner" }
  ]
}
```

**(b) The canvas wires that output into the `software-teams-qa-tester` node. The QA
node builds its input envelope, folding the upstream envelope into `input.context`
(carry-through), and sets `agentId` to its own specialist:**

```json
{
  "correlationId": "run-2026-06-03-CU-4821",
  "agentId": "software-teams-qa-tester",
  "status": "ok",
  "input": {
    "prompt": "Write a regression checklist and edge cases for the new cookie-consent banner.",
    "context": {
      "from": "software-teams-frontend",
      "upstreamStatus": "ok",
      "result": {
        "text": "Added <CookieBanner/> in src/components/CookieBanner.tsx, wired it into App.tsx, and persisted consent to localStorage under key `cookie-consent`."
      },
      "artifacts": [
        { "type": "branch", "url": "https://github.com/acme/site/tree/feat/cookie-banner" }
      ]
    }
  },
  "result": { "text": "" },
  "artifacts": []
}
```

Note: `correlationId` is unchanged; `agentId` flipped to the consumer; the whole
upstream `result`/`artifacts` rode through into `input.context`; `result.text` is
empty until the QA turn runs.

**(c) After the QA node runs its single turn, it emits:**

```json
{
  "correlationId": "run-2026-06-03-CU-4821",
  "agentId": "software-teams-qa-tester",
  "status": "ok",
  "input": { "prompt": "Write a regression checklist and edge cases for the new cookie-consent banner.", "context": { "from": "software-teams-frontend", "...": "(unchanged from (b))" } },
  "result": {
    "text": "Regression checklist:\n1. Banner shows on first visit (no stored consent).\n2. Dismiss persists across reload.\n3. localStorage disabled → banner still dismissable for the session.\n4. Keyboard focus trap + ESC dismiss.\n..."
  },
  "artifacts": []
}
```

---

## 4. Upstream-context merge

> **Owned by T3** (the merge strategy is T3's to implement); **pinned here** so
> T3 implements it verbatim, T8 tests it, and every node assembles the prompt the
> same way. `input.context` is `unknown` on the wire; this section defines how it
> becomes part of the next agent's single-turn prompt.

**Chosen strategy: prepend a fenced JSON block to the user turn.**

When a node invokes `claude -p` (via `runAgentTurn` → `spawnClaude`), the wrapper
assembles the prompt **string** as:

```
## Upstream context
```json
<JSON.stringify(input.context, null, 2)>
```

## Task
<input.prompt>
```

Rules:

1. If `input.context` is `null`/`undefined`/`{}`, the `## Upstream context`
   block is **omitted** entirely — the prompt is just the `## Task` body. (A
   first/root node has no upstream context.)
2. `input.context` is serialised with `JSON.stringify(value, null, 2)` and fenced
   as ```` ```json ````. This is deterministic, greppable, and contract-testable.
3. The block is **prepended** so the agent reads its inheritance before the
   instruction; `input.prompt` is always the final, imperative section.
4. The merge is **read-only** on `input` — it does not mutate the envelope. The
   assembled string is passed to `spawnClaude`'s `prompt` argument; the envelope
   carries the structured `input.context` unchanged for the next hop.

**Worked merge** — the prompt string `runAgentTurn` builds for the QA node in §3(b):

````text
## Upstream context
```json
{
  "from": "software-teams-frontend",
  "upstreamStatus": "ok",
  "result": {
    "text": "Added <CookieBanner/> in src/components/CookieBanner.tsx, wired it into App.tsx, and persisted consent to localStorage under key `cookie-consent`."
  },
  "artifacts": [
    { "type": "branch", "url": "https://github.com/acme/site/tree/feat/cookie-banner" }
  ]
}
```

## Task
Write a regression checklist and edge cases for the new cookie-consent banner.
````

**Alternative considered & rejected:** appending the context as a *system* message
(`claude --append-system-prompt`). Rejected because the `spawnClaude` primitive
([`src/utils/claude.ts`](../src/utils/claude.ts)) exposes only a single `prompt`
argument and no system-prompt channel; routing context through the user turn keeps
the node on the existing primitive with zero CLI-surface coupling, and keeps the
merged prompt fully visible to the contract tests.

---

## 5. `needs-input` marker convention (HITL hook)

So the adapter can set `status: 'needs-input'` deterministically, the single-turn
prompt instructs the agent to end its turn with a machine-detectable marker when it
needs a human decision — recommended form:

```
NEEDS_INPUT: <the question for the human>
```

`runAgentTurn` (T3) detects the marker, sets `status: 'needs-input'`, and places
the question in `result.text`; T10's Slack HITL posts it, parks the run on the
`correlationId`, and resumes the same agent with the human's reply folded back in
as `input.context`. The exact marker grammar is finalised by T3/T10; this contract
fixes only that `needs-input` is signalled in-band and surfaced via `result.text`.
