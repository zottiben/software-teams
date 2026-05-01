import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildImplementPrompt,
  detectPlanTier,
  type PromptContext,
} from "../utils/prompt-builder";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "st-impl-1tier-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeCtx(cwd: string, overrides?: Partial<PromptContext>): PromptContext {
  return {
    cwd,
    projectType: "typescript",
    techStack: "typescript, bun",
    qualityGates: "default",
    learningsPath: null,
    codebaseIndexPath: null,
    adapter: null,
    ...overrides,
  };
}

const LEGACY_PLAN = `---
plan_id: 8-01
slug: 8-01-single-tier-fixture
task_files:
  - 8-01-single-tier-fixture.T1.md
  - 8-01-single-tier-fixture.T2.md
  - 8-01-single-tier-fixture.T3.md
---

# Legacy Single-Tier Fixture

## Tasks

- T1: Build it
- T2: Wire it
- T3: Test it
`;

function makeLegacyTask(taskId: string) {
  return `---
plan_id: 8-01
task_id: 8-01-${taskId}
type: auto
size: M
priority: should
wave: 1
depends_on: []
agent: software-teams-backend
---

# Task ${taskId}

**Objective:** Legacy single-tier task.
`;
}

async function writeSingleTierFixture(dir: string): Promise<{ slug: string; planDir: string }> {
  const slug = "8-01-single-tier-fixture";
  const planDir = join(dir, ".software-teams", "plans");
  await mkdir(planDir, { recursive: true });
  await writeFile(join(planDir, `${slug}.plan.md`), LEGACY_PLAN);
  for (const id of ["T1", "T2", "T3"]) {
    await writeFile(join(planDir, `${slug}.${id}.md`), makeLegacyTask(id));
  }
  return { slug, planDir };
}

describe("single-tier (legacy) plan detection + prompt", () => {
  test("detectPlanTier identifies a legacy plan as single-tier", async () => {
    const dir = await makeTempDir();
    const { slug, planDir } = await writeSingleTierFixture(dir);

    const planPath = `.software-teams/plans/${slug}.plan.md`;
    const result = detectPlanTier(dir, planPath);
    expect(result.tier).toBe("single-tier");
    expect(result.planPath).toBe(join(planDir, `${slug}.plan.md`));
    expect(result.orchestrationPath).toBeNull();
  });

  test("buildImplementPrompt signals single-tier when no orchestration exists", async () => {
    const dir = await makeTempDir();
    const { slug } = await writeSingleTierFixture(dir);

    const prompt = buildImplementPrompt(makeCtx(dir), `.software-teams/plans/${slug}.plan.md`);
    expect(prompt).toContain("Plan tier: single-tier");
    // Single-tier path must NOT advertise three-tier fields. The substring
    // "ORCHESTRATION:" appears inside the inlined AgentTeamsOrchestration
    // spawn-template documentation, so we look only at the tier line itself
    // (it carries the single-tier / three-tier label and any path).
    expect(prompt).not.toContain("Plan tier: three-tier");
    const tierLine = prompt.split("\n").find((l) => l.startsWith("Plan tier:")) ?? "";
    expect(tierLine).not.toMatch(/\.orchestration\.md/);
  });

  test("single-tier plan still includes the canonical implementation orchestration steps", async () => {
    const dir = await makeTempDir();
    const { slug } = await writeSingleTierFixture(dir);

    const prompt = buildImplementPrompt(makeCtx(dir), `.software-teams/plans/${slug}.plan.md`);
    // The implement-plan skill drives the actual Single-Tier vs Three-Tier
    // execution loop based on tier detection — but the prompt MUST tell the
    // orchestrator to read the canonical index in either tier and surface
    // the Complexity Routing component body.
    expect(prompt).toMatch(/PLAN\.md|canonical index/);
    expect(prompt).toContain("## Complexity Routing");
  });

  test("override flag passes through on single-tier", async () => {
    const dir = await makeTempDir();
    const { slug } = await writeSingleTierFixture(dir);
    const prompt = buildImplementPrompt(makeCtx(dir), `.software-teams/plans/${slug}.plan.md`, "--single");
    expect(prompt).toContain("--single");
    expect(prompt).toContain("Plan tier: single-tier");
  });
});
