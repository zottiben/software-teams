import { describe, test, expect } from "bun:test";
import {
  buildPlanPrompt,
  buildImplementPrompt,
  buildQuickPrompt,
  buildReviewPrompt,
  buildRefinementPrompt,
  buildLearningsBlock,
  type PromptContext,
} from "./prompt-builder";

function makeCtx(overrides?: Partial<PromptContext>): PromptContext {
  return {
    cwd: "/tmp/test-project",
    projectType: "typescript",
    techStack: "typescript",
    qualityGates: "default",
    learningsPath: null,
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
    test("includes learnings block", () => {
      const result = buildImplementPrompt(makeCtx(), "plan.md");
      expect(result).toMatch(/learnings/i);
      expect(result).toContain("## Learnings");
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
    test("includes learnings block", () => {
      const result = buildQuickPrompt(makeCtx(), "Fix the bug");
      expect(result).toMatch(/learnings/i);
      expect(result).toContain("## Learnings");
    });

    test("includes the task description", () => {
      const result = buildQuickPrompt(makeCtx(), "Fix the bug");
      expect(result).toContain("Fix the bug");
    });
  });

  describe("buildReviewPrompt", () => {
    test("includes learnings block", () => {
      const result = buildReviewPrompt(makeCtx(), "42", "PR meta", "diff content");
      expect(result).toMatch(/learnings/i);
      expect(result).toContain("## Learnings");
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

  describe("buildLearningsBlock", () => {
    test("always includes general learnings", () => {
      const result = buildLearningsBlock("").join("\n");
      expect(result).toContain("general.md");
    });

    test("includes backend learnings for PHP stack", () => {
      const result = buildLearningsBlock("php, laravel").join("\n");
      expect(result).toContain("backend.md");
      expect(result).toContain("general.md");
    });

    test("includes frontend learnings for React stack", () => {
      const result = buildLearningsBlock("react, typescript").join("\n");
      expect(result).toContain("frontend.md");
      expect(result).toContain("general.md");
    });

    test("includes testing learnings for test stack", () => {
      const result = buildLearningsBlock("vitest, testing").join("\n");
      expect(result).toContain("testing.md");
    });

    test("includes devops learnings for CI stack", () => {
      const result = buildLearningsBlock("docker, ci").join("\n");
      expect(result).toContain("devops.md");
    });

    test("includes header with instructions", () => {
      const result = buildLearningsBlock("typescript").join("\n");
      expect(result).toContain("## Learnings");
      expect(result).toMatch(/learnings override defaults/i);
    });
  });
});
