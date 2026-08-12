import type { TaggedClickUpTask } from "./support-ticket";

export interface ClickUpPollState {
  lastUpdatedMs?: number;
  boundaryTaskIds?: string[];
  /** Already-listed tasks drained without refetching the original backlog. */
  pendingTasks?: TaggedClickUpTask[];
  /** Highest update timestamp fully observed from ClickUp, independent of what has been emitted. */
  observedUpdatedMs?: number;
  /** API IDs observed at exactly observedUpdatedMs, for strict-greater boundary replay. */
  observedBoundaryTaskIds?: string[];
}

export function pollBufferLimit(maxTickets: number): number {
  if (!Number.isInteger(maxTickets) || maxTickets < 1) {
    throw new Error("Max Tickets per Poll must be a positive integer");
  }
  return Math.max(maxTickets, Math.min(99, maxTickets * 3));
}

export interface PollSelection {
  /** ClickUp's filter is strict `>`; subtract one to revisit the timestamp boundary safely. */
  readonly queryAfterMs?: number;
  readonly tasks: TaggedClickUpTask[];
  readonly nextState: ClickUpPollState;
}

/**
 * Select a bounded poll batch without dropping tasks that share a millisecond.
 *
 * Advancing only a timestamp is unsafe when `maxTickets` cuts through a group
 * with the same `date_updated`. The next strict-greater query would never see
 * the remainder. We therefore re-query one millisecond before the boundary and
 * retain the IDs already emitted at that exact timestamp.
 */
export function selectPollCandidates(
  input: readonly TaggedClickUpTask[],
  state: Readonly<ClickUpPollState>,
  maxTickets: number,
): PollSelection {
  pollBufferLimit(maxTickets);

  const lastUpdatedMs = state.lastUpdatedMs;
  const seenAtBoundary = new Set(state.boundaryTaskIds ?? []);
  const observedBefore = state.observedUpdatedMs ?? lastUpdatedMs;
  const queryAfterMs = observedBefore === undefined
    ? undefined
    : Math.max(0, observedBefore - 1);

  let observedUpdatedMs = observedBefore;
  const observedIds = new Set(state.observedBoundaryTaskIds ?? state.boundaryTaskIds ?? []);
  for (const task of input) {
    if (observedUpdatedMs === undefined || task.updatedAtMs > observedUpdatedMs) {
      observedUpdatedMs = task.updatedAtMs;
      observedIds.clear();
      observedIds.add(task.apiId);
    } else if (task.updatedAtMs === observedUpdatedMs) {
      observedIds.add(task.apiId);
    }
  }

  const merged = new Map<string, TaggedClickUpTask>();
  for (const task of [...(state.pendingTasks ?? []), ...input]) merged.set(task.apiId, task);
  const available = [...merged.values()]
    .sort((a, b) => a.updatedAtMs - b.updatedAtMs || a.apiId.localeCompare(b.apiId))
    .filter((task) => {
      if (lastUpdatedMs === undefined) return true;
      if (task.updatedAtMs > lastUpdatedMs) return true;
      return task.updatedAtMs === lastUpdatedMs && !seenAtBoundary.has(task.apiId);
    });
  const candidates = available.slice(0, maxTickets);
  const pendingTasks = available.slice(maxTickets);

  if (candidates.length === 0) {
    return {
      ...(queryAfterMs !== undefined ? { queryAfterMs } : {}),
      tasks: [],
      nextState: {
        ...(lastUpdatedMs !== undefined ? { lastUpdatedMs } : {}),
        ...(state.boundaryTaskIds ? { boundaryTaskIds: [...state.boundaryTaskIds] } : {}),
        ...(observedUpdatedMs !== undefined ? { observedUpdatedMs } : {}),
        ...(observedUpdatedMs !== undefined
          ? { observedBoundaryTaskIds: [...observedIds] }
          : {}),
      },
    };
  }

  const nextTimestamp = candidates[candidates.length - 1]!.updatedAtMs;
  const crossingBoundary = lastUpdatedMs === nextTimestamp;
  const boundaryTaskIds = new Set(crossingBoundary ? state.boundaryTaskIds ?? [] : []);
  for (const task of candidates) {
    if (task.updatedAtMs === nextTimestamp) boundaryTaskIds.add(task.apiId);
  }

  return {
    ...(queryAfterMs !== undefined ? { queryAfterMs } : {}),
    tasks: candidates,
    nextState: {
      lastUpdatedMs: nextTimestamp,
      boundaryTaskIds: [...boundaryTaskIds],
      ...(pendingTasks.length > 0 ? { pendingTasks } : {}),
      ...(observedUpdatedMs !== undefined ? { observedUpdatedMs } : {}),
      ...(observedUpdatedMs !== undefined
        ? { observedBoundaryTaskIds: [...observedIds] }
        : {}),
    },
  };
}
