import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readState } from "../state";
import {
  transitionToPlanReady,
  transitionToApproved,
  advanceTask,
  transitionToExecuting,
  transitionToComplete,
} from "../state-handlers";

let tempDir: string;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-handlers-test-"));
  // Create .software-teams/config dir for state.yaml
  mkdirSync(join(tempDir, ".software-teams", "config"), { recursive: true });
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("transitionToPlanReady", () => {
  test("parses plan frontmatter and populates phase, plan number, and tasks", async () => {
    const dir = makeTempDir();
    // Create a plan file with frontmatter
    const planDir = join(dir, ".software-teams", "plans");
    mkdirSync(planDir, { recursive: true });
    await Bun.write(
      join(planDir, "2-02-test.plan.md"),
      [
        "---",
        "phase: 2",
        'plan: "02"',
        'name: "Test Plan"',
        "task_files:",
        "  - .software-teams/plans/2-02-test.T1.md",
        "  - .software-teams/plans/2-02-test.T2.md",
        "  - .software-teams/plans/2-02-test.T3.md",
        "---",
        "",
        "# Test Plan",
      ].join("\n"),
    );

    await transitionToPlanReady(dir, ".software-teams/plans/2-02-test.plan.md", "Test Plan");

    const state = await readState(dir);
    expect(state).not.toBeNull();

    // Phase and plan number extracted from frontmatter
    expect(state!.position?.phase).toBe(2);
    expect(state!.position?.plan).toBe("02");
    expect(state!.position?.plan_name).toBe("Test Plan");
    expect(state!.position?.status).toBe("planning");

    // Plan path and tasks populated
    expect(state!.current_plan?.path).toBe(".software-teams/plans/2-02-test.plan.md");
    expect(state!.current_plan?.tasks).toEqual([
      ".software-teams/plans/2-02-test.T1.md",
      ".software-teams/plans/2-02-test.T2.md",
      ".software-teams/plans/2-02-test.T3.md",
    ]);
    expect(state!.current_plan?.completed_tasks).toEqual([]);
    expect(state!.current_plan?.current_task_index).toBe(0);

    // Progress populated from task count
    expect(state!.progress?.tasks_total).toBe(3);
    expect(state!.progress?.tasks_completed).toBe(0);

    // Review state
    expect(state!.review?.status).toBe("in_review");
    expect(state!.review?.scope).toBe("plan");
  });

  test("falls back gracefully when plan file has no frontmatter", async () => {
    const dir = makeTempDir();
    const planDir = join(dir, ".software-teams", "plans");
    mkdirSync(planDir, { recursive: true });
    await Bun.write(
      join(planDir, "simple.plan.md"),
      "# Simple Plan\n\nNo frontmatter here.",
    );

    await transitionToPlanReady(dir, ".software-teams/plans/simple.plan.md", "Simple Plan");

    const state = await readState(dir);
    // Should still set the basics
    expect(state!.position?.plan).toBe(".software-teams/plans/simple.plan.md");
    expect(state!.position?.plan_name).toBe("Simple Plan");
    expect(state!.position?.status).toBe("planning");
    expect(state!.current_plan?.tasks).toEqual([]);
    expect(state!.progress?.tasks_total).toBe(0);
  });

  test("falls back gracefully when plan file does not exist", async () => {
    const dir = makeTempDir();

    await transitionToPlanReady(dir, ".software-teams/plans/missing.plan.md", "Missing Plan");

    const state = await readState(dir);
    expect(state!.position?.plan).toBe(".software-teams/plans/missing.plan.md");
    expect(state!.position?.plan_name).toBe("Missing Plan");
    expect(state!.position?.status).toBe("planning");
    expect(state!.current_plan?.tasks).toEqual([]);
  });

  test("preserves existing state fields via spread", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      `position:\n  phase: 1\n  phase_name: "Phase One"\n`,
    );
    // Create plan file with phase 2
    const planDir = join(dir, ".software-teams", "plans");
    mkdirSync(planDir, { recursive: true });
    await Bun.write(
      join(planDir, "plan.md"),
      "---\nphase: 2\nplan: \"01\"\ntask_files: []\n---\n",
    );

    await transitionToPlanReady(dir, ".software-teams/plans/plan.md", "Plan");

    const state = await readState(dir);
    // Phase should be overridden by frontmatter
    expect(state!.position?.phase).toBe(2);
    // phase_name should be preserved from existing state
    expect(state!.position?.phase_name).toBe("Phase One");
  });

  test("resets completed_tasks and current_task_index on new plan", async () => {
    const dir = makeTempDir();
    // Pre-existing state with completed tasks from a prior plan
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "current_plan:",
        "  path: old-plan.md",
        "  tasks:",
        "    - T1",
        "  completed_tasks:",
        "    - T1",
        "  current_task_index: null",
      ].join("\n"),
    );
    const planDir = join(dir, ".software-teams", "plans");
    mkdirSync(planDir, { recursive: true });
    await Bun.write(
      join(planDir, "new.plan.md"),
      "---\nphase: 1\nplan: \"01\"\ntask_files:\n  - .software-teams/plans/new.T1.md\n---\n",
    );

    await transitionToPlanReady(dir, ".software-teams/plans/new.plan.md", "New Plan");

    const state = await readState(dir);
    expect(state!.current_plan?.completed_tasks).toEqual([]);
    expect(state!.current_plan?.current_task_index).toBe(0);
    expect(state!.current_plan?.tasks).toEqual([".software-teams/plans/new.T1.md"]);
  });
});

