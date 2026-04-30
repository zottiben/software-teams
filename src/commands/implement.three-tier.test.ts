import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildImplementPrompt,
  detectPlanTier,
  type PromptContext,
} from "../utils/prompt-builder";
import { parseOrchestration } from "../utils/parse-orchestration";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "st-impl-3tier-"));
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

const SPEC = `---
plan_id: 9-01
slug: 9-01-three-tier-fixture
tier: spec
---

# Three-Tier Fixture — Specification

## Acceptance Criteria

- [ ] AC-1 The system parses orchestration files
- [ ] AC-2 The orchestrator spawns the right agent per slice
- [ ] AC-3 Wave gates are honoured

## Out of Scope

- Anything not in AC.
`;

const ORCHESTRATION = `---
plan_id: 9-01
slug: 9-01-three-tier-fixture
tier: orchestration
spec_link: 9-01-three-tier-fixture.spec.md
available_agents: [software-teams-backend, software-teams-qa-tester]
primary_agent: software-teams-backend
---

# Three-Tier Fixture — Orchestration

## Tasks

| ID | Name | Agent | Wave | Depends On | Slice |
|----|------|-------|------|------------|-------|
| T1 | Build parser | software-teams-backend | 1 | — | \`9-01-three-tier-fixture.T1.md\` |
| T2 | Build runner | software-teams-backend | 1 | — | \`9-01-three-tier-fixture.T2.md\` |
| T3 | Wire it      | software-teams-backend | 2 | T1, T2 | \`9-01-three-tier-fixture.T3.md\` |
| T4 | Test it      | software-teams-qa-tester | 3 | T3 | \`9-01-three-tier-fixture.T4.md\` |

## Sequencing Rules

- Wave gates are honoured.
`;

function makeSlice(taskId: string, agent: string, wave: number, dependsOn: string[], readFirst: string) {
  return `---
plan_id: 9-01
task_id: 9-01-${taskId}
tier: per-agent
spec_link: 9-01-three-tier-fixture.spec.md
orchestration_link: 9-01-three-tier-fixture.orchestration.md
type: auto
size: M
priority: should
wave: ${wave}
depends_on: ${JSON.stringify(dependsOn)}
agent: ${agent}
agent_rationale: "Fixture"
---

# Task ${taskId}: Fixture slice

**Read first:** ${readFirst}

**Objective:** Fixture for tests.

**Files:**
- src/foo.ts - placeholder

**Implementation:**
1. Do the thing

**Verification:**
- [ ] It works

**Done when:**
- The fixture matches.
`;
}

async function writeThreeTierFixture(dir: string): Promise<{ slug: string; planDir: string }> {
  const slug = "9-01-three-tier-fixture";
  const planDir = join(dir, ".software-teams", "plans");
  await mkdir(planDir, { recursive: true });
  await writeFile(join(planDir, `${slug}.spec.md`), SPEC);
  await writeFile(join(planDir, `${slug}.orchestration.md`), ORCHESTRATION);
  await writeFile(
    join(planDir, `${slug}.T1.md`),
    makeSlice("T1", "software-teams-backend", 1, [], "SPEC §Acceptance Criteria item AC-1"),
  );
  await writeFile(
    join(planDir, `${slug}.T2.md`),
    makeSlice("T2", "software-teams-backend", 1, [], "SPEC §Acceptance Criteria item AC-2"),
  );
  await writeFile(
    join(planDir, `${slug}.T3.md`),
    makeSlice("T3", "software-teams-backend", 2, ["T1", "T2"], "ORCHESTRATION §Sequencing Rules"),
  );
  await writeFile(
    join(planDir, `${slug}.T4.md`),
    makeSlice("T4", "software-teams-qa-tester", 3, ["T3"], "SPEC §Acceptance Criteria item AC-3"),
  );
  return { slug, planDir };
}

describe("three-tier plan detection + spawn prompt", () => {
  test("detectPlanTier identifies a three-tier fixture as three-tier", async () => {
    const dir = await makeTempDir();
    const { slug, planDir } = await writeThreeTierFixture(dir);

    const planPath = `.software-teams/plans/${slug}.orchestration.md`;
    const result = detectPlanTier(dir, planPath);
    expect(result.tier).toBe("three-tier");
    expect(result.orchestrationPath).toBe(join(planDir, `${slug}.orchestration.md`));
  });

  test("buildImplementPrompt for a three-tier plan signals the tier and orchestration path", async () => {
    const dir = await makeTempDir();
    const { slug, planDir } = await writeThreeTierFixture(dir);

    const ctx = makeCtx(dir);
    const planPath = `.software-teams/plans/${slug}.orchestration.md`;
    const prompt = buildImplementPrompt(ctx, planPath);

    expect(prompt).toContain("Plan tier: three-tier");
    expect(prompt).toContain(join(planDir, `${slug}.orchestration.md`));
    // Three-tier prompts must signal the per-slice spawn discipline.
    expect(prompt).toMatch(/per-agent slice|slice/i);
    // Three-tier prompts must NOT bundle every task file into one spawn.
    expect(prompt).not.toContain("ALL task files");
    expect(prompt).not.toMatch(/\bevery other task's slice\b/);
  });

  test("buildImplementPrompt three-tier output does not include the legacy single-tier-only signal", async () => {
    const dir = await makeTempDir();
    const { slug } = await writeThreeTierFixture(dir);
    const prompt = buildImplementPrompt(makeCtx(dir), `.software-teams/plans/${slug}.orchestration.md`);
    expect(prompt).not.toContain("Plan tier: single-tier");
  });

  test("parseOrchestration on the fixture returns the four tasks with correct waves and deps", async () => {
    const dir = await makeTempDir();
    const { slug, planDir } = await writeThreeTierFixture(dir);
    const parsed = await parseOrchestration(join(planDir, `${slug}.orchestration.md`));

    expect(parsed.tier).toBe("orchestration");
    expect(parsed.tasks.map((t) => t.taskId)).toEqual(["T1", "T2", "T3", "T4"]);
    // Wave-gate signal: T3 must depend on both wave-1 tasks.
    const t3 = parsed.tasks.find((t) => t.taskId === "T3");
    expect(t3?.dependsOn).toEqual(["T1", "T2"]);
    expect(t3?.wave).toBe(2);
    // qa-tester runs in the final wave on T3.
    const t4 = parsed.tasks.find((t) => t.taskId === "T4");
    expect(t4?.agent).toBe("software-teams-qa-tester");
    expect(t4?.wave).toBe(3);
  });

  test("per-agent slice 'Read first' line is parseable for context-load discipline", async () => {
    const dir = await makeTempDir();
    const { slug, planDir } = await writeThreeTierFixture(dir);

    // Read T1's slice and verify the Read-first line names ONLY the spec
    // section it needs — not the full spec, not the other slices.
    const sliceContent = await Bun.file(join(planDir, `${slug}.T1.md`)).text();
    const readFirstMatch = sliceContent.match(/\*\*Read first:\*\*\s*(.+)/);
    expect(readFirstMatch).not.toBeNull();
    const readFirst = readFirstMatch![1]!.trim();

    // The slice cites a SPEC section, not "everything".
    expect(readFirst).toMatch(/SPEC|ORCHESTRATION/);
    expect(readFirst).not.toMatch(/all task|every slice|full spec/i);
    // It does not name OTHER tasks' slice files (regression: "all task files
    // loaded into one spawn").
    expect(readFirst).not.toContain(`${slug}.T2.md`);
    expect(readFirst).not.toContain(`${slug}.T3.md`);
    expect(readFirst).not.toContain(`${slug}.T4.md`);
  });
});
