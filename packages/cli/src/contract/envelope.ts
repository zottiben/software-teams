/**
 * Inter-node data contract — NodeEnvelope
 *
 * Normative source: n8n/CONTRACT.md §1
 * Implemented verbatim by T3; the `contract-check` gate asserts this shape; T8 tests it.
 *
 * Every agent node, the Orchestrator node, the trigger nodes, and the GitHub
 * output node emit on their output port and accept on their input port the
 * single JSON object defined here. A node consuming an upstream node's output
 * needs only this contract — nothing about the upstream node's internals.
 */

// ---------------------------------------------------------------------------
// PR correlation tag — canonical format + helpers (plan 1-01 T3, AC2/R-06)
// ---------------------------------------------------------------------------

/** Machine-parseable marker stamped into a PR body so the PR-Feedback node can
 *  recover the originating run. HTML comment so it renders invisibly. */
export const CORRELATION_TAG_PREFIX = "software-teams:correlationId=";

/** Build the HTML-comment correlation tag for a given correlationId. */
export function buildCorrelationTag(correlationId: string): string {
  return `<!-- ${CORRELATION_TAG_PREFIX}${correlationId} -->`;
}

/** Parse a correlationId out of a PR body string. Returns `null` if no tag is present. */
export function parseCorrelationTag(body: string): string | null {
  const m = body.match(/<!--\s*software-teams:correlationId=([^\s>]+)\s*-->/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

/** A produced reference (PR, issue, comment, branch, etc.) */
export interface ArtifactRef {
  /** e.g. "pr" | "issue" | "comment" | "branch" — open vocabulary. */
  type: string;
  /** Absolute URL of the artifact, when one exists. */
  url?: string;
}

/**
 * Non-secret repo coordinates seeded by the Workspace node and read by Agent nodes.
 * Additive, optional — never contains credentials (R-02).
 * Shared contract source of truth; `RepoContext` (which adds the off-wire `worktreePath`)
 * is defined locally in the n8n package and is never serialised onto the envelope.
 */
export interface RepoDescriptor {
  /** Clone URL of the target repo (https/ssh). Never contains an embedded token (R-02). */
  cloneUrl: string;
  /** Canonical "owner/repo" — the validated form used for gh/PR addressing. */
  ownerRepo: string;
  /** Branch the run is based on (e.g. "main"). All worktrees fork from here. */
  baseBranch: string;
}

/**
 * ADR-002 Decision E — the ONE canonical portable-change representation.
 * Shared contract source of truth; imported by the n8n package from here
 * so the definition lives in exactly one place.
 * Additive, optional — never secret.
 */
export interface ChangeRef {
  /** Discriminant — the ONE canonical form. The sole extension point; no other kind is permitted. */
  readonly kind: "format-patch";
  /** base64 of `git format-patch` bytes; re-applied on any worker (queue-safe). */
  readonly patchBase64: string;
}

/**
 * A single categorised PR-review comment carried by the `feedback` envelope field.
 * Shape mirrors the `feedback --json` CLI output (plan 1-01 T4).
 */
export interface FeedbackComment {
  /** File path the comment targets (relative to repo root). */
  path: string;
  /** Line number the comment targets, or `null` for file-level / general comments. */
  line: number | null;
  /** The review comment body text. */
  body: string;
  /** GitHub username of the reviewer. */
  author: string;
  /** Category assigned during ingestion (e.g. "bug", "style", "question"). */
  category: string;
  /** Suggested action (e.g. "fix", "discuss", "acknowledge"). */
  action: string;
}

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
  status: "ok" | "error" | "needs-input";

  /** The turn's inputs. */
  input: {
    /** The user-turn instruction for this node. */
    prompt: string;
    /** The upstream agent's structured handoff. `unknown` on the wire; folded
     *  into the prompt by the merge strategy in CONTRACT.md §4. */
    context: unknown;
  };

  /** The agent's structured turn output. */
  result: {
    /** The primary result body (the agent's final text). */
    text: string;
  };

  /** Produced references. MAY be empty [], never absent. T7 appends the
   *  created PR/issue URL here. */
  artifacts: ArtifactRef[];

  /** Non-secret repo coordinates. Additive, optional — seeded by the Workspace node,
   *  read by Agent nodes. Never contains a token or `worktreePath` (R-02).
   *  Top-level sibling of `input`; `assemblePrompt` reads only `input`, so this
   *  field is never serialised into the model prompt. (plan 1-04, ADR-002 Decision G) */
  repo?: RepoDescriptor;

  /** The agent turn's captured portable change (ADR-002 Decision E). Additive, optional —
   *  set by an Agent node after capturing its change, read by the Orchestrator aggregation
   *  transition (T8) and the Finaliser (T9). Top-level sibling of `input`; `assemblePrompt`
   *  reads only `input`, so this field is never serialised into the model prompt. */
  changeRef?: ChangeRef;

  /** Categorised PR-review comments from the PR-Feedback node (plan 1-01 T7).
   *  Carries feedback into the Orchestrator continue-run path. Additive, optional —
   *  absent when the envelope is not a PR-feedback re-entry. Top-level sibling of
   *  `input`; `assemblePrompt` reads only `input`, so this field is never serialised
   *  into the model prompt. */
  feedback?: { comments: FeedbackComment[] };

  /** Upstream hint for which HITL channel to use. The HITL node's own param still
   *  wins; this is a default/hint only. Additive, optional — absent when no channel
   *  preference is specified. Top-level sibling of `input`; `assemblePrompt` reads
   *  only `input`, so this field is never serialised into the model prompt. */
  hitlChannel?: "slack" | "email" | "notify" | "discord";
}
