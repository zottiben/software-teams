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
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed).toBeDefined();
    });

    test("on.issues.types includes both 'opened' and 'labeled'", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.on.issues.types).toEqual(expect.arrayContaining(["opened", "labeled"]));
    });

    test("on.issues.types equals exactly ['opened', 'labeled']", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.on.issues.types).toEqual(["opened", "labeled"]);
    });

    test("software-teams-issue-label job exists", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.jobs["software-teams-issue-label"]).toBeDefined();
    });

    test("software-teams-issue-label if condition includes github.event_name == 'issues'", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/github\.event_name\s*==\s*['"]issues['"]/);
    });

    test("software-teams-issue-label if condition includes 'opened' trigger", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/opened/);
    });

    test("software-teams-issue-label if condition includes 'labeled' trigger", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/labeled/);
    });

    test("software-teams-issue-label if condition includes 'software-teams' label check", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/software-teams/);
    });

    test("Run Software Teams step passes --event-type issue_labeled", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const runStep = parsed.jobs["software-teams-issue-label"].steps.find((s: any) => s.name === "Run Software Teams");
      expect(runStep).toBeDefined();
      expect(runStep.run).toMatch(/--event-type\s+issue_labeled/);
    });

    test("Run Software Teams step does NOT pass --pr-number", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const runStep = parsed.jobs["software-teams-issue-label"].steps.find((s: any) => s.name === "Run Software Teams");
      expect(runStep).toBeDefined();
      expect(runStep.run).not.toMatch(/--pr-number/);
    });

    test("existing software-teams comment job if condition still references issue_comment", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const commentJob = parsed.jobs["software-teams"];
      expect(commentJob.if).toMatch(/issue_comment/);
    });

    test("existing software-teams comment job if condition still references pull_request_review_comment", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const commentJob = parsed.jobs["software-teams"];
      expect(commentJob.if).toMatch(/pull_request_review_comment/);
    });

    test("existing software-teams comment job if condition still references pull_request_review", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
      parsed = yaml.parse(content);
      const commentJob = parsed.jobs["software-teams"];
      expect(commentJob.if).toMatch(/pull_request_review/);
    });

    test("all setup-bun steps pin bun-version 1.3.7", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
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
  });

  describe("action/workflow-template.yml", () => {
    let parsed: any;

    test("workflow file parses as valid YAML", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed).toBeDefined();
    });

    test("on.issues.types equals exactly ['opened', 'labeled']", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.on.issues.types).toEqual(["opened", "labeled"]);
    });

    test("software-teams-issue-label job exists", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      expect(parsed.jobs["software-teams-issue-label"]).toBeDefined();
    });

    test("software-teams-issue-label if condition structure matches canonical", async () => {
      const content = await Bun.file(resolve(import.meta.dir, "../../../../action/workflow-template.yml")).text();
      parsed = yaml.parse(content);
      const ifCondition = parsed.jobs["software-teams-issue-label"].if;
      expect(ifCondition).toMatch(/github\.event_name.*issues/);
      expect(ifCondition).toMatch(/opened/);
      expect(ifCondition).toMatch(/labeled/);
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
  });

  describe("cross-file equivalence (ignoring header comments)", () => {
    test("both workflow files are byte-identical except for header comments", async () => {
      const canonicalContent = await Bun.file(resolve(import.meta.dir, "../../../../.github/workflows/software-teams.yml")).text();
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
});
