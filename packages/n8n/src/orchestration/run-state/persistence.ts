import type { NodeEnvelope } from "../../contract/envelope";
import type { RunState } from "./shapes";

// ---------------------------------------------------------------------------
// 6. Persistence helpers — plain JSON for n8n workflow static data
// ---------------------------------------------------------------------------

/** Deep-clone to a plain JSON object for storage in workflow static data. */
export function serialiseRunState(state: RunState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

/** Rehydrate a run state from workflow static data; null when shape is invalid. */
export function deserialiseRunState(value: unknown): RunState | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.correlationId !== "string" || !Array.isArray(v.tasks)) return null;
  return value as RunState;
}

/** Whether a value is a well-formed NodeEnvelope (used to detect handoff items). */
export function isNodeEnvelope(value: unknown): value is NodeEnvelope {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.correlationId === "string" &&
    v.correlationId.length > 0 &&
    typeof v.agentId === "string" &&
    (v.status === "ok" || v.status === "error" || v.status === "needs-input")
  );
}
