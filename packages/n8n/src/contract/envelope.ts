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

/** A produced reference (PR, issue, comment, branch, etc.) */
export interface ArtifactRef {
  /** e.g. "pr" | "issue" | "comment" | "branch" — open vocabulary. */
  type: string;
  /** Absolute URL of the artifact, when one exists. */
  url?: string;
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
}
