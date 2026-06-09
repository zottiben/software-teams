import type { NodeEnvelope } from "@websitelabs/software-teams";
import type { RunState } from "./shapes";

/** Deep-clone to a plain JSON object for storage in workflow static data. */
export function serialiseRunState(state: RunState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

/** Ingestion boundary: value arrives from n8n workflow static data whose type is `unknown`; narrows here. */
export function deserialiseRunState(value: unknown): RunState | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.correlationId !== "string" || !Array.isArray(v.tasks)) return null;
  return value as RunState;
}

/** Ingestion boundary: value arrives from n8n item.json whose type is `unknown`; narrows to NodeEnvelope. */
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
