import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { RunState } from "./shapes";

/**
 * Readiness gate — one-shot quality pass (AC1, T6).
 *
 * Mirrors the planning.ts pattern: Bun-free, adapter-injected so it is
 * unit-testable with a mock. The two public functions build the single-turn
 * envelope for `software-teams-quality` and parse its structured verdict.
 */

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

function serialiseTasks(state: RunState): string {
  return state.tasks
    .map(
      (t) =>
        `- ${t.taskId}: brief=${JSON.stringify(t.name ?? "")} agent=${JSON.stringify(t.agent)} wave=${t.wave} dependsOn=[${t.dependsOn.join(", ")}]`,
    )
    .join("\n");
}

const READINESS_INSTRUCTION = [
  "You are validating a generated orchestration plan for ONE-SHOT READINESS.",
  "Assess every task against the following criteria:",
  "",
  "1. **Brief clarity** — each task's `brief` is non-empty and clearly describes",
  "   what the specialist must deliver and how success is measured.",
  "2. **Agent pin** — every task has a non-empty `agent` field naming a valid",
  "   Software Teams specialist (e.g. software-teams-frontend, software-teams-backend).",
  "3. **Dependencies present & acyclic** — every taskId referenced in `dependsOn`",
  "   exists in the plan; the dependency graph is acyclic.",
  "4. **Valid waves** — every task has a `wave` >= 1.",
  "",
  "Respond with EXACTLY this format (machine-parsed, no extra prose before the header):",
  "",
  "```",
  "READINESS: ready",
  "```",
  "",
  "OR, if any criterion fails:",
  "",
  "```",
  "READINESS: blocked",
  "gaps:",
  "- <gap description 1>",
  "- <gap description 2>",
  "```",
  "",
  "List EVERY blocking gap. Be specific: name the taskId and the failing criterion.",
].join("\n");

/**
 * Build the single-turn envelope that runs the readiness quality pass.
 * The `agentId` is `software-teams-quality`; the prompt serialises the plan's
 * task list so the quality agent can evaluate it without disk access.
 */
export function buildReadinessEnvelope(
  state: RunState,
  correlationId: string,
): NodeEnvelope {
  const taskBlock = serialiseTasks(state);
  return {
    correlationId,
    agentId: "software-teams-quality",
    status: "ok",
    input: {
      prompt: `${READINESS_INSTRUCTION}\n\n## Plan tasks (${state.tasks.length} total)\n${taskBlock}`,
      context: null,
    },
    result: { text: "" },
    artifacts: [],
  };
}

// ---------------------------------------------------------------------------
// Verdict parser
// ---------------------------------------------------------------------------

export interface ReadinessVerdict {
  /** true when the quality pass approves the plan for fan-out. */
  ready: boolean;
  /** blocking gaps surfaced by the quality agent (empty when ready). */
  gaps: string[];
}

/**
 * Parse the structured READINESS verdict from the quality agent's response text.
 * Tolerant of markdown fences and minor formatting variations.
 */
export function parseReadinessVerdict(text: string): ReadinessVerdict {
  // Strip markdown fences if present
  const stripped = text.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");

  // Look for the READINESS header line
  const headerMatch = stripped.match(
    /READINESS:\s*(ready|blocked)/i,
  );

  if (!headerMatch) {
    // If no parseable header, treat as blocked with a diagnostic gap
    return {
      ready: false,
      gaps: [
        "Quality agent did not return a parseable READINESS verdict.",
      ],
    };
  }

  const verdict = headerMatch[1]!.toLowerCase();

  if (verdict === "ready") {
    return { ready: true, gaps: [] };
  }

  // Extract gap lines: everything after "gaps:" that starts with "- "
  const gapsSection = stripped.slice(
    stripped.indexOf(headerMatch[0]) + headerMatch[0].length,
  );
  const gapLines = gapsSection
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0);

  return {
    ready: false,
    gaps:
      gapLines.length > 0
        ? gapLines
        : ["Quality agent flagged the plan as blocked but listed no specific gaps."],
  };
}
