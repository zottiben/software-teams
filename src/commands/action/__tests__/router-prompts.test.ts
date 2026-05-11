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
  test("initial plan brief REQUIRES three-tier output (no downgrade allowed)", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" }, issueNumber: 99, repo: "z/p" }));
    expect(prompt).toMatch(/three-tier.*REQUIRED/i);
    expect(prompt).toMatch(/do NOT apply the Tier Decision Rule's single-tier downgrade/);
    expect(prompt).toContain("{slug}.spec.md");
    expect(prompt).toContain("{slug}.orchestration.md");
    expect(prompt).toContain("{slug}.T{n}.md");
  });

  test("initial plan brief explicitly forbids the legacy single-tier `.plan.md` index", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" } }));
    expect(prompt).toMatch(/Do NOT write `\{slug\}\.plan\.md`/);
    expect(prompt).not.toMatch(/single-tier.*downgrade option/);
  });

  test("initial plan brief carries `issue:` + `repo:` provenance into both tier specs", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" }, issueNumber: 99, repo: "z/p" }));
    expect(prompt).toContain("issue: 99");
    expect(prompt).toContain("repo: z/p");
  });

  test("initial plan brief mandates exact opening line naming the agent + three-tier", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" }, issueNumber: 41 }));
    expect(prompt).toContain("`software-teams-planner` has produced a three-tier plan for issue #41");
  });

  test("initial plan brief embeds the collapsible <details> response template", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" } }));
    expect(prompt).toContain("<details>");
    expect(prompt).toContain("<summary>View full plan</summary>");
    expect(prompt).toContain("</details>");
    expect(prompt).toContain("**Overall size:**");
    expect(prompt).toContain("| ID | Task | Agent | Size | Requires |");
    expect(prompt).toContain("Any changes before implementation?");
  });

  test("refinement brief forbids source-code edits + git writes", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isRefinement: true } }));
    expect(prompt).toMatch(/do not write source code/i);
    expect(prompt).toMatch(/do not run git commit/i);
  });

  test("refinement brief mandates the matching agent-named opening line", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isRefinement: true }, issueNumber: 17 }));
    expect(prompt).toContain("`software-teams-planner` refined the plan for issue #17");
  });

  test("approval brief defers implementation to a later run", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isApproval: true } }));
    expect(prompt).toMatch(/do not begin implementation/i);
  });
});

describe("buildRouterPrompt — auto-commit blocks (impl / quick)", () => {
  test("issue-context impl: emits feature-branch auto-commit + PR proposal scaffold + anti-merge guard", () => {
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
    expect(prompt).toContain("## Auto-Commit (issue-triggered: fresh feature branch)");
    expect(prompt).toContain("software-teams/issue-36-implement-render-nav");
    expect(prompt).toContain("default: `main`");
    expect(prompt).toContain("Closes #36");
    expect(prompt).toContain("git push -u origin software-teams/issue-36-implement-render-nav");
    expect(prompt).toMatch(/Do NOT run `gh pr create`/);
    expect(prompt).toContain("## PR proposal");
    expect(prompt).toContain("pull/new/software-teams/issue-36-implement-render-nav");
    expect(prompt).toMatch(/push to `main` directly/);
    expect(prompt).toMatch(/force-push to any branch/);
  });

  test("PR-context impl (no feature branch): emits PR-context auto-commit (just `git push`)", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "implement" } }));
    expect(prompt).toContain("## Auto-Commit (PR context — already on the correct branch)");
    expect(prompt).toMatch(/already on the PR's head branch/);
    expect(prompt).toMatch(/`git push` \(no -u, no origin, no branch name/);
    expect(prompt).toMatch(/NEVER merge the PR/);
    // Must NOT show the issue-context scaffold
    expect(prompt).not.toContain("## PR proposal");
    expect(prompt).not.toMatch(/git push -u origin/);
  });

  test("PR-context quick (no feature branch): emits PR-context auto-commit", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "quick" } }));
    expect(prompt).toContain("## Auto-Commit (PR context — already on the correct branch)");
    expect(prompt).not.toContain("## PR proposal");
  });

  test("review / feedback / plan flows never get any auto-commit block", () => {
    const ctxBase = {
      featureBranch: { branchName: "should-not-appear", defaultBranch: "main" },
      issueNumber: 1,
    };
    for (const flow of [{ kind: "review" } as const, { kind: "feedback" } as const, { kind: "plan" } as const]) {
      const prompt = buildRouterPrompt(makeCtx({ flow, ...ctxBase }));
      expect(prompt).not.toContain("should-not-appear");
      expect(prompt).not.toContain("## Auto-Commit");
      expect(prompt).not.toContain("## PR proposal");
    }
  });
});

describe("buildRouterPrompt — implement brief (three-tier aware)", () => {
  test("implement brief reads orchestration + per-agent slices, NOT the legacy `.plan.md`", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "implement" } }));
    expect(prompt).toContain("*.orchestration.md");
    expect(prompt).toContain("*.spec.md");
    expect(prompt).toMatch(/\*\.T\{n\}\.md/);
    expect(prompt).not.toMatch(/most recent \*\.plan\.md/);
  });

  test("implement brief tells the agent it has no Task tool — execute in-context", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "implement" } }));
    expect(prompt).toMatch(/don't have the Task tool|execute every slice in this single context/i);
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