describe("transitionToApproved", () => {
  test("sets review status to approved with timestamp", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      `review:\n  status: in_review\n  scope: plan\n`,
    );

    await transitionToApproved(dir);

    const state = await readState(dir);
    expect(state!.review?.status).toBe("approved");
    expect(state!.review?.approved_at).toBeTruthy();
    expect(new Date(state!.review!.approved_at!).getTime()).not.toBeNaN();
  });

  test("sets position.status to approved (not just review.status)", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        "  status: planning",
        "review:",
        "  status: in_review",
        "  scope: plan",
      ].join("\n"),
    );

    await transitionToApproved(dir);

    const state = await readState(dir);
    // Regression guard: previously left position.status at "planning" after approval.
    expect(state!.position?.status).toBe("approved");
  });
});

describe("transitionToPlanReady executing-state guard", () => {
  test("throws when current status is executing", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        "  status: executing",
      ].join("\n"),
    );

    expect(
      transitionToPlanReady(dir, ".software-teams/plans/new.plan.md", "New Plan"),
    ).rejects.toThrow(/currently executing/);
  });

  test("succeeds in executing state when force is passed", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        "  status: executing",
      ].join("\n"),
    );
    const planDir = join(dir, ".software-teams", "plans");
    mkdirSync(planDir, { recursive: true });
    await Bun.write(
      join(planDir, "new.plan.md"),
      "---\nphase: 1\nplan: \"02\"\ntask_files: []\n---\n",
    );

    await transitionToPlanReady(
      dir,
      ".software-teams/plans/new.plan.md",
      "New Plan",
      { force: true },
    );

    const state = await readState(dir);
    expect(state!.position?.status).toBe("planning");
    expect(state!.position?.plan).toBe("02");
  });
});

describe("transitionTo* position.status consistency", () => {
  test("each transition writes position.status matching its semantic name", async () => {
    // plan-ready
    {
      const dir = makeTempDir();
      const planDir = join(dir, ".software-teams", "plans");
      mkdirSync(planDir, { recursive: true });
      await Bun.write(
        join(planDir, "p.md"),
        "---\nphase: 1\nplan: \"01\"\ntask_files: []\n---\n",
      );
      await transitionToPlanReady(dir, ".software-teams/plans/p.md", "P");
      const s = await readState(dir);
      expect(s!.position?.status).toBe("planning");
      rmSync(dir, { recursive: true, force: true });
    }
    // approved
    {
      const dir = makeTempDir();
      await Bun.write(
        join(dir, ".software-teams", "config", "state.yaml"),
        `position:\n  status: planning\n`,
      );
      await transitionToApproved(dir);
      const s = await readState(dir);
      expect(s!.position?.status).toBe("approved");
      rmSync(dir, { recursive: true, force: true });
    }
    // executing
    {
      const dir = makeTempDir();
      await Bun.write(
        join(dir, ".software-teams", "config", "state.yaml"),
        `position:\n  status: approved\n`,
      );
      await transitionToExecuting(dir);
      const s = await readState(dir);
      expect(s!.position?.status).toBe("executing");
      rmSync(dir, { recursive: true, force: true });
    }
    // complete
    {
      const dir = makeTempDir();
      await Bun.write(
        join(dir, ".software-teams", "config", "state.yaml"),
        `position:\n  status: executing\n`,
      );
      await transitionToComplete(dir);
      const s = await readState(dir);
      expect(s!.position?.status).toBe("complete");
      rmSync(dir, { recursive: true, force: true });
    }
    // Reset tempDir so afterEach does not try to rm an already-removed dir.
    tempDir = "";
  });
});

describe("transitionToExecuting", () => {
  test("sets status to executing", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      `position:\n  status: planning\n`,
    );

    await transitionToExecuting(dir);

    const state = await readState(dir);
    expect(state!.position?.status).toBe("executing");
  });

  test("sets task ID and name when provided", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      `position:\n  status: planning\n`,
    );

    await transitionToExecuting(dir, "T1", "First task");

    const state = await readState(dir);
    expect(state!.position?.task).toBe("T1");
    expect(state!.position?.task_name).toBe("First task");
  });
});

