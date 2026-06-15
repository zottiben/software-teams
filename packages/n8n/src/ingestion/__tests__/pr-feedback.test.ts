import { describe, test, expect } from "bun:test";
import {
  PR_FEEDBACK_TASK_ID,
  prCommentsToEnvelope,
  type ReviewComment,
} from "../pr-feedback";
import { isNodeEnvelope } from "../../orchestration/run-state/persistence";

/**
 * PR-feedback ingestion test suite (T4 — AC2).
 *
 * Tests that:
 * 1. PR_FEEDBACK_TASK_ID is a non-empty string (satisfies the continue branch)
 * 2. prCommentsToEnvelope produces a valid NodeEnvelope
 * 3. The envelope carries the original correlationId
 * 4. input.context.taskId is set to PR_FEEDBACK_TASK_ID
 * 5. The feedback field carries all categorised comments
 * 6. The mapper is pure and side-effect-free
 */

const SAMPLE_COMMENTS: ReviewComment[] = [
  {
    path: "src/index.ts",
    line: 42,
    body: "This must be fixed — blocking security issue",
    author: "reviewer1",
    category: "blocking",
    action: "Fix before merge",
  },
  {
    path: "src/utils.ts",
    line: 10,
    body: "Please change this to use the helper",
    author: "reviewer2",
    category: "change_request",
    action: "Apply requested change",
  },
  {
    path: "(review)",
    line: null,
    body: "Could you consider adding a test for this?",
    author: "reviewer1",
    category: "suggestion",
    action: "Consider applying",
  },
];

describe("PR_FEEDBACK_TASK_ID", () => {
  test("is a non-empty string (satisfies Orchestrator continue branch typeof check)", () => {
    expect(typeof PR_FEEDBACK_TASK_ID).toBe("string");
    expect(PR_FEEDBACK_TASK_ID.length).toBeGreaterThan(0);
  });

  test("equals 'pr-feedback'", () => {
    expect(PR_FEEDBACK_TASK_ID).toBe("pr-feedback");
  });
});

describe("prCommentsToEnvelope", () => {
  const base = {
    correlationId: "run-abc-123",
    agentId: "software-teams-programmer",
  };

  test("returns a valid NodeEnvelope (passes isNodeEnvelope guard)", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(isNodeEnvelope(envelope)).toBe(true);
  });

  test("carries the original correlationId unchanged", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.correlationId).toBe("run-abc-123");
  });

  test("sets agentId from base", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.agentId).toBe("software-teams-programmer");
  });

  test("sets status to 'ok'", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.status).toBe("ok");
  });

  test("sets input.context.taskId to PR_FEEDBACK_TASK_ID", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    const ctx = envelope.input.context as Record<string, unknown>;
    expect(typeof ctx.taskId).toBe("string");
    expect(ctx.taskId).toBe(PR_FEEDBACK_TASK_ID);
  });

  test("sets input.prompt to a non-empty instruction string", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.input.prompt.length).toBeGreaterThan(0);
    expect(envelope.input.prompt).toContain("Address the following PR review feedback");
  });

  test("prompt summarises comment categories", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.input.prompt).toContain("1 blocking issue(s)");
    expect(envelope.input.prompt).toContain("1 change request(s)");
    expect(envelope.input.prompt).toContain("1 suggestion(s)");
  });

  test("sets result.text to empty string", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.result.text).toBe("");
  });

  test("sets artifacts to empty array", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.artifacts).toEqual([]);
  });

  test("carries all comments in feedback.comments", () => {
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    expect(envelope.feedback).toBeDefined();
    expect(envelope.feedback!.comments).toHaveLength(3);
    expect(envelope.feedback!.comments[0].path).toBe("src/index.ts");
    expect(envelope.feedback!.comments[0].line).toBe(42);
    expect(envelope.feedback!.comments[0].body).toContain("blocking security issue");
    expect(envelope.feedback!.comments[0].author).toBe("reviewer1");
    expect(envelope.feedback!.comments[0].category).toBe("blocking");
    expect(envelope.feedback!.comments[1].category).toBe("change_request");
    expect(envelope.feedback!.comments[2].category).toBe("suggestion");
  });

  test("handles empty comments array", () => {
    const envelope = prCommentsToEnvelope(base, []);
    expect(isNodeEnvelope(envelope)).toBe(true);
    expect(envelope.feedback!.comments).toHaveLength(0);
    expect(envelope.input.prompt).toContain("Address the following PR review feedback");
    // No category lines when empty
    expect(envelope.input.prompt).not.toContain("blocking");
  });

  test("does not mutate the input comments array", () => {
    const comments: ReviewComment[] = [
      {
        path: "a.ts",
        line: 1,
        body: "nit: spacing",
        author: "rev",
        category: "nitpick",
        action: "Optional fix",
      },
    ];
    const before = JSON.stringify(comments);
    prCommentsToEnvelope(base, comments);
    expect(JSON.stringify(comments)).toBe(before);
  });

  test("the returned envelope satisfies the continue-branch condition", () => {
    // Simulates the Orchestrator check at node.ts:163-181
    const envelope = prCommentsToEnvelope(base, SAMPLE_COMMENTS);
    const ctx = envelope.input.context as Record<string, unknown> | null | undefined;
    expect(typeof ctx?.taskId === "string").toBe(true);
  });
});
