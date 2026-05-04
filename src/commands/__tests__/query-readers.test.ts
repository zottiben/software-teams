import { describe, test, expect, afterEach } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const CLI = join(REPO_ROOT, "src", "index.ts");

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "st-readers-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Spawn the CLI synchronously. NODE_ENV is forced to "production" because
 * `bun test` sets NODE_ENV=test in the parent env and Bun's bundler inlines
 * `process.env` checks — under NODE_ENV=test the bundled consola binding
 * goes silent, swallowing CLI output. Same workaround as component.test.ts.
 */
function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const env = { ...process.env, NODE_ENV: "production" } as Record<string, string>;
  const result = spawnSync(["bun", "run", CLI, ...args], { cwd, env });
  const stdout = result.stdout ? Buffer.from(result.stdout).toString("utf-8") : "";
  const stderr = result.stderr ? Buffer.from(result.stderr).toString("utf-8") : "";
  const exitCode = result.exitCode ?? 0;
  return { stdout, stderr, exitCode };
}

async function seedProject(): Promise<string> {
  const dir = makeTempDir();
  mkdirSync(join(dir, ".software-teams"), { recursive: true });
  mkdirSync(join(dir, ".software-teams", "plans"), { recursive: true });

  await writeFile(
    join(dir, ".software-teams", "state.yaml"),
    [
      "position:",
      "  phase: 1",
      '  plan: "01"',
      '  plan_name: "Demo Plan"',
      "  status: executing",
      "  task: T2",
      "  task_name: Implement widget",
      "current_plan:",
      '  path: ".software-teams/plans/1-01-demo.orchestration.md"',
      "  tasks:",
      "    - .software-teams/plans/1-01-demo.T1.md",
      "    - .software-teams/plans/1-01-demo.T2.md",
      "    - .software-teams/plans/1-01-demo.T3.md",
      "  completed_tasks:",
      "    - .software-teams/plans/1-01-demo.T1.md",
      "  current_task_index: 1",
      "progress:",
      "  phases_total: 1",
      "  phases_completed: 0",
      "  plans_total: 1",
      "  plans_completed: 0",
      "  tasks_total: 3",
      "  tasks_completed: 1",
      "",
    ].join("\n"),
  );

  await writeFile(
    join(dir, ".software-teams", "project.yaml"),
    [
      'name: "Demo Project"',
      'summary: "for tests"',
      "tech_stack:",
      "  backend: node-express",
      "  frontend: react-typescript",
      "  devops: null",
      "",
    ].join("\n"),
  );

  await writeFile(
    join(dir, ".software-teams", "roadmap.yaml"),
    [
      "overview:",
      "  total_phases: 1",
      "  active: [1]",
      "phases:",
      '  "1":',
      '    name: "Phase One"',
      '    goal: "Ship the widget"',
      "    status: pending",
      "    plans:",
      '      "01":',
      '        name: "Demo Plan"',
      "        tasks: 3",
      "        waves: [1]",
      "        status: pending",
      '      "02":',
      '        name: "Followup"',
      "        tasks: 1",
      "        waves: [2]",
      "        status: pending",
      "",
    ].join("\n"),
  );

  await writeFile(
    join(dir, ".software-teams", "requirements.yaml"),
    [
      "phases:",
      '  "1":',
      "    requirements:",
      "      REQ-01:",
      '        description: "Widget renders correctly"',
      "        priority: must",
      "        status: pending",
      "        tasks:",
      "          - T1",
      "          - T2",
      "      REQ-02:",
      '        description: "Widget persists"',
      "        priority: should",
      "        status: pending",
      "        tasks:",
      "          - T3",
      "risks:",
      "  - id: R-01",
      '    description: "browser support gap"',
      '    mitigation: "polyfill"',
      "",
    ].join("\n"),
  );

  await writeFile(
    join(dir, ".software-teams", "plans", "1-01-demo.spec.md"),
    [
      "---",
      "tier: spec",
      "---",
      "",
      "## Problem",
      "",
      "Widget is missing.",
      "",
      "## Acceptance Criteria",
      "",
      "- Renders",
      "- Persists",
      "",
      "## Out of Scope",
      "",
      "Login.",
      "",
    ].join("\n"),
  );

  await writeFile(
    join(dir, ".software-teams", "plans", "1-01-demo.orchestration.md"),
    [
      "---",
      "tier: orchestration",
      "task_files:",
      "  - .software-teams/plans/1-01-demo.T1.md",
      "  - .software-teams/plans/1-01-demo.T2.md",
      "  - .software-teams/plans/1-01-demo.T3.md",
      "---",
      "",
      "## Tasks",
      "",
      "| ID | Name |",
      "|----|------|",
      "| T1 | Build |",
      "| T2 | Wire  |",
      "| T3 | Test  |",
      "",
      "## Quality Gates",
      "",
      "Unit + a11y.",
      "",
      "## Risks",
      "",
      "Browser support.",
      "",
    ].join("\n"),
  );

  for (const id of ["T1", "T2", "T3"]) {
    await writeFile(
      join(dir, ".software-teams", "plans", `1-01-demo.${id}.md`),
      [
        "---",
        `task_id: ${id}`,
        "tier: per-agent",
        "agent: software-teams-frontend",
        "wave: 1",
        "requires: [r1]",
        "provides: [p1]",
        "depends_on: []",
        "affects: []",
        "---",
        "",
        `# Task ${id}`,
        "",
        "Body content.",
        "",
      ].join("\n"),
    );
  }

  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("state readers", () => {
  test("state get walks dotted paths", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["state", "get", "position.plan"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("01");
  });

  test("state current-task returns active task slice", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["state", "current-task", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.id).toBe("T2");
    expect(parsed.path).toContain("T2.md");
  });

  test("state next-task returns first uncompleted task", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["state", "next-task"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toContain("T2.md");
  });

  test("state plan-tasks lists every task path", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["state", "plan-tasks"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim().split("\n").length).toBe(3);
    expect(r.stdout).toContain("T1.md");
    expect(r.stdout).toContain("T3.md");
  });
});