describe("transitionToComplete", () => {
  test("sets status to complete", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      `position:\n  status: executing\n`,
    );

    await transitionToComplete(dir);

    const state = await readState(dir);
    expect(state!.position?.status).toBe("complete");
  });
});

describe("transitionToComplete roadmap advancement", () => {
  test("advances to next plan when ROADMAP has subsequent plan", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        '  plan_name: "First Plan"',
        "  status: executing",
        "progress:",
        "  plans_completed: 0",
      ].join("\n"),
    );
    await Bun.write(
      join(dir, ".software-teams", "roadmap.yaml"),
      [
        "phases:",
        '  "1":',
        "    plans:",
        '      "01":',
        '        name: "First Plan"',
        '      "02":',
        '        name: "Second Plan"',
      ].join("\n"),
    );

    await transitionToComplete(dir);

    const state = await readState(dir);
    expect(state!.position?.plan).toBe("02");
    expect(state!.position?.plan_name).toBe("Second Plan");
    expect(state!.position?.status).toBe("idle");
  });

  test("increments plans_completed", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        "  status: executing",
        "progress:",
        "  plans_completed: 0",
      ].join("\n"),
    );

    await transitionToComplete(dir);

    const state = await readState(dir);
    expect(state!.progress?.plans_completed).toBe(1);
  });

  test("handles last plan in phase (no next plan)", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        '  plan_name: "Only Plan"',
        "  status: executing",
        "progress:",
        "  plans_completed: 0",
      ].join("\n"),
    );
    await Bun.write(
      join(dir, ".software-teams", "roadmap.yaml"),
      [
        "phases:",
        '  "1":',
        "    plans:",
        '      "01":',
        '        name: "Only Plan"',
      ].join("\n"),
    );

    await transitionToComplete(dir);

    const state = await readState(dir);
    expect(state!.position?.status).toBe("complete");
  });

  test("handles missing roadmap.yaml gracefully", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        "  status: executing",
        "progress:",
        "  plans_completed: 0",
      ].join("\n"),
    );
    // No roadmap.yaml written

    await transitionToComplete(dir);

    const state = await readState(dir);
    expect(state!.position?.status).toBe("complete");
  });

  test("handles malformed roadmap.yaml gracefully", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "position:",
        "  phase: 1",
        '  plan: "01"',
        "  status: executing",
        "progress:",
        "  plans_completed: 0",
      ].join("\n"),
    );
    await Bun.write(
      join(dir, ".software-teams", "roadmap.yaml"),
      "not: valid: yaml: [",
    );

    await transitionToComplete(dir);

    const state = await readState(dir);
    // Should not crash — status should still be set to complete
    expect(state!.position?.status).toBe("complete");
  });
});

describe("advanceTask", () => {
  test("adds task to completed_tasks and advances index", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "current_plan:",
        "  path: plan.md",
        "  tasks:",
        "    - T1",
        "    - T2",
        "    - T3",
        "  completed_tasks: []",
        "  current_task_index: 0",
        "progress:",
        "  tasks_total: 3",
        "  tasks_completed: 0",
      ].join("\n"),
    );

    await advanceTask(dir, "T1");

    const state = await readState(dir);
    expect(state!.current_plan?.completed_tasks).toContain("T1");
    expect(state!.current_plan?.current_task_index).toBe(1);
    expect(state!.progress?.tasks_completed).toBe(1);
  });

  test("sets current_task_index to null when all tasks done", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "current_plan:",
        "  path: plan.md",
        "  tasks:",
        "    - T1",
        "  completed_tasks: []",
        "  current_task_index: 0",
        "progress:",
        "  tasks_total: 1",
        "  tasks_completed: 0",
      ].join("\n"),
    );

    await advanceTask(dir, "T1");

    const state = await readState(dir);
    expect(state!.current_plan?.current_task_index).toBeNull();
  });

  test("does not add duplicate task IDs", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "current_plan:",
        "  path: plan.md",
        "  tasks:",
        "    - T1",
        "    - T2",
        "  completed_tasks:",
        "    - T1",
        "  current_task_index: 1",
        "progress:",
        "  tasks_total: 2",
        "  tasks_completed: 1",
      ].join("\n"),
    );

    await advanceTask(dir, "T1");

    const state = await readState(dir);
    const t1Count = state!.current_plan!.completed_tasks!.filter((t) => t === "T1").length;
    expect(t1Count).toBe(1);
  });

  test("initializes progress if it does not exist", async () => {
    const dir = makeTempDir();
    await Bun.write(
      join(dir, ".software-teams", "config", "state.yaml"),
      [
        "current_plan:",
        "  path: plan.md",
        "  tasks:",
        "    - T1",
        "  completed_tasks: []",
        "  current_task_index: 0",
      ].join("\n"),
    );

    await advanceTask(dir, "T1");

    const state = await readState(dir);
    expect(state!.progress).toBeTruthy();
    expect(state!.progress?.tasks_completed).toBe(1);
  });
});
