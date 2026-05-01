import { describe, test, expect } from "bun:test";
import {
  buildPlanPrompt,
  buildImplementPrompt,
  buildQuickPrompt,
  buildReviewPrompt,
  buildRefinementPrompt,
  buildRulesBlock,
  type PromptContext,
} from "./prompt-builder";

function makeCtx(overrides?: Partial<PromptContext>): PromptContext {
  return {
    cwd: "/tmp/test-project",
    projectType: "typescript",
    techStack: "typescript",
    qualityGates: "default",
    rulesPath: null,
    codebaseIndexPath: null,
    adapter: null,
    ...overrides,
  };
}

describe("prompt-builder regression invariants", () => {
  describe("buildPlanPrompt", () => {
    test("references the planner spec", () => {
      const result = buildPlanPrompt(makeCtx(), "Add a feature");
      expect(result).toContain("software-teams-planner");
      expect(result).toContain("software-teams-planner.md");
    });

    test("includes project context", () => {
      const result = buildPlanPrompt(makeCtx(), "Add a feature");
      expect(result).toContain("## Project Context");
      expect(result).toContain("typescript");
    });

    test("passes the task description through", () => {
      const result = buildPlanPrompt(makeCtx(), "Build a widget");
      expect(result).toContain("Build a widget");
    });
  });

  describe("buildImplementPrompt", () => {
    test("includes rules block", () => {
      const result = buildImplementPrompt(makeCtx(), "plan.md");
      expect(result).toMatch(/rules/i);
      expect(result).toContain("## Rules");
    });

    test("inlines complexity router and orchestration component bodies", () => {
      // Post plugin-tree promotion: prompt-builder no longer asks the spawned
      // agent to Read .md files at runtime. The component bodies are pulled
      // from the TS registry via getComponent() and inlined directly.
      const result = buildImplementPrompt(makeCtx(), "plan.md");
      expect(result).toContain("## Complexity Routing");
      expect(result).toContain("## Agent Teams Orchestration");
    });

    test("includes the plan path", () => {
      const result = buildImplementPrompt(makeCtx(), ".software-teams/plans/test.plan.md");
      expect(result).toContain("test.plan.md");
    });

    test("includes override flag when provided", () => {
      const result = buildImplementPrompt(makeCtx(), "plan.md", "--single");
      expect(result).toContain("--single");
    });
  });

  describe("buildQuickPrompt", () => {
    test("includes rules block", () => {
      const result = buildQuickPrompt(makeCtx(), "Fix the bug");
      expect(result).toMatch(/rules/i);
      expect(result).toContain("## Rules");
    });

    test("includes the task description", () => {
      const result = buildQuickPrompt(makeCtx(), "Fix the bug");
      expect(result).toContain("Fix the bug");
    });
  });

  describe("buildReviewPrompt", () => {
    test("includes rules block", () => {
      const result = buildReviewPrompt(makeCtx(), "42", "PR meta", "diff content");
      expect(result).toMatch(/rules/i);
      expect(result).toContain("## Rules");
    });

    test("includes PR number and diff", () => {
      const result = buildReviewPrompt(makeCtx(), "42", "PR meta", "diff content");
      expect(result).toContain("PR #42");
      expect(result).toContain("diff content");
    });
  });

  describe("buildRefinementPrompt", () => {
    test("references split plan format", () => {
      const result = buildRefinementPrompt(makeCtx(), "change task 2", "prior convo");
      expect(result).toMatch(/split/i);
    });

    test("references task files", () => {
      const result = buildRefinementPrompt(makeCtx(), "change task 2", "prior convo");
      expect(result).toMatch(/\.T\{?n?\}?\.md|task file/i);
    });

    test("includes the planner spec reference", () => {
      const result = buildRefinementPrompt(makeCtx(), "feedback", "history");
      expect(result).toContain("software-teams-planner.md");
    });
  });

  describe("buildRulesBlock", () => {
    test("always includes general rules", () => {
      const result = buildRulesBlock("").join("\n");
      expect(result).toContain("general.md");
    });

    test("includes backend rules for PHP stack", () => {
      const result = buildRulesBlock("php, laravel").join("\n");
      expect(result).toContain("backend.md");
      expect(result).toContain("general.md");
    });

    test("includes frontend rules for React stack", () => {
      const result = buildRulesBlock("react, typescript").join("\n");
      expect(result).toContain("frontend.md");
      expect(result).toContain("general.md");
    });

    test("includes testing rules for test stack", () => {
      const result = buildRulesBlock("vitest, testing").join("\n");
      expect(result).toContain("testing.md");
    });

    test("includes devops rules for CI stack", () => {
      const result = buildRulesBlock("docker, ci").join("\n");
      expect(result).toContain("devops.md");
    });

    test("includes header with instructions", () => {
      const result = buildRulesBlock("typescript").join("\n");
      expect(result).toContain("## Rules");
      expect(result).toMatch(/rules override defaults/i);
    });
  });
});
