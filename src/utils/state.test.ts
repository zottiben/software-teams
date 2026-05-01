import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readState, writeState, type JDIState } from "./state";

let tempDir: string;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("readState", () => {
  test("returns null when state file does not exist", async () => {
    const dir = makeTempDir();
    const result = await readState(dir);
    expect(result).toBeNull();
  });

  test("reads and parses valid state YAML", async () => {
    const dir = makeTempDir();
    const stateDir = join(dir, ".software-teams", "config");
    mkdirSync(stateDir, { recursive: true });
    await Bun.write(
      join(stateDir, "state.yaml"),
      `position:
  phase: 1
  phase_name: "Test Phase"
  plan: "01"
  plan_name: "Test Plan"
  task: null
  task_name: null
  status: planning
progress:
  phases_total: 1
  phases_completed: 0
  plans_total: 1
  plans_completed: 0
  tasks_total: 2
  tasks_completed: 0
`
    );

    const state = await readState(dir);
    expect(state).not.toBeNull();
    expect(state!.position!.phase).toBe(1);
    expect(state!.position!.phase_name).toBe("Test Phase");
    expect(state!.position!.status).toBe("planning");
    expect(state!.progress!.tasks_total).toBe(2);
  });
});

describe("writeState", () => {
  test("writes state that can be read back (round-trip)", async () => {
    const dir = makeTempDir();
    const stateDir = join(dir, ".software-teams", "config");
    mkdirSync(stateDir, { recursive: true });

    const state: JDIState = {
      position: {
        phase: 2,
        phase_name: "Intelligence Layer",
        plan: "03",
        plan_name: "Learning DB",
        task: "02-03-T1",
        task_name: "Create schema",
        status: "in_progress",
      },
      progress: {
        phases_total: 3,
        phases_completed: 1,
        plans_total: 5,
        plans_completed: 2,
        tasks_total: 4,
        tasks_completed: 1,
      },
    };

    await writeState(dir, state);
    const result = await readState(dir);

    expect(result).not.toBeNull();
    expect(result!.position!.phase).toBe(2);
    expect(result!.position!.plan_name).toBe("Learning DB");
    expect(result!.progress!.tasks_completed).toBe(1);
  });
});