describe("plan readers", () => {
  test("plan list returns all slugs", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["plan", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("1-01-demo");
  });

  test("plan get-task --plan returns one slice", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["plan", "get-task", "--plan", "1-01-demo", "T2"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# Task T2");
    expect(r.stdout).not.toContain("# Task T3");
  });

  test("plan get-spec --section returns one section", async () => {
    const dir = await seedProject();
    const r = runCli(dir, [
      "plan",
      "get-spec",
      "--plan",
      "1-01-demo",
      "--section",
      "acceptance-criteria",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("## Acceptance Criteria");
    expect(r.stdout).not.toContain("## Problem");
  });

  test("plan get-orchestration --section returns one section", async () => {
    const dir = await seedProject();
    const r = runCli(dir, [
      "plan",
      "get-orchestration",
      "--plan",
      "1-01-demo",
      "--section",
      "risks",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("## Risks");
    expect(r.stdout).not.toContain("## Tasks");
  });

  test("plan task-deps returns just dep frontmatter", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["plan", "task-deps", "--plan", "1-01-demo", "--json", "T1"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.task_id).toBe("T1");
    expect(parsed.requires).toEqual(["r1"]);
    expect(parsed.agent).toBe("software-teams-frontend");
  });
});

describe("roadmap readers", () => {
  test("current-phase returns active phase", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["roadmap", "current-phase", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.id).toBe("1");
    expect(parsed.name).toBe("Phase One");
  });

  test("list-plans returns one row per plan", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["roadmap", "list-plans", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ plan: string }>;
    expect(parsed.length).toBe(2);
    expect(parsed.map((p) => p.plan).sort()).toEqual(["01", "02"]);
  });

  test("get-plan returns one entry", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["roadmap", "get-plan", "--phase", "1", "--plan", "02", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.name).toBe("Followup");
  });
});

describe("requirements readers", () => {
  test("get returns one requirement", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["requirements", "get", "REQ-01", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.id).toBe("REQ-01");
    expect(parsed.tasks).toEqual(["T1", "T2"]);
  });

  test("for-task reverses traceability", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["requirements", "for-task", "T1", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ id: string }>;
    expect(parsed.map((m) => m.id)).toEqual(["REQ-01"]);
  });

  test("risks returns just the array", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["requirements", "risks", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ id: string }>;
    expect(parsed[0].id).toBe("R-01");
  });
});

describe("project readers", () => {
  test("tech-stack returns just the block", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["project", "tech-stack", "--json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.backend).toBe("node-express");
    expect(parsed.frontend).toBe("react-typescript");
    expect(parsed.devops).toBe(null);
  });

  test("get walks dotted paths", async () => {
    const dir = await seedProject();
    const r = runCli(dir, ["project", "get", "tech_stack.backend"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("node-express");
  });
});
