import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOrchestration } from "../parse-orchestration";
import { detectPlanTier } from "../prompt-builder";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "st-parse-orch-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const VALID_ORCHESTRATION = `---
plan_id: 1-99
slug: 1-99-fixture
tier: orchestration
spec_link: 1-99-fixture.spec.md
available_agents: [software-teams-backend, software-teams-qa-tester]
primary_agent: software-teams-backend
---

# Fixture Plan — Orchestration

## Tasks

| ID | Name | Agent | Wave | Depends On | Slice |
|----|------|-------|------|------------|-------|
| T1 | Build core | software-teams-backend | 1 | — | \`1-99-fixture.T1.md\` |
| T2 | Build api  | software-teams-backend | 1 | — | \`1-99-fixture.T2.md\` |
| T3 | Wire it    | software-teams-backend | 2 | T1, T2 | \`1-99-fixture.T3.md\` |
| T4 | Test it    | software-teams-qa-tester | 3 | T3 | \`1-99-fixture.T4.md\` |

## Sequencing Rules

- Wave gates honoured.
`;

describe("parseOrchestration", () => {
  test("parses a valid orchestration file with full task graph", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "1-99-fixture.orchestration.md");
    await writeFile(file, VALID_ORCHESTRATION);

    const result = await parseOrchestration(file);

    expect(result.planId).toBe("1-99");
    expect(result.slug).toBe("1-99-fixture");
    expect(result.tier).toBe("orchestration");
    expect(result.specLink).toBe("1-99-fixture.spec.md");
    expect(result.tasks).toHaveLength(4);

    expect(result.tasks[0]).toEqual({
      taskId: "T1",
      name: "Build core",
      agent: "software-teams-backend",
      wave: 1,
      dependsOn: [],
      slice: "1-99-fixture.T1.md",
    });
    expect(result.tasks[2]?.dependsOn).toEqual(["T1", "T2"]);
    expect(result.tasks[3]?.agent).toBe("software-teams-qa-tester");
    expect(result.tasks[3]?.wave).toBe(3);
  });

  test("returns empty task list when the Tasks section has no table", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "empty.orchestration.md");
    await writeFile(
      file,
      `---
plan_id: 2-01
slug: 2-01-empty
tier: orchestration
---

# Empty — Orchestration

## Tasks

(no tasks defined yet)

## Sequencing Rules

- TBD
`,
    );
    const result = await parseOrchestration(file);
    expect(result.tasks).toEqual([]);
  });

  test("throws when frontmatter is missing required fields", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "bad.orchestration.md");
    await writeFile(
      file,
      `---
slug: 1-01-bad
tier: orchestration
---

## Tasks
`,
    );
    expect(parseOrchestration(file)).rejects.toThrow(/plan_id/);
  });

  test("throws when no frontmatter is present at all", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "no-fm.orchestration.md");
    await writeFile(file, `# No frontmatter\n\n## Tasks\n`);
    expect(parseOrchestration(file)).rejects.toThrow(/frontmatter/i);
  });

  test("throws when the Tasks table is malformed (missing required column)", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "malformed.orchestration.md");
    await writeFile(
      file,
      `---
plan_id: 1-02
slug: 1-02-malformed
tier: orchestration
---

## Tasks

| ID | Name | Wave |
|----|------|------|
| T1 | Foo  | 1    |
`,
    );
    expect(parseOrchestration(file)).rejects.toThrow(/agent|column/);
  });
});

describe("detectPlanTier", () => {
  test("returns tier=three-tier when both .orchestration.md and .plan.md exist", async () => {
    const dir = await makeTempDir();
    const slug = "1-50-three-tier";
    await writeFile(join(dir, `${slug}.orchestration.md`), VALID_ORCHESTRATION);
    await writeFile(join(dir, `${slug}.plan.md`), `---\nplan_id: 1-50\n---\n# legacy\n`);
    const result = detectPlanTier(dir, `${slug}.orchestration.md`);
    expect(result.tier).toBe("three-tier");
    expect(result.orchestrationPath).toBe(join(dir, `${slug}.orchestration.md`));
    expect(result.planPath).toBe(join(dir, `${slug}.plan.md`));
  });

  test("returns tier=three-tier with orchestration as plan path when .plan.md is absent", async () => {
    const dir = await makeTempDir();
    const slug = "1-51-orchestration-only";
    await writeFile(join(dir, `${slug}.orchestration.md`), VALID_ORCHESTRATION);
    const result = detectPlanTier(dir, `${slug}.orchestration.md`);
    expect(result.tier).toBe("three-tier");
    expect(result.planPath).toBe(join(dir, `${slug}.orchestration.md`));
    expect(result.orchestrationPath).toBe(join(dir, `${slug}.orchestration.md`));
  });

  test("returns tier=single-tier when only the legacy .plan.md exists", async () => {
    const dir = await makeTempDir();
    const slug = "1-52-single-tier";
    const planFile = join(dir, `${slug}.plan.md`);
    await writeFile(planFile, `---\nplan_id: 1-52\ntask_files:\n  - ${slug}.T1.md\n---\n# legacy\n`);
    const result = detectPlanTier(dir, `${slug}.plan.md`);
    expect(result.tier).toBe("single-tier");
    expect(result.planPath).toBe(planFile);
    expect(result.orchestrationPath).toBeNull();
  });

  test("works when given a slug-only path (no suffix) — derives sibling files", async () => {
    const dir = await makeTempDir();
    const slug = "1-53-bare";
    await writeFile(join(dir, `${slug}.orchestration.md`), VALID_ORCHESTRATION);
    const result = detectPlanTier(dir, `${slug}.md`);
    expect(result.tier).toBe("three-tier");
    expect(result.orchestrationPath).toBe(join(dir, `${slug}.orchestration.md`));
  });
});
