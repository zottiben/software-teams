import { describe, test, expect } from "bun:test";
import { buildRulesBlock } from "../../../utils/prompt-builder";
import { parseComment } from "../run";

/**
 * run.ts (formerly action.ts) builds prompts inline in its switch cases.
 * These tests verify the key invariant phrases that must appear in the
 * prompt templates by testing the shared building blocks used by run.ts.
 *
 * The plan case prompt references "split format" / "Plan File Format" / "SPLIT" inline.
 * The refinement case prompt references "SPLIT plan format" inline.
 * The implement case uses buildRulesBlock from prompt-builder.
 *
 * Since the inline strings in run.ts are string literals within a command handler
 * (not easily importable), we verify the shared functions and document the expected
 * invariants for the inline strings here.
 */

describe("action run command prompt invariants", () => {
  // Phase 2 migration note: the plan-path and refinement prompts now live in
  // `router-prompts.ts` (the helper that `buildRouterPrompt` returns). The
  // assertions below moved with them — the broader prompt-shape invariants
  // for every flow live in `router-prompts.test.ts`. These cases keep the
  // narrow source-presence guards so a future refactor can't silently delete
  // the SPLIT-format and task-file instructions.
  describe("plan case - plan-format references", () => {
    test("router-prompts source drives the planner toward three-tier (canonical Software Teams plan shape)", async () => {
      const source = await Bun.file(new URL("../router-prompts/brief-builders.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/three-tier/i);
      // The canonical three-tier artifacts contract now lives in the shared
      // fragment imported here — verify the import is present and the
      // fragment file still carries the per-tier specifics.
      expect(source).toContain("plan-three-tier-artifacts.md");
      expect(source).toContain("planThreeTierArtifactsFragment");
      const fragment = await Bun.file(
        new URL("../../../../commands/_shared/plan-three-tier-artifacts.md", import.meta.url).pathname,
      ).text();
      expect(fragment).toContain("spec.md");
      expect(fragment).toContain("orchestration.md");
      expect(fragment).toMatch(/\.T\{?n?\}?\.md/);
      expect(fragment).toContain("task_files");
    });

    test("run.ts must NOT contain inline task detail template (no monolithic plan format leaked back)", async () => {
      const source = await Bun.file(new URL("../run.ts", import.meta.url).pathname).text();
      expect(source).not.toMatch(/### T1 [^|]/);
    });
  });

  describe("refinement case - in-place plan edits", () => {
    test("router-prompts source keeps refinement → in-place edit + tier-preservation guidance", async () => {
      const source = await Bun.file(new URL("../router-prompts/brief-builders.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/update them in place/i);
      expect(source).toMatch(/do NOT switch tiers/);
    });
  });

  describe("implement case - rules", () => {
    test("implement case uses buildRulesBlock", async () => {
      const source = await Bun.file(new URL("../run/prompt-assembly.ts", import.meta.url).pathname).text();
      expect(source).toContain("buildRulesBlock");
    });

    test("buildRulesBlock output contains rules header", () => {
      const block = buildRulesBlock("typescript").join("\n");
      expect(block).toContain("## Rules");
    });
  });

  describe("label-trigger path", () => {
    test("source defines --event-type arg in citty args block", async () => {
      const source = await Bun.file(new URL("../run/command.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/"event-type":\s*\{/);
    });

    test("source defines ALLOWED_EVENT_TYPES allow-list with 'issue_labeled'", async () => {
      const source = await Bun.file(new URL("../run/constants.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/ALLOWED_EVENT_TYPES\s*=\s*new\s+Set\(\["issue_labeled"\]\)/);
    });

    test("source validates event-type against allow-list and exits non-zero on unknown value", async () => {
      const source = await Bun.file(new URL("../run/command.ts", import.meta.url).pathname).text();
      // Check for validation logic that rejects unknown event types
      expect(source).toMatch(/ALLOWED_EVENT_TYPES\.has\(args\["event-type"\]\)/);
      // Check that it calls process.exit(1) on validation failure
      expect(source).toMatch(/process\.exit\(1\)/);
    });

    test("source contains branch for args['event-type'] === 'issue_labeled'", async () => {
      const source = await Bun.file(new URL("../run/command.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/args\["event-type"\]\s*===\s*"issue_labeled"/);
    });

    test("label-triggered branch calls fetchIssueTitleAndBody", async () => {
      const source = await Bun.file(new URL("../run/label-path.ts", import.meta.url).pathname).text();
      // Verify the function is imported
      expect(source).toMatch(/fetchIssueTitleAndBody/);
      // Verify it's called (looking for the actual invocation)
      expect(source).toMatch(/await\s+fetchIssueTitleAndBody\(/);
    });

    test("label-triggered branch calls sanitizeUserInput on the synthetic description", async () => {
      const source = await Bun.file(new URL("../run/label-path.ts", import.meta.url).pathname).text();
      // Check that sanitizeUserInput is called after the fetch
      expect(source).toMatch(/sanitizeUserInput\(/);
    });

    test("router-prompts module fences the user-request block (sanitizes user-controlled content)", async () => {
      // After phase 5 cleanup the action runner no longer builds prompts
      // directly — every per-flow prompt lives in router-prompts.ts, which is
      // where `fenceUserInput("user-request", …)` now belongs.
      const source = await Bun.file(new URL("../router-prompts/brief-builders.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/fenceUserInput\("user-request"/);
    });

    test("source imports fetchIssueTitleAndBody from github utils", async () => {
      const source = await Bun.file(new URL("../run/label-path.ts", import.meta.url).pathname).text();
      expect(source).toContain("fetchIssueTitleAndBody");
      expect(source).toMatch(/from\s+["'].*\/utils\/github["']/);
    });
  });

  describe("parent-Claude model pin (cost control)", () => {
    test("defines ACTION_MODEL backed by SOFTWARE_TEAMS_MODEL env var", async () => {
      const source = await Bun.file(new URL("../run/constants.ts", import.meta.url).pathname).text();
      // Constant lives at module scope so all three spawnClaude call sites share it.
      expect(source).toMatch(/const\s+ACTION_MODEL\s*=\s*process\.env\.SOFTWARE_TEAMS_MODEL\s*\|\|\s*["']claude-sonnet-4-6["']/);
    });

    test("every spawnClaude call in the action runner threads model: ACTION_MODEL", async () => {
      const source = await Bun.file(new URL("../run/spawner.ts", import.meta.url).pathname).text();
      const spawnCalls = source.match(/await\s+spawnClaude\([\s\S]*?\)\s*;/g) ?? [];
      expect(spawnCalls.length).toBeGreaterThanOrEqual(3); // label plan, comment-driven, full-flow impl
      for (const call of spawnCalls) {
        expect(call).toMatch(/model:\s*ACTION_MODEL/);
      }
    });
  });

  describe("trigger phrase", () => {
    test("parseComment regex matches the 'Hey Software Teams' trigger (spaced or hyphenated)", async () => {
      // Locked-in source guard — parseComment regex is internal, so verify
      // via source text. The `software[\s-]?teams` segment accepts both
      // "Hey Software Teams" (user-friendly spaced form) and
      // "Hey software-teams" (legacy hyphenated form).
      const source = await Bun.file(new URL("../run/intent-parser.ts", import.meta.url).pathname).text();
      const re = source.match(/hey\\s\+software\[\\s-\]\?teams\\s\+\(\.\+\)/);
      expect(re).not.toBeNull();
    });

    test("thinking placeholder uses the chat-like header, not the legacy brand format", async () => {
      const source = await Bun.file(new URL("../run/command.ts", import.meta.url).pathname).text();
      expect(source).toContain("🧠 Working on it...");
      expect(source).not.toMatch(/🧠 Software Teams <sup>thinking<\/sup>/);
    });

    test("approval message points users to the 'Hey Software Teams' trigger", async () => {
      const source = await Bun.file(new URL("../run/approval-ping.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/Hey Software Teams implement/);
    });
  });

  describe("external context (ClickUp + Datadog) wiring", () => {
    // Source-level guards — the runner needs to (a) extract URLs from
    // BOTH the trigger comment AND the issue/PR body (today's
    // user-visible regression: ClickUp URLs in issue bodies were
    // ignored), (b) run all external context through the shared
    // sanitiser-aware helper, (c) feed Datadog secrets through the
    // env, scrubbed. These tests fail loudly if a future refactor
    // silently drops one of those.

    test("loadExternalContexts helper aggregates ClickUp + Datadog blocks", async () => {
      const source = await Bun.file(new URL("../run/external-contexts.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/async function loadExternalContexts\(searchText: string\)/);
      expect(source).toContain("extractClickUpRef(searchText)");
      expect(source).toContain("extractDatadogIssue(searchText)");
    });

    test("comment-triggered path scans BOTH the comment AND the issue/PR body for URLs", async () => {
      const source = await Bun.file(new URL("../run/command.ts", import.meta.url).pathname).text();
      // Look for the aggregation pattern: corpus starts as the
      // comment description, then appends the issue title + body.
      expect(source).toMatch(/let externalSearchCorpus = intent\.description/);
      expect(source).toMatch(/externalSearchCorpus \+= `\\n\$\{issueRecord\.title\}\\n\$\{issueRecord\.body\}`/);
    });

    test("label-triggered path also runs the external-context lookup against the synthetic issue text", async () => {
      const source = await Bun.file(new URL("../run/label-path.ts", import.meta.url).pathname).text();
      // The label-triggered path's `intent.description` is already
      // `${title}\n\n${body}`, so loadExternalContexts is called
      // directly on it.
      expect(source).toMatch(/loadExternalContexts\(intent\.description\)/);
    });

    test("ClickUp output is routed through scrubPII (ticket bodies often contain customer references)", async () => {
      const clickup = await Bun.file(new URL("../../../utils/clickup.ts", import.meta.url).pathname).text();
      expect(clickup).toMatch(/import \{ scrubPII \} from ["']\.\/pii-scrubber["']/);
      expect(clickup).toContain("scrubPII(ticket.name)");
      expect(clickup).toContain("scrubPII(ticket.description)");
    });

    test("workflow template threads DATADOG_API_KEY + DATADOG_APP_KEY secrets through the env", async () => {
      const tmpl = await Bun.file(
        new URL("../../../../action/workflow-template.yml", import.meta.url).pathname,
      ).text();
      expect(tmpl).toMatch(/DATADOG_API_KEY:\s*\$\{\{\s*secrets\.DATADOG_API_KEY\s*\}\}/);
      expect(tmpl).toMatch(/DATADOG_APP_KEY:\s*\$\{\{\s*secrets\.DATADOG_APP_KEY\s*\}\}/);
    });
  });

  describe("parseComment — follow-up command recognition (regression: issue 6190)", () => {
    // Background: when a user replies in-thread with a clear command verb
    // ("implement the plan", "approve", "review"), parseComment used to
    // silently route the entire comment to feedback whenever the strict
    // "Hey Software Teams" trigger regex didn't match. That swallowed
    // the command and produced a new plan instead of implementing — the
    // exact regression reported on issue 6190 ("Hey AI implement the
    // plan" → planner re-ran, no implementation).
    //
    // The fix: on a follow-up, when the strict trigger regex fails,
    // strip a generic salutation prefix and run the same command-keyword
    // checks. Only fall back to feedback when NO explicit command word
    // is present.

    test("`Hey AI implement the plan` on a follow-up routes to implement, NOT feedback", () => {
      const parsed = parseComment("Hey AI implement the plan", true);
      expect(parsed).not.toBeNull();
      expect(parsed!.command).toBe("implement");
      expect(parsed!.isFeedback).toBe(false);
    });

    test("`Hi bot, please implement` on a follow-up routes to implement", () => {
      const parsed = parseComment("Hi bot, please implement", true);
      expect(parsed!.command).toBe("implement");
      expect(parsed!.isFeedback).toBe(false);
    });

    test("`@software-teams-bot lgtm` on a follow-up is recognised as approval", () => {
      const parsed = parseComment("@software-teams-bot lgtm", true);
      expect(parsed!.isFeedback).toBe(true);
      expect(parsed!.isApproval).toBe(true);
    });

    test("`implement` typed bare on a follow-up routes to implement", () => {
      const parsed = parseComment("implement", true);
      expect(parsed!.command).toBe("implement");
      expect(parsed!.isFeedback).toBe(false);
    });

    test("`Yo Claude review this` on a follow-up routes to review", () => {
      const parsed = parseComment("Yo Claude review this", true);
      expect(parsed!.command).toBe("review");
      expect(parsed!.isFeedback).toBe(false);
    });

    test("free-form follow-up without a command keyword still falls back to feedback", () => {
      // Regression guard for the OTHER direction: don't accidentally
      // start routing every free-form follow-up to a command. "Can you
      // also add tests?" is feedback, not a quick/implement/review.
      const parsed = parseComment("Hey AI can you also add tests?", true);
      expect(parsed!.isFeedback).toBe(true);
      expect(parsed!.command).toBe("plan"); // placeholder; isFeedback drives the runner
    });

    test("free-form follow-up with no salutation at all still falls back to feedback", () => {
      const parsed = parseComment("Looks fine but what about the edge case where the user has no email?", true);
      expect(parsed!.isFeedback).toBe(true);
    });

    test("non-follow-up comment without a trigger phrase still returns null (unchanged)", () => {
      // The new loose-salutation branch fires only on follow-ups. A
      // brand-new comment (no prior assistant comment in thread) with
      // no trigger phrase should still be ignored, same as before.
      const parsed = parseComment("Hey AI please implement this", false);
      expect(parsed).toBeNull();
    });

    test("`Hey Software Teams implement the plan` (the original trigger) still works", () => {
      // Regression guard: the canonical trigger phrase path must keep
      // working exactly as before — the loose-salutation branch is a
      // FALLBACK, not a replacement.
      const parsed = parseComment("Hey Software Teams implement the plan", true);
      expect(parsed!.command).toBe("implement");
      expect(parsed!.isFeedback).toBe(false);
    });
  });

  describe("feature branch naming (no brand leak, no command-verb duplication)", () => {
    test("`prepareIssueFeatureBranch` uses `issue-<N>-<slug>` (no `software-teams/` prefix)", async () => {
      const source = await Bun.file(new URL("../run/feature-branch.ts", import.meta.url).pathname).text();
      // The branch builder must NOT prefix with `software-teams/` anymore —
      // PR titles auto-derive from branch names and we don't want the
      // brand leaking there.
      expect(source).toMatch(/branchName = `issue-\$\{opts\.issueNumber\}-\$\{slug\}`/);
      expect(source).not.toMatch(/software-teams\/issue-\$\{opts\.issueNumber\}/);
    });

    test("`prepareIssueFeatureBranch` strips leading command verbs from the slug", async () => {
      // For inputs like "implement the plan" / "quick fix the X", strip
      // the leading verb so the slug isn't duplicated with the command
      // word (avoids the old "implement-implement-the-plan" doubling).
      const source = await Bun.file(new URL("../run/feature-branch.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/replace\(\/\^\\s\*\(implement\|quick\|plan\|do\|the\)\\s\+\/i, ""\)/);
    });
  });

  describe("pre-plan discovery gate (phase C)", () => {
    test("runner exposes a `runDiscoveryAndGate` helper that aborts on questions", async () => {
      const source = await Bun.file(new URL("../run/discovery-gate.ts", import.meta.url).pathname).text();
      expect(source).toMatch(/async function runDiscoveryAndGate/);
      expect(source).toMatch(/parseResearcherQuestions/);
      expect(source).toMatch(/formatQuestionsCommentBody/);
    });

    test("all three plan entry points route through runDiscoveryAndGate", async () => {
      const source = await Bun.file(new URL("../run/prompt-assembly.ts", import.meta.url).pathname).text();
      const calls = source.match(/await runDiscoveryAndGate\(/g) ?? [];
      // Label-triggered plan, comment-driven `case "plan"`, and the
      // follow-up branch when no plan exists yet — three sites.
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    test("isFeedback follow-up checks for existing orchestration before routing", async () => {
      const source = await Bun.file(new URL("../run/prompt-assembly.ts", import.meta.url).pathname).text();
      // The branch reroutes to discovery-gate when no plan exists for the
      // current issue. Source-grep guards lock that invariant.
      expect(source).toMatch(/answer-to-pre-plan-questions/);
      expect(source).toMatch(/findActiveOrchestration\(cwd, issueNumber\)/);
    });

    test("aborted gate returns early — no planner spawn after questions are posted", async () => {
      const source = await Bun.file(new URL("../run/prompt-assembly.ts", import.meta.url).pathname).text();
      // Every gate call must guard against aborted state. Accept both
      // `if (gateResult.aborted) return;` and the brace form
      // `if (gateResult.aborted) { ... return; }` used in the label path.
      const guards = source.match(/if \(gateResult\.aborted\)/g) ?? [];
      expect(guards.length).toBeGreaterThanOrEqual(3);
    });
  });
});
