import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPlanFiles, formatPlanFilesSection } from "../plan-files-comment";
import { findActiveOrchestration } from "../orchestration";

let tempDir: string;

function makeProject(): string {
  tempDir = mkdtempSync(join(tmpdir(), "st-plan-files-"));
  mkdirSync(join(tempDir, ".software-teams", "plans"), { recursive: true });
  return tempDir;
}

function writePlan(
  cwd: string,
  opts: {
    slug?: string;
    issue?: number;
    repo?: string;
    spec?: string;
    orchestration?: string;
    slices?: Array<{ name: string; agent: string; body: string }>;
  },
) {
  const slug = opts.slug ?? "01-feat";
  const plansDir = join(cwd, ".software-teams", "plans");
  if (opts.spec !== undefined) {
    writeFileSync(join(plansDir, `${slug}.spec.md`), opts.spec);
  }
  const sliceNames = (opts.slices ?? []).map((s) => s.name);
  const orchFm = [
    "---",
    `available_agents: ["software-teams-frontend", "software-teams-backend"]`,
    `primary_agent: software-teams-frontend`,
    "task_files:",
    ...sliceNames.map((n) => `  - ${n}`),
    ...(opts.issue !== undefined ? [`issue: ${opts.issue}`] : []),
    ...(opts.repo !== undefined ? [`repo: ${opts.repo}`] : []),
    "---",
    "",
    opts.orchestration ?? "## Tasks\n\n| ID | Task | Agent | Priority | Requires |\n",
  ].join("\n");
  writeFileSync(join(plansDir, `${slug}.orchestration.md`), orchFm);

  for (const s of opts.slices ?? []) {
    writeFileSync(
      join(plansDir, s.name),
      `---\nagent: ${s.agent}\ntier: per-agent\nspec_link: ${slug}.spec.md\norchestration_link: ${slug}.orchestration.md\n---\n\n${s.body}`,
    );
  }
  return slug;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("readPlanFiles", () => {
  test("reads spec, orchestration, and every slice in order", async () => {
    const cwd = makeProject();
    writePlan(cwd, {
      issue: 42,
      spec: "# Spec body\n\nrequirements here",
      orchestration: "## Tasks\n\nrows here",
      slices: [
        { name: "01-feat.T1.md", agent: "software-teams-frontend", body: "frontend slice content" },
        { name: "01-feat.T2.md", agent: "software-teams-backend", body: "backend slice content" },
      ],
    });
    const orch = await findActiveOrchestration(cwd, 42);
    expect(orch).not.toBeNull();
    const entries = readPlanFiles(cwd, orch!);
    expect(entries).toHaveLength(4);
    expect(entries[0].label).toBe("SPEC");
    expect(entries[0].content).toContain("requirements here");
    expect(entries[1].label).toBe("ORCHESTRATION");
    expect(entries[1].content).toContain("rows here");
    expect(entries[2].label).toMatch(/^TASK T1 \(.*Frontend Agent.*\)$/);
    expect(entries[2].content).toContain("frontend slice content");
    expect(entries[3].label).toMatch(/^TASK T2 \(.*Backend Agent.*\)$/);
    expect(entries[3].content).toContain("backend slice content");
  });

  test("flags missing files as missing rather than throwing", async () => {
    const cwd = makeProject();
    writePlan(cwd, {
      issue: 7,
      spec: "spec content",
      slices: [{ name: "01-feat.T1.md", agent: "software-teams-frontend", body: "ok" }],
    });
    const orch = await findActiveOrchestration(cwd, 7);
    expect(orch).not.toBeNull();
    // Mutate the orch to reference a non-existent path.
    const mutated = { ...orch!, specPath: "ghost/path/that-does-not-exist.spec.md" };
    const entries = readPlanFiles(cwd, mutated);
    const spec = entries.find((e) => e.label === "SPEC");
    expect(spec?.missing).toBe(true);
  });
});

describe("formatPlanFilesSection", () => {
  test("wraps every readable entry in a collapsible <details> block", async () => {
    const cwd = makeProject();
    writePlan(cwd, {
      issue: 11,
      spec: "## Spec\n\nDo the thing.",
      orchestration: "## Tasks manifest",
      slices: [{ name: "01-feat.T1.md", agent: "software-teams-frontend", body: "build UI" }],
    });
    const orch = await findActiveOrchestration(cwd, 11);
    const section = formatPlanFilesSection(readPlanFiles(cwd, orch!));

    expect(section).toContain("### 📂 Plan files");
    expect(section).toContain("<details>");
    expect(section).toContain("<summary><strong>SPEC</strong>");
    expect(section).toContain("<summary><strong>ORCHESTRATION</strong>");
    expect(section).toContain("Frontend Agent");
    expect(section).toContain("Do the thing.");
    expect(section).toContain("Tasks manifest");
    expect(section).toContain("build UI");
    // Three readable files → three close tags.
    expect((section.match(/<\/details>/g) ?? []).length).toBe(3);
  });

  test("returns empty string when every entry is missing", () => {
    const section = formatPlanFilesSection([
      { label: "SPEC", path: "missing.spec.md", content: "", missing: true },
    ]);
    expect(section).toBe("");
  });

  test("truncates oversized files on a line boundary and notes dropped-line count", () => {
    // Build a synthetic huge slice — ~30k chars, well over the
    // per-file 8k target.
    const hugeLine = "x".repeat(80);
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) lines.push(`${i}: ${hugeLine}`);
    const huge = lines.join("\n");

    const section = formatPlanFilesSection([
      { label: "TASK T1 (The Frontend Agent)", path: "p/t1.md", content: huge },
    ]);

    expect(section).toContain("truncated");
    expect(section).toMatch(/\d+ more lines/);
    // We never produce a section longer than the soft cap (50k) + a
    // little scaffolding slack.
    expect(section.length).toBeLessThan(55_000);
  });

  test("HTML-escapes labels and paths so weird filenames cannot break out of <summary>", () => {
    const section = formatPlanFilesSection([
      { label: "SPEC", path: 'tricky<script>"&path.md', content: "body" },
    ]);
    expect(section).toContain("tricky&lt;script&gt;&quot;&amp;path.md");
    expect(section).not.toContain('"&path.md'); // raw form should be gone
  });

  test("does NOT embed the runner-emitted bullet paths the agent used to write", () => {
    // Regression guard: the section should let the file content speak
    // for itself — no "- SPEC: `<path>`" bullets that duplicated the
    // collapsible summary.
    const section = formatPlanFilesSection([
      { label: "SPEC", path: ".software-teams/plans/x.spec.md", content: "body" },
    ]);
    expect(section).not.toMatch(/^- SPEC: `/m);
  });
});
