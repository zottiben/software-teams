import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const frameworkRoot = join(import.meta.dir, "..", "framework");

function readFrameworkFile(relativePath: string): string {
  const fullPath = join(frameworkRoot, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Framework file not found: ${relativePath} (expected at ${fullPath})`);
  }
  return readFileSync(fullPath, "utf-8");
}

describe("framework file invariants", () => {
  test("agents/jdi-planner.md contains required directives", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");

    // Must have file writing directive (agents need to know they can/must write files)
    expect(content).toMatch(/file permissions|Write tool|MUST.*write/i);

    // Must reference split format
    expect(content).toMatch(/split format|SPLIT FORMAT/i);

    // Must reference task files (T{n}.md pattern or "task file")
    expect(content).toMatch(/T\{?\d*n?\d*\}?\.md|task.file/i);

    // Must reference task_files frontmatter key
    expect(content).toContain("task_files");
  });

  test("commands/create-plan.md references split format", () => {
    const content = readFrameworkFile("commands/create-plan.md");

    // Must reference split or task file
    expect(content).toMatch(/split|task.file/i);

    // Must NOT say "creates PLAN.md" (monolithic format)
    expect(content).not.toContain("creates PLAN.md");
  });

  test("commands/implement-plan.md references task files", () => {
    const content = readFrameworkFile("commands/implement-plan.md");
    expect(content).toMatch(/task_files|task.file|split.plan/i);
  });

  test("templates/PLAN.md contains task_files frontmatter", () => {
    const content = readFrameworkFile("templates/PLAN.md");
    expect(content).toContain("task_files:");
  });

  test("templates/PLAN-TASK.md exists and has task_id", () => {
    const fullPath = join(frameworkRoot, "templates/PLAN-TASK.md");
    expect(existsSync(fullPath)).toBe(true);

    const content = readFrameworkFile("templates/PLAN-TASK.md");
    expect(content).toContain("task_id");
  });

  test("agents/jdi-backend.md references learnings", () => {
    const content = readFrameworkFile("agents/jdi-backend.md");
    expect(content).toMatch(/learnings/i);
  });

  test("agents/jdi-frontend.md references learnings", () => {
    const content = readFrameworkFile("agents/jdi-frontend.md");
    expect(content).toMatch(/learnings/i);
  });

  test("components/meta/ComplexityRouter.md references task files", () => {
    const content = readFrameworkFile("components/meta/ComplexityRouter.md");
    expect(content).toMatch(/TASK_FILE|task.file|task_file/i);
  });

  test("components/meta/SilentDiscovery.md includes test suite detection", () => {
    const content = readFrameworkFile("components/meta/SilentDiscovery.md");
    expect(content).toMatch(/test.suite|test_suite/i);
    expect(content).toMatch(/\.test\.\*|\.spec\.\*/);
  });

  test("commands/create-plan.md includes --with-tests and --without-tests flags", () => {
    const content = readFrameworkFile("commands/create-plan.md");
    expect(content).toContain("--with-tests");
    expect(content).toContain("--without-tests");
  });

  test("agents/jdi-planner.md includes test task generation", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");
    expect(content).toMatch(/test.task.generation|Test Task Generation/i);
    expect(content).toMatch(/type:\s*test/);
    expect(content).toContain("jdi-qa-tester");
  });

  test("agents/jdi-qa-tester.md includes plan-test mode", () => {
    const content = readFrameworkFile("agents/jdi-qa-tester.md");
    expect(content).toContain("plan-test");
  });

  test("commands/implement-plan.md handles test task type", () => {
    const content = readFrameworkFile("commands/implement-plan.md");
    expect(content).toMatch(/type:\s*test|type: test/);
  });

  test("components/planning/TaskBreakdown.md includes test task rules", () => {
    const content = readFrameworkFile("components/planning/TaskBreakdown.md");
    expect(content).toMatch(/Test Task Rules|test task/i);
    expect(content).toMatch(/type.*test/i);
  });

  test("agents/jdi-plan-checker.md accepts 2+ tasks in scope sanity", () => {
    const content = readFrameworkFile("agents/jdi-plan-checker.md");
    expect(content).toMatch(/2\+/);
    expect(content).not.toMatch(/2-4 tasks/);
  });

  test("agents/jdi-planner.md task sizing says 2+ not 2-4", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");
    expect(content).toMatch(/Tasks per plan.*2\+/);
  });

  test("agents/jdi-planner.md Step 3 task format includes type test", () => {
    const content = readFrameworkFile("agents/jdi-planner.md");
    expect(content).toMatch(/type:.*test/);
  });

  test("templates/PLAN-TASK.md includes test task variant", () => {
    const content = readFrameworkFile("templates/PLAN-TASK.md");
    expect(content).toMatch(/test.task.variant|Test Task Variant/i);
    expect(content).toMatch(/test_scope|test_framework/);
  });
});
