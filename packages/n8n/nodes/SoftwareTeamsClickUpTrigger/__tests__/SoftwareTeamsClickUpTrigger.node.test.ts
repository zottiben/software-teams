import { describe, expect, test } from "bun:test";
import { SoftwareTeamsClickUpTrigger } from "../SoftwareTeamsClickUpTrigger.node";
import {
  pollBufferLimit,
  selectPollCandidates,
  type ClickUpPollState,
} from "../../../src/ingestion/clickup-poll";

const tasks = [
  { apiId: "a", id: "SUP-A", workspaceId: "123", updatedAtMs: 1000 },
  { apiId: "b", id: "SUP-B", workspaceId: "123", updatedAtMs: 1000 },
  { apiId: "c", id: "SUP-C", workspaceId: "123", updatedAtMs: 2000 },
];

describe("SoftwareTeamsClickUpTrigger node", () => {
  const node = new SoftwareTeamsClickUpTrigger();

  test("is a real polling trigger with no input port", () => {
    expect(node.description.name).toBe("softwareTeamsClickUpTrigger");
    expect(node.description.polling).toBeTrue();
    expect(node.description.inputs).toEqual([]);
    expect(node.description.outputs).toEqual(["main"]);
    expect(node.description.usableAsTool).toBeUndefined();
    expect(typeof node.poll).toBe("function");
  });

  test("requires only the dedicated ClickUp credential", () => {
    expect(node.description.credentials).toEqual([
      { name: "softwareTeamsClickUpApi", required: true },
    ]);
  });

  test("requires an explicit workspace and pickup tag", () => {
    expect(
      node.description.properties.find((property) => property.name === "workspaceId")?.required,
    ).toBeTrue();
    expect(
      node.description.properties.find((property) => property.name === "pickupTag")?.required,
    ).toBeTrue();
  });

  test("does not process an existing backlog unless explicitly selected", () => {
    const property = node.description.properties.find(
      (candidate) => candidate.name === "processExisting",
    );
    expect(property?.default).toBeFalse();
    expect(property?.description).toContain("activation");
  });
});

describe("ClickUp polling boundary", () => {
  test("re-queries one millisecond before the boundary and excludes emitted IDs", () => {
    const state: ClickUpPollState = {
      lastUpdatedMs: 1000,
      boundaryTaskIds: ["a"],
    };
    const selected = selectPollCandidates(tasks, state, 10);
    expect(selected.queryAfterMs).toBe(999);
    expect(selected.tasks.map((task) => task.apiId)).toEqual(["b", "c"]);
    expect(selected.nextState).toEqual({
      lastUpdatedMs: 2000,
      boundaryTaskIds: ["c"],
      observedUpdatedMs: 2000,
      observedBoundaryTaskIds: ["c"],
    });
  });

  test("a max-ticket cap cannot lose tasks sharing the same update timestamp", () => {
    const first = selectPollCandidates(tasks, {}, 1);
    expect(first.tasks.map((task) => task.apiId)).toEqual(["a"]);
    expect(first.nextState).toEqual({
      lastUpdatedMs: 1000,
      boundaryTaskIds: ["a"],
      pendingTasks: [tasks[1], tasks[2]],
      observedUpdatedMs: 2000,
      observedBoundaryTaskIds: ["c"],
    });

    // Pending rows drain before another ClickUp list request is needed.
    const second = selectPollCandidates([], first.nextState, 1);
    expect(second.tasks.map((task) => task.apiId)).toEqual(["b"]);
    expect(second.nextState).toEqual({
      lastUpdatedMs: 1000,
      boundaryTaskIds: ["a", "b"],
      pendingTasks: [tasks[2]],
      observedUpdatedMs: 2000,
      observedBoundaryTaskIds: ["c"],
    });

    const third = selectPollCandidates([], second.nextState, 1);
    expect(third.tasks.map((task) => task.apiId)).toEqual(["c"]);
    expect(third.nextState).toEqual({
      lastUpdatedMs: 2000,
      boundaryTaskIds: ["c"],
      observedUpdatedMs: 2000,
      observedBoundaryTaskIds: ["c"],
    });
  });

  test("empty polls preserve state", () => {
    const state: ClickUpPollState = { lastUpdatedMs: 2000, boundaryTaskIds: ["c"] };
    expect(selectPollCandidates([], state, 10).nextState).toEqual({
      ...state,
      observedUpdatedMs: 2000,
      observedBoundaryTaskIds: ["c"],
    });
  });

  test("clears stale pending rows that are already behind the emitted boundary", () => {
    const stale: ClickUpPollState = {
      lastUpdatedMs: 1000,
      boundaryTaskIds: ["a"],
      pendingTasks: [tasks[0]],
      observedUpdatedMs: 1000,
      observedBoundaryTaskIds: ["a"],
    };
    expect(selectPollCandidates([], stale, 10).nextState.pendingTasks).toBeUndefined();
  });

  test("bounds static pending data to at most three batches and below one API page", () => {
    expect(pollBufferLimit(10)).toBe(30);
    expect(pollBufferLimit(50)).toBe(99);
  });

  test("rejects a non-positive runtime cap before querying ClickUp", () => {
    expect(() => pollBufferLimit(0)).toThrow(
      "Max Tickets per Poll must be a positive integer",
    );
    expect(() => selectPollCandidates(tasks, {}, 0)).toThrow(
      "Max Tickets per Poll must be a positive integer",
    );
  });
});
