/**
 * The JSON Schema a specialist turn returns through `--json-schema`.
 *
 * This replaces two heuristics that used to decide a turn's outcome:
 *   - scanning the transcript for a `NEEDS_INPUT:` line, and
 *   - taking whichever assistant text happened to arrive last as the result.
 *
 * Both guessed. A schema makes the agent state its own outcome, and Claude
 * Code validates the object before returning it, so the node parses a typed
 * result instead of prose.
 *
 * Kept deliberately small. Every field is something a downstream n8n node
 * actually branches on or reports; anything else belongs in `summary`.
 */
export const TURN_RESULT_SCHEMA = {
  type: "object",
  // StructuredOutput rejects top-level oneOf/allOf/anyOf, so conditional
  // required fields are unavailable. Requiring question globally is the only
  // enforceable form: empty string for non-HITL outcomes, specific text for
  // needs-input.
  required: ["status", "summary", "question"],
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["ok", "needs-input", "error"],
      description:
        "ok when the task is complete; needs-input when you require a human decision " +
        "before continuing; error when the task cannot be completed as specified.",
    },
    summary: {
      type: "string",
      description:
        "What you did and what the caller needs to know, in prose. This is the " +
        "result a human reads.",
    },
    question: {
      type: "string",
      description:
        "The single specific question a human must answer when status is needs-input. " +
        "Use an empty string for ok or error; never omit this field.",
    },
    filesChanged: {
      type: "array",
      items: { type: "string" },
      description: "Repository-relative paths you created or modified. Omit if none.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description:
        "Your confidence that this turn met its objective. Low values signal the " +
        "caller should review before acting.",
    },
  },
} as const;

/** The validated object `--json-schema` returns for a specialist turn. */
export interface TurnResult {
  status: "ok" | "needs-input" | "error";
  summary: string;
  question?: string;
  filesChanged?: string[];
  confidence?: number;
}

/**
 * Narrow an unknown `structured_output` into a `TurnResult`.
 *
 * Claude Code validates against the schema before returning, but the value
 * still arrives as `unknown` across the process boundary, and it is `null`
 * whenever structured output could not be produced - so this is a real
 * boundary check, not a formality.
 */
export function parseTurnResult(value: unknown): TurnResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const status = record["status"];
  const summary = record["summary"];
  if (status !== "ok" && status !== "needs-input" && status !== "error") return null;
  if (typeof summary !== "string") return null;

  const question = record["question"];
  if (status === "needs-input" && (typeof question !== "string" || !question.trim())) return null;

  const result: TurnResult = { status, summary };

  if (typeof question === "string") result.question = question;
  if (typeof record["confidence"] === "number") result.confidence = record["confidence"];

  const files = record["filesChanged"];
  if (Array.isArray(files)) {
    result.filesChanged = files.filter((f): f is string => typeof f === "string");
  }

  return result;
}
