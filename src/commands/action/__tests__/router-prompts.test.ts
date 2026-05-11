import { describe, test, expect } from "bun:test";
import {
  buildRouterPrompt,
  pickSubagent,
  type ActionContext,
  type ActionFlow,
} from "../router-prompts";

function makeCtx(overrides: Partial<ActionContext> & { flow: ActionFlow }): ActionContext {
  return {
    userRequest: "default request",
    repo: "zottiben/test-project-one",
    issueNumber: 42,
    conversationHistory: "",
    projectLines: ["## Project Context", "- Type: react-typescript"],
    workspaceLines: ["## Workspace", "- Working directory: /tmp/work"],
    rulesBlock: ["## Rules", "- Default rule"],
    ...overrides,
  };
}

describe("pickSubagent", () => {
  test("plan flows route to software-teams-planner", () => {
    expect(pickSubagent({ kind: "plan" }).type).toBe("software-teams-planner");
    expect(pickSubagent({ kind: "plan", isRefinement: true }).type).toBe("software-teams-planner");
    expect(pickSubagent({ kind: "plan", isApproval: true }).type).toBe("software-teams-planner");
  });

  test("implement + quick route to software-teams-programmer", () => {
    expect(pickSubagent({ kind: "implement" }).type).toBe("software-teams-programmer");
    expect(pickSubagent({ kind: "quick" }).type).toBe("software-teams-programmer");
  });

  test("review routes to software-teams-quality (confirmed by user)", () => {
    expect(pickSubagent({ kind: "review" }).type).toBe("software-teams-quality");
  });

  test("feedback + post-impl-iteration route to software-teams-pr-feedback", () => {
    expect(pickSubagent({ kind: "feedback" }).type).toBe("software-teams-pr-feedback");
    expect(pickSubagent({ kind: "post-impl-iteration" }).type).toBe("software-teams-pr-feedback");
  });

  test("plan flow description disambiguates initial vs refinement vs approval", () => {
    expect(pickSubagent({ kind: "plan" }).description).toMatch(/create/i);
    expect(pickSubagent({ kind: "plan", isRefinement: true }).description).toMatch(/refine/i);
    expect(pickSubagent({ kind: "plan", isApproval: true }).description).toMatch(/finalise|approved/i);
  });
});

describe("buildRouterPrompt — shape invariants (every flow)", () => {
  const allFlows: ActionFlow[] = [
    { kind: "plan" },
    { kind: "plan", isRefinement: true },
    { kind: "plan", isApproval: true },
    { kind: "implement" },
    { kind: "quick" },
    { kind: "review" },
    { kind: "feedback" },
    { kind: "post-impl-iteration" },
  ];

  for (const flow of allFlows) {
    const tag = `${flow.kind}${"isRefinement" in flow && flow.isRefinement ? " (refinement)" : ""}${"isApproval" in flow && flow.isApproval ? " (approval)" : ""}`;

    test(`[${tag}] instructs exactly one Task call with the matched subagent_type`, () => {
      const ctx = makeCtx({ flow });
      const expectedType = pickSubagent(flow).type;
      const prompt = buildRouterPrompt(ctx);
      expect(prompt).toContain(`subagent_type: "${expectedType}"`);
      // No legacy "self-play" wording sneaking back in.
      expect(prompt).not.toMatch(/You are software-teams-planner/);
      expect(prompt).not.toMatch(/You are software-teams-programmer/);
    });

    test(`[${tag}] does NOT inline an agent spec body`, () => {
      const ctx = makeCtx({ flow });
      const prompt = buildRouterPrompt(ctx);
      // The legacy markers from injected specs.
      expect(prompt).not.toContain("## Agent Spec — software-teams-planner");
      expect(prompt).not.toContain("## Agent Spec — software-teams-programmer");
      expect(prompt).not.toContain("## Agent Base Protocol");
      expect(prompt).not.toContain("## Agent Teams Orchestration");
      expect(prompt).not.toContain("## Complexity Routing");
    });

    test(`[${tag}] echoes the user request inside the subagent brief`, () => {
      const ctx = makeCtx({ flow, userRequest: "Render the Nav component on every route" });
      const prompt = buildRouterPrompt(ctx);
      expect(prompt).toContain("Render the Nav component on every route");
      expect(prompt).toMatch(/<user-request>[\s\S]*Render the Nav component[\s\S]*<\/user-request>/);
    });

    test(`[${tag}] echoes conversation history when present, marks "(none)" when absent`, () => {
      const withHistory = buildRouterPrompt(makeCtx({ flow, conversationHistory: "**@alice**: looks good" }));
      expect(withHistory).toContain("looks good");

      const withoutHistory = buildRouterPrompt(makeCtx({ flow, conversationHistory: "" }));
      expect(withoutHistory).toContain("<conversation-history>\n(none)\n</conversation-history>");
    });

    test(`[${tag}] tells the parent to echo Task result verbatim, no extra commentary`, () => {
      const prompt = buildRouterPrompt(makeCtx({ flow }));
      expect(prompt).toMatch(/output its final text VERBATIM/i);
      expect(prompt).toMatch(/do not.*commentary/i);
    });
  }
});

