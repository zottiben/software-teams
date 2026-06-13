import { describe, test, expect } from "bun:test";
import { buildWorkflowScript, groupByWave } from "../compile-workflow";
import type { ParsedOrchestration, OrchestrationTask } from "../parse-orchestration";

function task(over: Partial<OrchestrationTask>): OrchestrationTask {
  return {
    taskId: "T1",
    name: "Task",
    agent: "software-teams-backend",
    wave: 1,
    dependsOn: [],
    slice: "demo.T1.md",
    ...over,
  };
}

const parsed: ParsedOrchestration = {
  planId: "01-01",
  slug: "demo-feature",
  tier: "orchestration",
  specLink: "demo-feature.spec.md",
  tasks: [
    task({ taskId: "T1", name: "Backend API", agent: "software-teams-backend", wave: 1, slice: "demo-feature.T1.md" }),
    task({ taskId: "T2", name: "Frontend UI", agent: "software-teams-frontend", wave: 1, slice: "demo-feature.T2.md" }),
    task({ taskId: "T3", name: "Wire together", agent: "software-teams-programmer", wave: 2, dependsOn: ["T1", "T2"], slice: "demo-feature.T3.md" }),
  ],
  frontmatter: {},
};

describe("groupByWave", () => {
  test("groups tasks by wave and sorts ascending", () => {
    const out = groupByWave([
      task({ taskId: "A", wave: 2 }),
      task({ taskId: "B", wave: 1 }),
      task({ taskId: "C", wave: 2 }),
    ]);
    expect(out.map(([w]) => w)).toEqual([1, 2]);
    expect(out[1]![1].map((t) => t.taskId)).toEqual(["A", "C"]);
  });
});

describe("buildWorkflowScript", () => {
  test("emits a valid Workflow header + meta", () => {
    const s = buildWorkflowScript(parsed);
    expect(s.startsWith("// AUTO-GENERATED")).toBe(true);
    expect(s).toContain("export const meta = {");
    expect(s).toContain(`name: "st-impl-demo-feature"`);
  });

  test("one phase per wave plus Verify; tasks pinned to their agentType", () => {
    const s = buildWorkflowScript(parsed);
    expect(s).toContain(`phase("Wave 1")`);
    expect(s).toContain(`phase("Wave 2")`);
    expect(s).toContain(`phase("Verify")`);
    expect(s).toContain(`agentType: "software-teams-backend"`);
    expect(s).toContain(`agentType: "software-teams-frontend"`);
    expect(s).toContain(`agentType: "software-teams-programmer"`);
    expect(s).toContain(`agentType: "software-teams-qa-tester"`);
    // 3 task agents + 1 qa agent
    expect((s.match(/agentType:/g) ?? []).length).toBe(4);
    // each wave is a barrier
    expect((s.match(/await parallel\(/g) ?? []).length).toBe(2);
  });

  test("--no-qa omits the Verify phase and verification return", () => {
    const s = buildWorkflowScript(parsed, { qa: false });
    expect(s).not.toContain(`phase("Verify")`);
    expect(s).not.toContain("software-teams-qa-tester");
    expect(s).toContain(`return { slug: "demo-feature", tasks: results }`);
  });

  test("escapes backticks / ${ in task names so the script stays valid JS", () => {
    const s = buildWorkflowScript({
      ...parsed,
      tasks: [task({ taskId: "T1", name: "Add `foo` and ${bar}", slice: "x.T1.md" })],
    });
    expect(s).toContain("Add \\`foo\\` and \\${bar}");
    // no raw unescaped backtick from the name leaking into the template
    expect(s).not.toContain("Add `foo`");
  });

  test("throws when the plan has no tasks", () => {
    expect(() => buildWorkflowScript({ ...parsed, tasks: [] })).toThrow(/no tasks/);
  });
});
