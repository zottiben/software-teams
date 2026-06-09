import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import yaml from "yaml";

/**
 * workflow-yaml.test.ts — tests for GitHub Actions workflow YAML structure.
 *
 * Verifies both .github/workflows/software-teams.yml and action/workflow-template.yml
 * contain the expected issue-label trigger and job configuration.
 */

describe("workflow YAML structure", () => {
  describe(".github/workflows/software-teams.yml", () => {
    let parsed: any;

    test("workflow file parses as valid YAML", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed).toBeDefined();
    });

    test("on.issues.types includes both 'opened' and 'labeled'", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.on.issues.types).toEqual(expect.arrayContaining(["opened", "labeled"]));
    });

    test("on.issues.types equals exactly ['opened', 'labeled', 'closed']", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.on.issues.types).toEqual(["opened", "labeled", "closed"]);
    });

    test("software-teams-issue-label job exists", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.jobs["software-teams-issue-label"]).toBeDefined();
    });

    test("software-teams-issue-label if condition includes github.event_name == 'issues'", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/github\.event_name\s*==\s*['"]issues['"]/);
    });

    test("software-teams-issue-label if condition does NOT branch on 'opened' (double-fire regression: issue 6201)", async () => {
      // Pre-0.5.41 the filter accepted BOTH:
      //   (action == 'opened' && contains(labels, 'software-teams'))
      //   || (action == 'labeled' && label.name == 'software-teams')
      //
      // GitHub fires both events when an issue is opened with a label
      // attached, so the workflow ran TWICE in the same second. The fix
      // is to listen only on `labeled` — GitHub emits a labeled event
      // for every label present at creation as well as labels added
      // later, so one branch covers both cases without duplication.
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if as string;
      // Must NOT branch on `opened` — that re-introduces the double-fire.
      expect(ifCondition).not.toMatch(/action\s*==\s*['"]opened['"]/);
      // Must still listen on `labeled` so the trigger keeps working.
      expect(ifCondition).toMatch(/action\s*==\s*['"]labeled['"]/);
    });

    test("software-teams-issue-label if condition includes 'labeled' trigger", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/labeled/);
    });

    test("software-teams-issue-label if condition includes 'software-teams' label check", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/software-teams/);
    });

    test("Run Software Teams step passes --event-type issue_labeled", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const runStep = parsed.jobs["software-teams-issue-label"].steps.find((s: any) => s.name === "Run Software Teams");
      expect(runStep).toBeDefined();
      expect(runStep.run).toMatch(/--event-type\s+issue_labeled/);
    });

    test("Run Software Teams step does NOT pass --pr-number", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const runStep = parsed.jobs["software-teams-issue-label"].steps.find((s: any) => s.name === "Run Software Teams");
      expect(runStep).toBeDefined();
      expect(runStep.run).not.toMatch(/--pr-number/);
    });

    test("existing software-teams comment job if condition still references issue_comment", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const commentJob = parsed.jobs["software-teams"];
      expect(commentJob.if).toMatch(/issue_comment/);
    });

    test("existing software-teams comment job if condition still references pull_request_review_comment", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const commentJob = parsed.jobs["software-teams"];
      expect(commentJob.if).toMatch(/pull_request_review_comment/);
    });

    test("existing software-teams comment job if condition still references pull_request_review", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const commentJob = parsed.jobs["software-teams"];
      expect(commentJob.if).toMatch(/pull_request_review/);
    });

    test("all setup-bun steps pin bun-version 1.3.7", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const allSteps: any[] = [];
      for (const job of Object.values(parsed.jobs)) {
        if ((job as any).steps) {
          allSteps.push(...(job as any).steps);
        }
      }
      const bunSteps = allSteps.filter((s) => s.uses && s.uses.includes("setup-bun"));
      expect(bunSteps.length).toBeGreaterThan(0);
      for (const step of bunSteps) {
        expect(step.with["bun-version"]).toBe("1.3.7");
      }
    });

    test("software-teams-issue-close job exists and gates on closed + label", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const job = parsed.jobs["software-teams-issue-close"];
      expect(job).toBeDefined();
      expect(job.if).toMatch(/github\.event_name.*issues/);
      expect(job.if).toMatch(/action == 'closed'/);
      expect(job.if).toMatch(/contains\(github\.event\.issue\.labels.*software-teams/);
    });
  });

  describe("action/workflow-template.yml", () => {
    let parsed: any;

    test("workflow file parses as valid YAML", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed).toBeDefined();
    });

    test("on.issues.types equals exactly ['opened', 'labeled', 'closed']", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.on.issues.types).toEqual(["opened", "labeled", "closed"]);
    });

    test("software-teams-issue-label job exists", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.jobs["software-teams-issue-label"]).toBeDefined();
    });

    test("software-teams-issue-label if condition structure matches canonical (labeled-only, no opened branch)", async () => {
      // Post-0.5.41: the template fires ONLY on `labeled` events (not
      // `opened`). See the double-fire regression note on the local
      // workflow test of the same shape.
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if as string;
      expect(ifCondition).toMatch(/github\.event_name.*issues/);
      expect(ifCondition).toMatch(/labeled/);
      expect(ifCondition).not.toMatch(/action\s*==\s*['"]opened['"]/);
    });

    test("all setup-bun steps pin bun-version 1.3.7", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      const allSteps: any[] = [];
      for (const job of Object.values(parsed.jobs)) {
        if ((job as any).steps) {
          allSteps.push(...(job as any).steps);
        }
      }
      const bunSteps = allSteps.filter((s) => s.uses && s.uses.includes("setup-bun"));
      expect(bunSteps.length).toBeGreaterThan(0);
      for (const step of bunSteps) {
        expect(step.with["bun-version"]).toBe("1.3.7");
      }
    });

    test("software-teams-issue-close job exists and gates on closed + label", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      const job = parsed.jobs["software-teams-issue-close"];
      expect(job).toBeDefined();
      expect(job.if).toMatch(/github\.event_name.*issues/);
      expect(job.if).toMatch(/action == 'closed'/);
      expect(job.if).toMatch(/contains\(github\.event\.issue\.labels.*software-teams/);
    });
  });

  describe("cross-file equivalence (ignoring header comments)", () => {
    test("both workflow files are byte-identical except for header comments", async () => {
      const canonicalContent = await Bun.file(resolve(import.meta.dir, "../../../../../../.github/workflows/software-teams.yml")).text();
      const templateContent = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();

      // Strip leading # comments and blank lines from both
      const stripComments = (content: string) => {
        return content
          .split("\n")
          .filter((line) => !line.startsWith("#") && line.trim().length > 0)
          .join("\n");
      };

      const canonicalStripped = stripComments(canonicalContent);
      const templateStripped = stripComments(templateContent);

      expect(canonicalStripped).toBe(templateStripped);
    });
  });

  describe("cache step uses actions/cache/restore@v4 (regression guard for v0.5.24)", () => {
    // v0.5.23 used `actions/cache@v4` for restore. That action's outputs
    // DON'T include `cache-matched-key` (only the `actions/cache/restore`
    // sub-action exposes it). Result: bootstrap always saw an empty
    // matched-key → always cleared plans → implement runs found nothing.
    // This guard locks in the restore-action choice + ensures every save
    // step uses the run_id-suffixed key so we never recreate the stale
    // "no-run_id-primary-key" cache entries that caused the original
    // poisoning.
    for (const file of [
      "../../../../../../.github/workflows/software-teams.yml",
      "../../../../action/workflow-template.yml",
    ]) {
      test(`${file.split("/").pop()} restores via actions/cache/restore (the sub-action) not the bare composite`, async () => {
        // The KEY invariant is "use the sub-action that exposes
        // cache-matched-key, NOT the bare composite that auto-saves
        // on post-step". The major version is incidental — accept
        // any vN so we can bump majors (e.g. for Node 24 runtime)
        // without rewriting this guard.
        const content = await Bun.file(resolve(import.meta.dir, file)).text();
        expect(content).toMatch(/uses:\s*actions\/cache\/restore@v\d+/);
        // Bare actions/cache@vN (the composite that auto-saves on
        // post-step) must NOT be used — that's what auto-created the
        // no-run_id stale entries that poisoned restores.
        expect(content).not.toMatch(/uses:\s*actions\/cache@v\d+\b/);
      });

      test(`${file.split("/").pop()} passes cache-matched-key to bootstrap (not the broken cache-hit alone)`, async () => {
        const content = await Bun.file(resolve(import.meta.dir, file)).text();
        expect(content).toMatch(/bootstrap --matched-key "\$\{\{ steps\.cache\.outputs\.cache-matched-key \}\}"/);
      });

      test(`${file.split("/").pop()} save keys all include \${{ github.run_id }} (no no-run_id primary saves)`, async () => {
        const content = await Bun.file(resolve(import.meta.dir, file)).text();
        // Match any actions/cache/save@vN — version-agnostic split.
        const saveBlocks = content.split(/uses:\s*actions\/cache\/save@v\d+/).slice(1);
        expect(saveBlocks.length).toBeGreaterThan(0);
        for (const block of saveBlocks) {
          // The `key:` line in each save step must include run_id (or sha
          // for promote-rules) — never bare branch/scope alone.
          const keyMatch = block.match(/\n\s+key:\s*([^\n]+)/);
          expect(keyMatch?.[1]).toMatch(/\$\{\{ github\.run_id \}\}|\$\{\{ github\.sha \}\}/);
        }
      });

      test(`${file.split("/").pop()} every job that RESTORES cache also SAVES (no orphan restores)`, async () => {
        // Regression guard for the issue #54 "no plan found" bug. The
        // `software-teams-issue-label` job restored cache but had no save
        // step — every plan run for a labeled issue silently dropped its
        // plan files into a workspace that the next run could never see.
        // Lock in the invariant: every job with a `Restore Software Teams
        // state` step must also have a matching `cache/save` step.
        // Version-agnostic on the major so we can bump action versions
        // (e.g. v4 → v5 for Node 24) without rewriting the guard.
        const content = await Bun.file(resolve(import.meta.dir, file)).text();
        const restoreCount = (content.match(/uses:\s*actions\/cache\/restore@v\d+/g) ?? []).length;
        const saveCount = (content.match(/uses:\s*actions\/cache\/save@v\d+/g) ?? []).length;
        expect(saveCount).toBeGreaterThanOrEqual(restoreCount);
      });

      test(`${file.split("/").pop()} software-teams-issue-label job has its Save step (issue #54 regression guard)`, async () => {
        const content = await Bun.file(resolve(import.meta.dir, file)).text();
        // Slice out the label-triggered job's body (from its name to the
        // next top-level job declaration) and assert it contains a save.
        const labelJobMatch = content.match(
          /software-teams-issue-label:[\s\S]*?(?=\n  [a-z-]+:\n    if:|\n  [a-z-]+:\n    runs-on:|\Z)/,
        );
        expect(labelJobMatch).not.toBeNull();
        const labelJobBody = labelJobMatch![0];
        expect(labelJobBody).toMatch(/uses:\s*actions\/cache\/save@v\d+/);
        expect(labelJobBody).toMatch(/key: software-teams-state-v2-\$\{\{ github\.repository \}\}-main-\$\{\{ github\.run_id \}\}/);
      });
    }
  });
});
