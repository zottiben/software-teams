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

  test("initial plan brief mandates exact opening line naming the agent + three-tier (discreet mode)", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" }, issueNumber: 41 }));
    expect(prompt).toContain("**The Planning Agent** has produced a three-tier plan for issue #41");
    // Internal subagent name must never appear in the user-facing opener.
    expect(prompt).not.toContain("`software-teams-planner` has produced");
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

  test("initial plan brief requires an `### Open questions` section with `_none._` fallback", () => {
    // Mirrors `commands/create-plan.md:199` — the local skill's response
    // shape requires an Open questions bullet list OR the literal `none`.
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" } }));
    expect(prompt).toContain("### Open questions");
    expect(prompt).toContain("_none._");
    expect(prompt).toMatch(/do NOT omit this section/i);
  });

  test("refinement brief forbids source-code edits + git writes", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isRefinement: true } }));
    expect(prompt).toMatch(/do not write source code/i);
    expect(prompt).toMatch(/do not run git commit/i);
  });

  test("refinement brief mandates the matching agent-named opening line (discreet mode)", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan", isRefinement: true }, issueNumber: 17 }));
    expect(prompt).toContain("**The Planning Agent** refined the plan for issue #17");
    expect(prompt).not.toContain("`software-teams-planner` refined");
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

  test("issue-context impl WITH a detected PR template: brief inlines the template + tells the agent to fill it", () => {
    const prompt = buildRouterPrompt(
      makeCtx({
        flow: { kind: "implement" },
        issueNumber: 44,
        repo: "zottiben/test-project-one",
        featureBranch: {
          branchName: "software-teams/issue-44-implement-render-nav",
          defaultBranch: "main",
        },
        prTemplate: {
          path: ".github/PULL_REQUEST_TEMPLATE.md",
          body: "## Summary\n\n<!-- describe the change -->\n\n## Test plan\n\n- [ ] tests pass",
        },
      }),
    );
    expect(prompt).toContain("### PR template detected");
    expect(prompt).toContain(".github/PULL_REQUEST_TEMPLATE.md");
    // Raw template body must be inlined inside fenced code so the agent
    // sees exactly what to fill.
    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Test plan");
    expect(prompt).toMatch(/Replace every `<!-- … -->` placeholder|placeholder hints?/);
    // Default "one short paragraph summary" placeholder must NOT appear
    // when a template is in play.
    expect(prompt).not.toContain("<one short paragraph summary>");
    expect(prompt).toContain("the FILLED PR template");
  });

  test("issue-context impl WITHOUT a PR template: keeps the default `<one short paragraph summary>` placeholder", () => {
    const prompt = buildRouterPrompt(
      makeCtx({
        flow: { kind: "implement" },
        issueNumber: 44,
        featureBranch: {
          branchName: "software-teams/issue-44-implement",
          defaultBranch: "main",
        },
      }),
    );
    expect(prompt).not.toContain("### PR template detected");
    expect(prompt).toContain("<one short paragraph summary>");
  });

  test("prTemplate is ignored on PR-context impl/quick (no new PR is being opened)", () => {
    const prompt = buildRouterPrompt(
      makeCtx({
        flow: { kind: "implement" },
        // No featureBranch → PR-context path.
        prTemplate: {
          path: ".github/PULL_REQUEST_TEMPLATE.md",
          body: "should not leak into prompt",
        },
      }),
    );
    expect(prompt).not.toContain("### PR template detected");
    expect(prompt).not.toContain("should not leak into prompt");
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

  test("review / plan flows get NO auto-commit block (review never writes, plan is files-only)", () => {
    for (const flow of [{ kind: "review" } as const, { kind: "plan" } as const]) {
      const prompt = buildRouterPrompt(makeCtx({ flow, issueNumber: 1 }));
      expect(prompt).not.toContain("## Auto-Commit");
      expect(prompt).not.toContain("## PR proposal");
    }
  });

  test("feedback + post-impl-iteration get the PR-context auto-commit block (they push to the PR branch)", () => {
    for (const flow of [{ kind: "feedback" } as const, { kind: "post-impl-iteration" } as const]) {
      const prompt = buildRouterPrompt(makeCtx({ flow, issueNumber: 1 }));
      expect(prompt).toContain("## Auto-Commit (PR context — already on the correct branch)");
      expect(prompt).not.toContain("## PR proposal");
    }
  });

  test("featureBranch is ignored on flows that aren't impl/quick (so stray context doesn't leak)", () => {
    const featureBranch = { branchName: "should-not-appear", defaultBranch: "main" };
    for (const flow of [{ kind: "review" } as const, { kind: "feedback" } as const, { kind: "plan" } as const]) {
      const prompt = buildRouterPrompt(makeCtx({ flow, featureBranch, issueNumber: 1 }));
      expect(prompt).not.toContain("should-not-appear");
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

  test("implement brief mandates the static agent-named opener (parity with plan/review/feedback flows)", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "implement" }, issueNumber: 44 }));
    expect(prompt).toContain("**The Implementation Agent** implemented the plan for issue #44");
  });

  test("quick brief mandates its own agent-named opener", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "quick" }, issueNumber: 17 }));
    expect(prompt).toContain("**The Implementation Agent** applied a quick change for issue #17");
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

describe("buildRouterPrompt — discreet-mode style directives", () => {
  const allFlows: ActionFlow[] = [
    { kind: "plan" },
    { kind: "plan", isRefinement: true },
    { kind: "implement" },
    { kind: "quick" },
    { kind: "review" },
    { kind: "feedback" },
    { kind: "post-impl-iteration" },
  ];

  for (const flow of allFlows) {
    const tag = `${flow.kind}${"isRefinement" in flow && flow.isRefinement ? " (refinement)" : ""}`;
    test(`[${tag}] brief carries the self-reference style directive (no brand leak)`, () => {
      const prompt = buildRouterPrompt(makeCtx({ flow }));
      expect(prompt).toContain("## Self-reference style (MANDATORY)");
      expect(prompt).toMatch(/never the internal subagent identifier/i);
      // The brief must explicitly forbid the four `software-teams-*` names
      // in user-visible output.
      expect(prompt).toContain("Do NOT use the literal strings `software-teams-planner`, `software-teams-programmer`, `software-teams-quality`, or `software-teams-pr-feedback`");
    });
  }

  test("user-facing role labels are well-known and consistent across flows", () => {
    const prompt = buildRouterPrompt(makeCtx({ flow: { kind: "plan" } }));
    expect(prompt).toContain("**The Planning Agent**");
    expect(prompt).toContain("**The Implementation Agent**");
    expect(prompt).toContain("**The Review Agent**");
    expect(prompt).toContain("**The Feedback Agent**");
  });
});
