import type { RunState } from "./shapes";
import { deserialiseRunState, serialiseRunState } from "./persistence";

export type RunStore = Record<string, unknown>;

export function getRunStore(staticData: Record<string, unknown>): RunStore {
  const existing = staticData["runs"] as RunStore | undefined;
  const runs = existing ?? {};
  staticData["runs"] = runs;
  return runs;
}

export function readRunState(
  staticData: Record<string, unknown>,
  correlationId: string,
): RunState | null {
  return deserialiseRunState(getRunStore(staticData)[correlationId]);
}

export function writeRunState(
  staticData: Record<string, unknown>,
  correlationId: string,
  state: RunState,
): void {
  getRunStore(staticData)[correlationId] = serialiseRunState(state);
}

export function deleteRunState(
  staticData: Record<string, unknown>,
  correlationId: string,
): boolean {
  const runs = getRunStore(staticData);
  if (!(correlationId in runs)) return false;
  delete runs[correlationId];
  return true;
}
