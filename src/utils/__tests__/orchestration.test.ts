import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findActiveOrchestration, agentTypeToRoleLabel } from "../orchestration";

let tempDir: string;
function makeProject(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-orch-"));
  mkdirSync(join(tempDir, ".software-teams"), { recursive: true });
  mkdirSync(join(tempDir, ".software-teams", "plans"), { recursive: true });
  return tempDir;
}

function seedSlice(plansDir: string, name: string, agent: string, body = "task body\n") {
  writeFileSync(
    join(plansDir, name),
    `---\nagent: ${agent}\ntier: per-agent\nspec_link: foo.spec.md\norchestration_link: foo.orchestration.md\n---\n\n${body}`,
  );
}

function seedOrchestration(
  plansDir: string,
  name: string,
  opts: { taskFiles: string[]; specLink?: string; primary?: string },
) {
  const lines = [
    "---",
    `available_agents: ["software-teams-frontend", "software-teams-backend"]`,
    `primary_agent: ${opts.primary ?? "software-teams-frontend"}`,
    "task_files:",
    ...opts.taskFiles.map((f) => `  - ${f}`),
    ...(opts.specLink ? [`spec_link: ${opts.specLink}`] : []),
    "---",
    "",
    "## Tasks",
    "",
  ];
  writeFileSync(join(plansDir, name), lines.join("\n"));
}

function seedState(cwd: string, currentPlanPath: string | null) {
  const body = currentPlanPath
    ? `current_plan:\n  path: ${currentPlanPath}\n  tasks: []\n  completed_tasks: []\n  current_task_index: null\n`
    : `current_plan:\n  path: null\n  tasks: []\n  completed_tasks: []\n  current_task_index: null\n`;
  writeFileSync(join(cwd, ".software-teams", "state.yaml"), body);
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("findActiveOrchestration", () => {
  test("returns null when no plans directory exists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "st-empty-"));
    tempDir = cwd;
    expect(await findActiveOrchestration(cwd)).toBeNull();
  });

  test("returns null when no orchestration file exists in plans dir", async () => {
    const cwd = makeProject();
    expect(await findActiveOrchestration(cwd)).toBeNull();
  });

  test("uses state.yaml `current_plan.path` when it points at an orchestration file", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedSlice(plans, "p.T1.md", "software-teams-frontend");
    seedSlice(plans, "p.T2.md", "software-teams-backend");
    seedOrchestration(plans, "p.orchestration.md", { taskFiles: ["p.T1.md", "p.T2.md"] });
    seedState(cwd, ".software-teams/plans/p.orchestration.md");

    const result = await findActiveOrchestration(cwd);
    expect(result?.orchestrationPath).toBe(".software-teams/plans/p.orchestration.md");
    expect(result?.slices).toHaveLength(2);
    expect(result?.slices[0].agentType).toBe("software-teams-frontend");
    expect(result?.slices[1].agentType).toBe("software-teams-backend");
  });

  test("falls back to most-recent `.orchestration.md` when state.yaml is empty", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedSlice(plans, "p.T1.md", "software-teams-frontend");
    seedOrchestration(plans, "p.orchestration.md", { taskFiles: ["p.T1.md"] });
    seedState(cwd, null);

    const result = await findActiveOrchestration(cwd);
    expect(result?.orchestrationPath).toBe(".software-teams/plans/p.orchestration.md");
  });

  test("derives orchestration path when state.yaml points at a `.plan.md` index", async () => {
    // Some legacy plans land single-tier, then get upgraded. state.yaml may
    // still point at the `.plan.md` after upgrade.
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedSlice(plans, "p.T1.md", "software-teams-frontend");
    seedOrchestration(plans, "p.orchestration.md", { taskFiles: ["p.T1.md"] });
    writeFileSync(join(plans, "p.plan.md"), "stub\n");
    seedState(cwd, ".software-teams/plans/p.plan.md");

    const result = await findActiveOrchestration(cwd);
    expect(result?.orchestrationPath).toBe(".software-teams/plans/p.orchestration.md");
  });

  test("skips slices that don't exist on disk and slices missing `agent:`", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedSlice(plans, "p.T1.md", "software-teams-frontend");
    // T2 missing on disk — referenced in task_files but not created.
    // T3 exists but has no `agent:` frontmatter (manually written).
    writeFileSync(join(plans, "p.T3.md"), "---\ntier: per-agent\n---\n\nbody\n");
    seedOrchestration(plans, "p.orchestration.md", { taskFiles: ["p.T1.md", "p.T2.md", "p.T3.md"] });

    const result = await findActiveOrchestration(cwd);
    expect(result?.slices).toHaveLength(1);
    expect(result?.slices[0].slicePath).toContain("p.T1.md");
  });

  test("returns null when orchestration declares no usable slices", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedOrchestration(plans, "p.orchestration.md", { taskFiles: [] });
    expect(await findActiveOrchestration(cwd)).toBeNull();
  });

  test("resolves SPEC path via explicit `spec_link:` frontmatter when present", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedSlice(plans, "p.T1.md", "software-teams-frontend");
    writeFileSync(join(plans, "p.spec.md"), "spec body\n");
    seedOrchestration(plans, "p.orchestration.md", {
      taskFiles: ["p.T1.md"],
      specLink: ".software-teams/plans/p.spec.md",
    });

    const result = await findActiveOrchestration(cwd);
    expect(result?.specPath).toBe(".software-teams/plans/p.spec.md");
  });

  test("derives SPEC path from slug when frontmatter lacks `spec_link:`", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    seedSlice(plans, "p.T1.md", "software-teams-frontend");
    writeFileSync(join(plans, "p.spec.md"), "spec\n");
    seedOrchestration(plans, "p.orchestration.md", { taskFiles: ["p.T1.md"] });

    const result = await findActiveOrchestration(cwd);
    expect(result?.specPath).toBe(".software-teams/plans/p.spec.md");
  });

  test("returns null when orchestration frontmatter is malformed", async () => {
    const cwd = makeProject();
    const plans = join(cwd, ".software-teams", "plans");
    writeFileSync(join(plans, "p.orchestration.md"), "no frontmatter at all\n");
    expect(await findActiveOrchestration(cwd)).toBeNull();
  });
});

describe("agentTypeToRoleLabel", () => {
  test("maps the well-known software-teams-* names to user-facing role labels", () => {
    expect(agentTypeToRoleLabel("software-teams-planner")).toBe("The Planning Agent");
    expect(agentTypeToRoleLabel("software-teams-programmer")).toBe("The Implementation Agent");
    expect(agentTypeToRoleLabel("software-teams-frontend")).toBe("The Frontend Agent");
    expect(agentTypeToRoleLabel("software-teams-backend")).toBe("The Backend Agent");
    expect(agentTypeToRoleLabel("software-teams-qa-tester")).toBe("The QA Agent");
    expect(agentTypeToRoleLabel("software-teams-quality")).toBe("The Quality Agent");
    expect(agentTypeToRoleLabel("software-teams-security")).toBe("The Security Agent");
    expect(agentTypeToRoleLabel("software-teams-pr-feedback")).toBe("The Feedback Agent");
  });

  test("falls back to Title-cased suffix for unknown software-teams-* agents", () => {
    expect(agentTypeToRoleLabel("software-teams-novel-role")).toBe("The Novel Role Agent");
  });

  test("falls back to Title-cased input for non-software-teams subagents (general-purpose etc.)", () => {
    expect(agentTypeToRoleLabel("general-purpose")).toBe("The General Purpose Agent");
    expect(agentTypeToRoleLabel("unity-specialist")).toBe("The Unity Specialist Agent");
  });
});
