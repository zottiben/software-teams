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
    const source = await Bun.file(new URL("../../commands/action/run.ts", import.meta.url).pathname).text();
    expect(source).toContain('setLifecycleLabel(opts.repo, opts.issueNumber, "questions-pending")');
    expect(source).toContain('setLifecycleLabel(repo, issueNumber, "plan-ready")');
    expect(source).toContain('setLifecycleLabel(repo, issueNumber, "plan-approved")');
    expect(source).toContain('setLifecycleLabel(repo, prNumber, "ready-to-review")');
  });

  test("the implement labelling branch also flips the originating issue when prNumber !== issueNumber", async () => {
    const source = await Bun.file(new URL("../../commands/action/run.ts", import.meta.url).pathname).text();
    expect(source).toMatch(/prNumber !== issueNumber/);
    expect(source).toMatch(/setLifecycleLabel\(repo, issueNumber, "ready-to-review"\)/);
  });
});
