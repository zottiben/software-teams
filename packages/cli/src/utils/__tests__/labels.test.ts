import { describe, test, expect } from "bun:test";
import { LIFECYCLE_LABELS } from "../labels";

describe("lifecycle labels", () => {
  test("the four documented labels are exported in workflow order", () => {
    // Order matters for documentation + ensures the workflow stages
    // (research → plan → approval → implementation) are reflected in
    // how we list them anywhere we iterate.
    expect(LIFECYCLE_LABELS).toEqual([
      "questions-pending",
      "plan-ready",
      "plan-approved",
      "ready-to-review",
    ]);
  });

  test("labels do NOT carry a `software-teams:` (or any other) prefix", () => {
    // Design decision: user opted to omit prefixes — keep the labels
    // short. If a future change wants to re-introduce a prefix, that
    // is a breaking change for any repo that has these labels in
    // saved filters / kanban views.
    for (const label of LIFECYCLE_LABELS) {
      expect(label).not.toMatch(/:/);
      expect(label).not.toMatch(/^st-/);
      expect(label).not.toMatch(/^software-teams-/);
    }
  });

  test("setLifecycleLabel + findPrForBranch are both exported (call sites depend on them)", async () => {
    const mod = await import("../labels");
    expect(typeof mod.setLifecycleLabel).toBe("function");
    expect(typeof mod.findPrForBranch).toBe("function");
  });
});

describe("runner call sites use the lifecycle labels", () => {
  // Source-level guards — the runner threads `setLifecycleLabel` into
  // four call sites (questions-pending, plan-ready, plan-approved,
  // ready-to-review). These tests fail loudly if a future refactor
  // silently drops one of them.
  test("run.ts imports setLifecycleLabel and findPrForBranch from utils/labels", async () => {
    const source = await Bun.file(new URL("../../commands/action/run.ts", import.meta.url).pathname).text();
    expect(source).toMatch(/import \{ setLifecycleLabel, findPrForBranch \} from "\.\.\/\.\.\/utils\/labels"/);
  });

  test("each lifecycle label has a setLifecycleLabel call site in run.ts", async () => {
    const discoveryGate = await Bun.file(new URL("../../commands/action/run/discovery-gate.ts", import.meta.url).pathname).text();
    const approvalPing = await Bun.file(new URL("../../commands/action/run/approval-ping.ts", import.meta.url).pathname).text();
    const labelPath = await Bun.file(new URL("../../commands/action/run/label-path.ts", import.meta.url).pathname).text();
    const executeAndPost = await Bun.file(new URL("../../commands/action/run/execute-and-post.ts", import.meta.url).pathname).text();
    expect(discoveryGate).toContain('setLifecycleLabel(opts.repo, opts.issueNumber, "questions-pending")');
    expect(labelPath).toContain('setLifecycleLabel(repo, issueNumber, "plan-ready")');
    expect(approvalPing).toContain('setLifecycleLabel(repo, issueNumber, "plan-approved")');
    expect(executeAndPost).toContain('setLifecycleLabel(repo, prNumber, "ready-to-review")');
  });

  test("the implement labelling branch also flips the originating issue when prNumber !== issueNumber", async () => {
    const source = await Bun.file(new URL("../../commands/action/run/execute-and-post.ts", import.meta.url).pathname).text();
    expect(source).toMatch(/prNumber !== issueNumber/);
    expect(source).toMatch(/setLifecycleLabel\(repo, issueNumber, "ready-to-review"\)/);
  });

  test("post-impl iteration (PR feedback that pushes code) is treated as a code-push flow (regression: PR 6193)", async () => {
    // Regression guard for the 0.5.39 bug: a comment like
    // "Hey AI fix the Lint error" on a PR that already has
    // implementation flips to the post-impl-iteration branch
    // (pushes a code commit). Pre-fix, the labelling logic only
    // looked at `intent.command === "plan"` and applied plan-ready
    // — wrong, no plan was produced. Post-fix, this case is
    // included in `isCodePushFlow` and gets ready-to-review.
    const source = await Bun.file(new URL("../../commands/action/run/execute-and-post.ts", import.meta.url).pathname).text();
    expect(source).toMatch(/const isPostImplFeedback = intent\.isFeedback && isPostImplementation/);
    expect(source).toMatch(/isCodePushFlow =/);
    expect(source).toMatch(/isPostImplFeedback/);
  });

  test("plan refinement on a non-implemented issue still flips to plan-ready, but NOT post-impl iteration", async () => {
    // Companion guard for the previous test: the plan-ready branch
    // must explicitly exclude isPostImplementation, otherwise a
    // post-impl iteration on a refined plan would double-label.
    const source = await Bun.file(new URL("../../commands/action/run/execute-and-post.ts", import.meta.url).pathname).text();
    expect(source).toMatch(/isPlanProducingFlow =\s*\n\s*intent\.command === "plan" && !isPostImplementation/);
  });

  test("quick command (which also pushes code) is in the code-push flow", async () => {
    // Quick fixes also push a new branch + PR — should label
    // ready-to-review, not plan-ready.
    const source = await Bun.file(new URL("../../commands/action/run/execute-and-post.ts", import.meta.url).pathname).text();
    expect(source).toMatch(/intent\.command === "quick"/);
  });
});