describe("buildRouterPrompt — plan-specific brief", () => {
  test("initial plan brief requires SPLIT format + provenance frontmatter", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" }, issueNumber: 99, repo: "z/p" }));
    expect(prompt).toMatch(/SPLIT format/i);
    expect(prompt).toContain(".plan.md");
    expect(prompt).toContain(".T{n}.md");
    expect(prompt).toContain("issue: 99");
    expect(prompt).toContain("repo: z/p");
  });

  test("refinement brief forbids source-code edits + git writes", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isRefinement: true } }));
    expect(prompt).toMatch(/do not write source code/i);
    expect(prompt).toMatch(/do not run git commit/i);
  });

  test("approval brief defers implementation to a later run", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isApproval: true } }));
    expect(prompt).toMatch(/do not begin implementation/i);
  });
});

describe("buildRouterPrompt — feature-branch context (issue-context impl / quick)", () => {
  test("implement on issue-context: includes branch block + PR proposal scaffold", () => {
    const prompt = buildRouterPrompt(
      makeCtx({
        flow: { kind: "implement" },
        issueNumber: 36,
        repo: "zottiben/test-project-one",
        featureBranch: {
          branchName: "software-teams/issue-36-implement-render-nav",
          defaultBranch: "main",
        },
      }),
    );
    expect(prompt).toContain("software-teams/issue-36-implement-render-nav");
    expect(prompt).toContain("default: `main`");
    expect(prompt).toContain("Closes #36");
    expect(prompt).toContain("git push -u origin software-teams/issue-36-implement-render-nav");
    expect(prompt).toMatch(/Do NOT run `gh pr create`/);
    expect(prompt).toContain("## PR proposal");
    expect(prompt).toContain("pull/new/software-teams/issue-36-implement-render-nav");
  });

  test("review / feedback / plan flows never get a feature-branch block", () => {
    const ctxBase = {
      featureBranch: { branchName: "should-not-appear", defaultBranch: "main" },
      issueNumber: 1,
    };
    for (const flow of [{ kind: "review" } as const, { kind: "feedback" } as const, { kind: "plan" } as const]) {
      const prompt = buildRouterPrompt(makeCtx({ flow, ...ctxBase }));
      expect(prompt).not.toContain("should-not-appear");
      expect(prompt).not.toContain("## Feature Branch");
    }
  });
});

describe("buildRouterPrompt — dry-run", () => {
  test("dry-run flag injects an explicit no-mutation directive", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "implement" }, isDryRun: true }));
    expect(prompt).toMatch(/DRY-RUN MODE/);
    expect(prompt).toMatch(/do not modify files/i);
  });

  test("non-dry-run does NOT mention DRY-RUN MODE", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "implement" } }));
    expect(prompt).not.toMatch(/DRY-RUN MODE/);
  });
});

describe("buildRouterPrompt — content surfaces", () => {
  test("project + workspace + rules blocks are all forwarded to the subagent brief", () => {
    const prompt = buildRouterPrompt(
      makeCtx({
        flow: { kind: "plan" },
        projectLines: ["## Project Context", "- Type: react-typescript", "- Tech: bun + vite"],
        workspaceLines: ["## Workspace", "- Working directory: /var/work/repo"],
        rulesBlock: ["## Rules", "- Always use TypeScript", "- Prefer Bun over Node"],
      }),
    );
    expect(prompt).toContain("Type: react-typescript");
    expect(prompt).toContain("/var/work/repo");
    expect(prompt).toContain("Always use TypeScript");
  });

  test("empty rulesBlock does not produce a stray blank `## Rules` header", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" }, rulesBlock: [] }));
    expect(prompt).not.toMatch(/^## Rules\s*$/m);
  });
});
