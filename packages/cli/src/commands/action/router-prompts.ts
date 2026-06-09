/**
 * Router-prompt builder for the GitHub Action.
 *
 * Today the action's parent `claude -p` invocation self-plays specialist
 * roles by inlining the spec body (`software-teams-planner.md` etc.) into
 * its prompt. That is the legacy pattern — Software Teams when invoked
 * locally via Claude Code spawns its specialists as native subagents
 * (`Task(subagent_type: "software-teams-*")`), letting each spec's
 * `model:` / `tools:` / `effort:` frontmatter take effect natively.
 *
 * This module is the pure helper that the action runner will switch to in
 * later phases. Each flow yields a single prompt string that instructs
 * the parent to spawn the right specialist via the Task tool and echo its
 * final text as the response. No code in `run.ts` calls this yet — that
 * migration happens in phases 2-4. Phase 1 (this commit) only adds the
 * helper + tests so the contract can be reviewed in isolation.
 *
 * Subagent assignments (confirmed by user):
 * - plan / plan-refinement → `software-teams-planner` (Opus pin retained)
 * - implement / quick → `software-teams-programmer` (Sonnet)
 * - review → `software-teams-quality` (Sonnet)
 * - feedback (PR review comments) → `software-teams-pr-feedback` (Sonnet)
 * - post-impl-iteration → `software-teams-pr-feedback` (Sonnet)
 */

import { fenceUserInput } from "../../utils/sanitize";
import { agentTypeToRoleLabel, type ActiveOrchestration } from "../../utils/orchestration";

// Shared prompt fragments — see `commands/_shared/README.md`.
// `bun build --target=bun` inlines `with { type: "text" }` imports at
// build time, so the fragments ship embedded in `dist/index.js`.
import selfReferenceStyleFragment from "../../../commands/_shared/self-reference-style.md" with { type: "text" };
import planThreeTierArtifactsFragment from "../../../commands/_shared/plan-three-tier-artifacts.md" with { type: "text" };
import prTemplateConcisenessFragment from "../../../commands/_shared/pr-template-conciseness.md" with { type: "text" };

export type ActionFlow =
  | { kind: "plan"; isRefinement?: boolean; isApproval?: boolean }
  | { kind: "implement" }
  | { kind: "quick" }
  | { kind: "review" }
  | { kind: "feedback" }
  | { kind: "post-impl-iteration" }
  | { kind: "pre-plan-discovery" };

export interface FeatureBranchContext {
  branchName: string;
  defaultBranch: string;
}

export interface PrTemplateContext {
  path: string;   // workspace-relative
  body: string;   // raw template content
}

export interface ActionContext {
  flow: ActionFlow;
  userRequest: string;            // already sanitized
  repo: string;                   // "owner/repo"
  issueNumber: number;            // issue or PR number
  conversationHistory: string;    // already sanitized; may be empty
  projectLines: string[];         // ["## Project Context", "- Type: ...", ...]
  workspaceLines: string[];       // ["## Workspace", "- Working directory: ...", ...]
  rulesBlock: string[];           // pre-built rules block lines
  featureBranch?: FeatureBranchContext;  // present when issue-context impl/quick cut a branch
  prTemplate?: PrTemplateContext;        // present when the repo has a PR template
  // Present for implement flow when the workspace has a three-tier plan
  // with ≥2 per-agent slices. Triggers the multi-spawn orchestrator brief
  // shape (parent emits N parallel Task calls, collects results, commits,
  // pushes, writes per-agent attribution). Single-slice plans and missing
  // orchestrations fall back to the legacy single-agent brief.
  orchestration?: ActiveOrchestration;
  // Pre-plan researcher's findings from a prior spawn. When set on a plan
  // flow, the brief prepends a `## Discovery findings` block so the
  // planner makes codebase-grounded decisions and only surfaces genuinely
  // unanswered questions in its `### Open questions` slot. Empty string
  // or undefined means the researcher hasn't run (or returned nothing
  // useful) — planner falls back to working from issue text alone.
  prePlanDiscovery?: string;
  isDryRun?: boolean;
}

interface SubagentSpawn {
  type: string;                   // subagent_type passed to Task
  description: string;            // short description for the Task tool's `description` field
}

export function pickSubagent(flow: ActionFlow): SubagentSpawn {
  switch (flow.kind) {
    case "plan":
      return {
        type: "software-teams-planner",
        description: flow.isRefinement
          ? "Refine existing plan with user feedback"
          : flow.isApproval
            ? "Finalise approved plan"
            : "Create implementation plan",
      };
    case "implement":
      return { type: "software-teams-programmer", description: "Implement the approved plan" };
    case "quick":
      return { type: "software-teams-programmer", description: "Make a small focused change" };
    case "review":
      return { type: "software-teams-quality", description: "Review the current PR" };
    case "feedback":
      return { type: "software-teams-pr-feedback", description: "Address PR review comments" };
    case "post-impl-iteration":
      return { type: "software-teams-pr-feedback", description: "Iterate on already-shipped code" };
    case "pre-plan-discovery":
      return { type: "software-teams-researcher", description: "Pre-plan codebase discovery" };
  }
}

function buildSubagentBrief(ctx: ActionContext): string {
  const { flow, repo, issueNumber, userRequest, conversationHistory, featureBranch } = ctx;
  const lines: string[] = [];

  lines.push(`## Context`);
  lines.push(`Repo: ${repo}`);
  lines.push(`Trigger: ${flow.kind === "plan" && flow.isRefinement ? "plan refinement" : flow.kind === "plan" && flow.isApproval ? "plan approved" : flow.kind} on #${issueNumber}`);
  lines.push("");

  // Self-reference style — never expose internal subagent names to users.
  // Even when an explicit opener template tells you exactly what to say,
  // any other self-reference in your response (e.g. "I'm the planner")
  // MUST use the user-facing role name instead of the `software-teams-*`
  // subagent identifier. Single source of truth lives in
  // `commands/_shared/self-reference-style.md`.
  lines.push(selfReferenceStyleFragment.trim());
  lines.push("");

  lines.push(...ctx.projectLines);
  lines.push("");
  lines.push(...ctx.workspaceLines);
  lines.push("");
  if (ctx.rulesBlock.length > 0) {
    lines.push(...ctx.rulesBlock);
    lines.push("");
  }

  if (conversationHistory) {
    lines.push(fenceUserInput("conversation-history", conversationHistory));
  } else {
    lines.push("<conversation-history>\n(none)\n</conversation-history>");
  }
  lines.push("");

  // Per-flow body
  switch (flow.kind) {
    case "plan":
      lines.push(...buildPlanBrief(ctx, flow));
      break;
    case "implement":
      lines.push(...buildImplementBrief(ctx));
      break;
    case "quick":
      lines.push(...buildQuickBrief(ctx));
      break;
    case "review":
      lines.push(...buildReviewBrief(ctx));
      break;
    case "feedback":
      lines.push(...buildFeedbackBrief(ctx));
      break;
    case "post-impl-iteration":
      lines.push(...buildPostImplBrief(ctx));
      break;
    case "pre-plan-discovery":
      lines.push(...buildPrePlanDiscoveryBrief(ctx));
      break;
  }

  if (ctx.isDryRun) {
    lines.push("");
    lines.push(`## DRY-RUN MODE`);
    lines.push(`Do NOT modify files, write commits, or push. Describe what you would do.`);
  }

  // Closing fence: user request always appears last so the agent sees the
  // most-recent intent right before formulating its plan/edit.
  lines.push("");
  lines.push(`## User Request`);
  lines.push(fenceUserInput("user-request", userRequest));

  // Auto-commit + branch instructions.
  // - impl/quick on a fresh feature branch → "PR proposal" scaffold.
  // - impl/quick on a PR comment → "just `git push`" PR-context block.
  // - feedback/post-impl-iteration → always on the PR's head branch, push
  //   semantics identical to the impl PR-context block. (review never pushes.)
  const needsFeatureBranchBlock =
    (flow.kind === "implement" || flow.kind === "quick") && !!featureBranch;
  const needsPrContextBlock =
    ((flow.kind === "implement" || flow.kind === "quick") && !featureBranch)
    || flow.kind === "feedback"
    || flow.kind === "post-impl-iteration";

  if (needsFeatureBranchBlock && featureBranch) {
    lines.push("");
    lines.push(`## Auto-Commit (issue-triggered: fresh feature branch)`);
    lines.push(`- branch: \`${featureBranch.branchName}\``);
    lines.push(`- default: \`${featureBranch.defaultBranch}\``);
    lines.push(`- closes: #${issueNumber}`);
    lines.push(``);
    lines.push(`Commit message body MUST contain \`Closes #${issueNumber}\` on its own line. Use multiple \`-m\` flags, e.g.:`);
    lines.push(`\`git commit -m "<type>: <subject>" -m "Closes #${issueNumber}" -m "<one-paragraph summary>"\``);
    lines.push(`Push with \`git push -u origin ${featureBranch.branchName}\`.`);
    lines.push(``);
    lines.push(`Do NOT run \`gh pr create\` — a human opens the PR.`);

    // PR-template-aware proposal block. When the repo ships a template,
    // the agent fills it instead of producing the default one-paragraph
    // summary; that way the human opening the PR has a body that matches
    // the repo's own contribution norms (test plan, screenshots, etc.).
    // PR title + body pre-fill. CRITICAL: the URL must use the \`compare/\`
    // form (\`compare/<default>...<branch>?expand=1&title=…&body=…\`) — NOT
    // \`pull/new/<branch>?title=…&body=…\`. GitHub silently drops the query
    // string on \`pull/new/\` URLs, falling back to branch-name-derived
    // titles and an empty body. Only the \`compare/\` form honours
    // \`?title=\` and \`?body=\` (per
    // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/creating-pull-requests).
    //
    // We need both query params because:
    //   - Title pre-fill prevents GitHub's "Issue 51 plan" branch-derived
    //     fallback on multi-commit PRs.
    //   - Body pre-fill ensures \`Closes #N\` is in the PR body, which is
    //     what GitHub uses to wire the Issue ↔ PR link in the issue's
    //     "Development" section. Commit-message keywords trigger auto-close
    //     on merge but do NOT create the sidebar link.
    const compareUrlBase = `https://github.com/${repo}/compare/${featureBranch.defaultBranch}...${featureBranch.branchName}`;
    // Encoding rules for the [Open this PR] link below. These are
    // INSTRUCTIONS for how to build the URL — do NOT emit any of this
    // as a heading or quoted block in the response. The user-facing
    // response should END with the `## PR proposal` block + the link;
    // restating the title and body above the link is redundant noise
    // (the link already carries them as URL-encoded query params).
    const prTitleGuidance = [
      ``,
      `**How to build the [Open this PR] link below — internal rules, do NOT emit these as a heading or quote block in your response:**`,
      ``,
      `- **Title** — conventional-commit shape \`<type>: <subject>\` where \`<type>\` is one of \`feat\`, \`fix\`, \`chore\`, \`refactor\`, \`docs\`, \`test\`, \`perf\`, \`style\`. Subject is imperative, lower-case, no trailing dot. Examples: \`feat: render Nav across all routes\` / \`fix: handle null in /stats response\` / \`chore: bump bun to 1.3.7\`.`,
      `- **Body** — MUST start with \`Closes #${issueNumber}\` on its own line, followed by a blank line, followed by your summary (or the FILLED PR template if one was detected). The \`Closes\` keyword is what GitHub uses to create the Issue ↔ PR link in the "Development" section.`,
      `- **URL** — MUST be the \`compare/\` form with \`?expand=1\` (NOT \`pull/new/...\` — GitHub drops query params on that one): \`${compareUrlBase}?expand=1&title=<encoded-title>&body=<encoded-body>\`.`,
      `- **URL-encode** both params. space→\`%20\`, newline→\`%0A\` (blank line→\`%0A%0A\`), colon→\`%3A\`, hash→\`%23\` (so \`#${issueNumber}\` → \`%23${issueNumber}\`), slash→\`%2F\`, comma→\`%2C\`, parens→\`%28\`/\`%29\`.`,
      `- **Worked example** (for your reference only, do not echo it): title \`feat: render Nav\` encodes to \`feat%3A%20render%20Nav\`; body \`Closes #${issueNumber}\\n\\nSummary.\` encodes to \`Closes%20%23${issueNumber}%0A%0ASummary.\`.`,
      `- **Never** include "Software Teams" anywhere in the title or body — the brand is intentionally hidden from end users.`,
    ];

    if (ctx.prTemplate) {
      lines.push("");
      lines.push(`### PR template detected`);
      lines.push(`This repo has a PR template at \`${ctx.prTemplate.path}\`. Fill it with content drawn from your implementation — replace every \`<!-- … -->\` placeholder hint with real content, complete every checklist item that the change satisfies, leave items you genuinely cannot verify unchecked. Preserve all section headings verbatim.`);
      lines.push("");
      // Conciseness rules — canonical text shared with the orchestrator
      // brief below via `commands/_shared/pr-template-conciseness.md`.
      // Without these, the agent fills the template with per-file
      // enumerations that read like a compliance report rather than a
      // reviewer-friendly summary.
      lines.push(prTemplateConcisenessFragment.trim());
      lines.push("");
      lines.push(`Template body (between the fences):`);
      lines.push("```markdown");
      lines.push(ctx.prTemplate.body.trim());
      lines.push("```");
      lines.push(...prTitleGuidance);
      lines.push(``);
      lines.push(`End your response with EXACTLY this block (no further text):`);
      lines.push("");
      lines.push(`## PR proposal`);
      lines.push("");
      lines.push(`**Title:** \`<your conventional-commit title — same one you encoded into the URL>\``);
      lines.push(`**Branch:** \`${featureBranch.branchName}\``);
      lines.push(`**Closes:** #${issueNumber}`);
      lines.push("");
      lines.push(`<the FILLED PR template — preserve its section headings, replace placeholder hints with implementation details. Do NOT wrap this in code fences; render it as live markdown so reviewers can read it directly in the issue comment.>`);
      lines.push("");
      lines.push(`[Open this PR](${compareUrlBase}?expand=1&title=<url-encoded-title>&body=<url-encoded-body-starting-with-Closes-N>)`);
    } else {
      lines.push(...prTitleGuidance);
      lines.push(``);
      lines.push(`End your response with EXACTLY this block (no further text):`);
      lines.push("");
      lines.push(`## PR proposal`);
      lines.push("");
      lines.push(`**Title:** \`<your conventional-commit title — same one you encoded into the URL>\``);
      lines.push(`**Branch:** \`${featureBranch.branchName}\``);
      lines.push(`**Closes:** #${issueNumber}`);
      lines.push("");
      lines.push(`<one short paragraph summary>`);
      lines.push("");
      lines.push(`[Open this PR](${compareUrlBase}?expand=1&title=<url-encoded-title>&body=<url-encoded-body-starting-with-Closes-N>)`);
    }

    lines.push("");
    lines.push(`NEVER, under any circumstance:`);
    lines.push(`- run \`gh pr create\` / \`gh pr merge\` / any other PR-creating/merging command`);
    lines.push(`- push to \`${featureBranch.defaultBranch}\` directly`);
    lines.push(`- force-push to any branch`);
    lines.push(`- switch back to \`${featureBranch.defaultBranch}\` and commit there`);
  } else if (needsPrContextBlock) {
    lines.push("");
    lines.push(`## Auto-Commit (PR context — already on the correct branch)`);
    lines.push(`You are already on the PR's head branch. Do NOT create new branches or switch branches.`);
    lines.push(``);
    lines.push(`After making changes:`);
    lines.push(`1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)`);
    lines.push(`2. \`git commit\` with a conventional commit message.`);
    lines.push(`3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)`);
    lines.push(``);
    lines.push(`NEVER merge the PR (\`gh pr merge\`), force-push, or push to a different branch.`);
  }

  return lines.join("\n");
}

function buildPlanBrief(ctx: ActionContext, flow: { kind: "plan"; isRefinement?: boolean; isApproval?: boolean }): string[] {
  if (flow.isRefinement) {
    return [
      `## Refinement Task`,
      `Read existing plan files under \`.software-teams/plans/\` and update them in place based on the user's feedback below. Do NOT create new plan files unless the existing ones are missing. Increment any \`revision:\` counter in frontmatter. Maintain whichever tier the plan already uses — do NOT switch tiers.`,
      `Do NOT write source code. Do NOT run git commit/push. Plan updates only.`,
      ``,
      `## Response Format (MANDATORY — exact shape)`,
      ``,
      `Begin with EXACTLY this line:`,
      ``,
      `**The Planning Agent** refined the plan for issue #${ctx.issueNumber}.`,
      ``,
      `Then a 1-sentence summary of what changed. Then the same collapsible-details block as a fresh plan (see Plan Task spec). End with EXACTLY: "Any changes before implementation?"`,
    ];
  }
  if (flow.isApproval) {
    return [
      `## Finalise Plan`,
      `The user approved the plan. Confirm the plan is ready for implementation and return a 1-2 sentence summary plus the tasks table. Do NOT begin implementation in this run.`,
    ];
  }
  const discoveryBlock: string[] = ctx.prePlanDiscovery && ctx.prePlanDiscovery.trim()
    ? [
        `## Discovery findings (from the Research Agent)`,
        ``,
        `The Research Agent surveyed the workspace before this run. Treat these findings as authoritative — make codebase-grounded decisions, do NOT generic-guess against them. If the findings include unresolved \`### Pre-plan questions\`, surface ONLY those (and any new ones you discover while planning) in your own \`### Open questions\` section below — do NOT silently make decisions on the user's behalf.`,
        ``,
        ctx.prePlanDiscovery.trim(),
        ``,
        `---`,
        ``,
      ]
    : [];

  return [
    ...discoveryBlock,
    `## Plan Task`,
    ``,
    `Three-tier output is required for action-driven plans — do NOT apply the planner's single-tier downgrade rule, because the action's downstream flow assumes three-tier output. The artifact shape itself is documented in the shared fragment below.`,
    ``,
    // Three-tier artifacts contract — canonical text shared with
    // `commands/create-plan.md` via `commands/_shared/plan-three-tier-artifacts.md`.
    // Single source of truth on the artifact shape; this action wraps
    // it with the "always three-tier" mandate above and the per-run
    // issue/repo provenance below.
    planThreeTierArtifactsFragment.trim(),
    ``,
    `**For this run specifically:** the orchestration's frontmatter \`issue:\` field MUST be \`issue: ${ctx.issueNumber}\` and \`repo:\` MUST be \`repo: ${ctx.repo}\` so the action's runner can find this plan when implementing.`,
    ``,
    `### Scope rules`,
    ``,
    `- Plan only what was explicitly requested — no bonus testing/linting/CI unless asked.`,
    `- T-shirt sizes (S, M, L) only. Never time estimates.`,
    `- If ambiguous, ask via the AskUserQuestion tool. Do NOT guess.`,
    ``,
    `## Response Format (MANDATORY — exact shape, ≤ 60 lines)`,
    ``,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Planning Agent** has produced a three-tier plan for issue #${ctx.issueNumber}.`,
    ``,
    `Follow with a one-sentence objective, then this collapsible block. The entire plan body lives INSIDE the \`<details>\` — nothing about the tasks should appear outside it.`,
    ``,
    `<details>`,
    `<summary>View full plan</summary>`,
    ``,
    `## {Plan Name}`,
    ``,
    `**Overall size:** {S|M|L}`,
    ``,
    `### Tasks`,
    ``,
    `| ID | Task | Agent | Size | Requires |`,
    `|----|------|-------|------|----------|`,
    `| T1 | {name} | {Role Agent} | {S|M|L} | — |`,
    ``,
    `(one short line per task — full detail lives in the per-agent slice)`,
    ``,
    `**Agent column — IMPORTANT.** Each row's \`Agent\` cell must show the user-facing role label that matches the per-agent slice's pinned \`agent:\` frontmatter field — NOT the generic "The Implementation Agent" / "The Planning Agent" used in the opener line. Mapping (drop the \`software-teams-\` prefix, Title-case the role, append \` Agent\`):`,
    ``,
    `  - \`agent: software-teams-frontend\`     → \`The Frontend Agent\``,
    `  - \`agent: software-teams-backend\`      → \`The Backend Agent\``,
    `  - \`agent: software-teams-devops\`       → \`The DevOps Agent\``,
    `  - \`agent: software-teams-quality\`      → \`The Quality Agent\``,
    `  - \`agent: software-teams-qa-tester\`    → \`The QA Agent\``,
    `  - \`agent: software-teams-security\`     → \`The Security Agent\``,
    `  - \`agent: software-teams-ux-designer\`  → \`The UX Agent\``,
    `  - \`agent: software-teams-architect\`    → \`The Architect Agent\``,
    `  - \`agent: software-teams-programmer\`   → \`The Implementation Agent\` (only when the slice genuinely has no stack-specific pin)`,
    ``,
    `Falling back to "The Implementation Agent" for stack-specific work (frontend/backend/etc.) is wrong and unhelpful — reviewers reading the issue comment use this column to tell at a glance which discipline owns each task.`,
    ``,
    `### Open questions`,
    ``,
    `Surface GENUINE unknowns that need a human to answer before implementation. Each bullet must be a real question with no defensible default.`,
    ``,
    `Valid (surface these):`,
    `- "Where should the new API live — \`apps/api/\` (currently empty placeholder) or a new \`apps/<service>/\`?"`,
    `- "The frontend has no HTTP client yet — use \`fetch\` directly, \`react-query\`, or \`axios\`?"`,
    `- "What status code on validation failure — 400 or 422?"`,
    ``,
    `INVALID (do NOT include — these are decisions, not questions):`,
    `- "I picked port 8080, flag if you'd rather use a different port."`,
    `- "Assumed JSON response, confirm if not."`,
    `- "Didn't add tests, want me to fold them in?"`,
    `  ↑ Each of these is a decision you already made. Decisions go in the plan body. Questions go here.`,
    ``,
    `Default to ASKING. Emit \`_none._\` on its own line ONLY when every architectural choice is either explicit in the issue OR fully determined by the codebase${ctx.prePlanDiscovery ? " (per the Discovery findings above)" : ""}. Never omit this section.`,
    ``,
    // NOTE: do NOT emit a "Files written" / paths bullet list here. The
    // runner appends a "📂 Plan files" section after your text that
    // embeds each artefact's full content in a collapsible block — your
    // raw paths would be redundant (and unhelpful, since users can't
    // click them). Keep the response focused on the plan summary +
    // verification checklist.
    `### Verification`,
    `- [ ] {check 1}`,
    `- [ ] {check 2}`,
    ``,
    `</details>`,
    ``,
    // No "Optional additions" / scope-creep suggestions. The plan is
    // what it is; reviewers don't want an open-ended list of things
    // we COULD have done but aren't doing — it dilutes the focused
    // ask and reads as indecisive. If something genuinely belongs in
    // a follow-up issue, the user will surface it themselves.
    `End with EXACTLY: \`Any changes before implementation?\``,
  ];
}

function buildImplementBrief(ctx: ActionContext): string[] {
  // The runner has already resolved the orchestration for this issue and
  // refuses to spawn implement when no matching plan exists, so we can
  // address the plan paths explicitly rather than telling the agent to
  // "find the plan" (which previously led it to stale state.yaml entries).
  const orch = ctx.orchestration;
  const planPathLines: string[] = orch
    ? [
        `Execute the three-tier plan for issue #${ctx.issueNumber}. The runner already located it for you — do NOT search for a different plan:`,
        ``,
        `- ORCHESTRATION: \`${orch.orchestrationPath}\``,
        ...(orch.specPath ? [`- SPEC: \`${orch.specPath}\``] : []),
        ...orch.slices.map((s, i) => `- TASK ${i + 1} (\`${s.agentType}\`): \`${s.slicePath}\``),
        ``,
        `1. Read the SPEC for requirements + acceptance criteria.`,
        `2. Read the ORCHESTRATION's frontmatter and Tasks manifest table.`,
        `3. Read each per-agent slice (TASK file) above in dependency order.`,
      ]
    : [
        // Safety fallback — should never fire because the runner gates on
        // `findActiveOrchestration` returning a non-null result before
        // spawning implement. Kept for robustness if a future caller forgets.
        `Execute the three-tier plan in \`.software-teams/plans/\`:`,
        `1. Find the active plan via the most recent \`*.orchestration.md\` whose frontmatter \`issue:\` field matches #${ctx.issueNumber}. Do NOT fall back to the most-recent file by mtime — only the issue-tagged orchestration is valid.`,
        `2. Read the SPEC (\`*.spec.md\`) for requirements + acceptance criteria.`,
        `3. Read the ORCHESTRATION's \`task_files:\` frontmatter, then read each per-agent slice (\`*.T{n}.md\`) in dependency order.`,
      ];
  return [
    `## Implementation Task`,
    ...planPathLines,
    `4. Implement each task directly via Edit/Write — do NOT modify \`.software-teams/\` or \`.claude/\`. (You don't have the Task tool — execute every slice in this single context.)`,
    `5. Update \`state.yaml\` \`current_plan.completed_tasks\` as you finish each task.`,
    ``,
    `Stage source files only and commit with a conventional message. See the auto-commit block below for branch + push instructions.`,
    ``,
    `## Response Format (MANDATORY)`,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Implementation Agent** implemented the plan for issue #${ctx.issueNumber}.`,
    ``,
    `Then a 1-2 sentence summary of what changed. The auto-commit block below dictates how the response ends (PR proposal scaffold for issue-context runs, summary line for PR-context runs).`,
  ];
}

function buildQuickBrief(ctx: ActionContext): string[] {
  return [
    `## Quick-Change Task`,
    `Make the smallest possible change that satisfies the user request below. Do NOT create plan files. Keep the change focused.`,
    `Stage source files only and commit with a conventional message. See the auto-commit block below for branch + push instructions.`,
    ``,
    `## Response Format (MANDATORY)`,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Implementation Agent** applied a quick change for issue #${ctx.issueNumber}.`,
    ``,
    `Then a 1-2 sentence summary of what changed. The auto-commit block below dictates how the response ends.`,
  ];
}

function buildReviewBrief(ctx: ActionContext): string[] {
  return [
    `## Review Task`,
    `Review the current PR (#${ctx.issueNumber} on ${ctx.repo}). Post line-level review comments via \`gh api repos/${ctx.repo}/pulls/${ctx.issueNumber}/comments\` covering correctness, security, performance, and readability. Use any PRReview component loaded into your spec if available.`,
    `Do NOT modify source files. Do NOT push commits. Review only.`,
    ``,
    `## Response Format (MANDATORY)`,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Review Agent** reviewed PR #${ctx.issueNumber}.`,
    ``,
    `Then a 1-sentence verdict (approve / request changes / comment only), then a bulleted list of the highest-impact findings. End with "Posted N review comments."`,
  ];
}

function buildFeedbackBrief(ctx: ActionContext): string[] {
  return [
    `## PR Feedback Task`,
    `Address every unresolved review comment on PR #${ctx.issueNumber}. For each:`,
    `1. Fetch via \`gh api repos/${ctx.repo}/pulls/${ctx.issueNumber}/comments\` (ignore replies — entries where \`in_reply_to_id\` is set).`,
    `2. Make the requested change in code.`,
    `3. Reply to the original comment confirming what you changed.`,
    ``,
    `Commit + push on the existing PR branch when done. See the auto-commit block below for push semantics.`,
    ``,
    `## Response Format (MANDATORY)`,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Feedback Agent** addressed PR review comments on #${ctx.issueNumber}.`,
    ``,
    `Then a bulleted list of (comment author → what was changed). End with "Pushed to PR branch."`,
  ];
}

function buildPostImplBrief(ctx: ActionContext): string[] {
  return [
    `## Post-Implementation Iteration`,
    `The user is iterating on already-shipped code on PR #${ctx.issueNumber}. The conversation history above includes the originating issue (plan, approval) and any prior PR comments — use it to understand what was built before changing anything.`,
    ``,
    `If the user asked a question, answer it first. If they requested a change, apply it incrementally — do NOT rewrite from scratch.`,
    `Commit + push on the existing PR branch only when there are actual code changes. See the auto-commit block below for push semantics.`,
    ``,
    `## Response Format (MANDATORY)`,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Feedback Agent** updated PR #${ctx.issueNumber}.`,
    ``,
    `Then a 1-2 sentence summary of what changed, or "No changes — answered the question." if the request was a question. If you committed, end with "Pushed to PR branch."`,
  ];
}

function buildPrePlanDiscoveryBrief(ctx: ActionContext): string[] {
  return [
    `## Pre-Plan Discovery (read-only)`,
    `You are the Research Agent. Before the Planning Agent produces a plan for issue #${ctx.issueNumber}, your job is to explore the workspace and surface what the planner cannot learn from the issue text alone. You also engage conversationally with the user when they push back or ask questions about your prior comment. Outputs:`,
    ``,
    `1. **Direct responses to the user's previous comment** — when the conversation history shows the user asked a question, pushed back on your prior reasoning, or requested investigation (e.g. "why customer-portal, not nodifi-portal?", "why has this only now become a problem?", "investigate how this is reached"). ANSWER THEM. Do the actual investigation — \`git log\` for "when/why did this change", \`grep\` + reads for "where is X reached from", \`git blame\` for "who/why added this". Reply in plain prose with concrete file paths, line numbers, and commit hashes as evidence. If you were wrong in a prior pass, say so explicitly: "You're right — I previously fingered X; the actual cause is Y because <evidence>."`,
    `2. **Relevant codebase context** — existing conventions the plan should respect:`,
    `   - File layout for similar work (where do routes / APIs / pages / services live?)`,
    `   - Framework choices, language versions, build/test tooling, router version`,
    `   - Existing helpers, fixtures, env-config patterns the plan should reuse`,
    `   - Monorepo / workspace shape — which app should the change live in?`,
    `3. **Genuine pre-plan questions** — decisions the planner cannot make alone:`,
    `   - File locations not yet established in the codebase`,
    `   - API contracts (field names, status codes, error shape) the issue is silent on`,
    `   - Routing patterns, UX flows, env / secret requirements`,
    `   - Anything where multiple defensible answers exist AND the issue doesn't pick one`,
    `   Do NOT list questions for things the codebase already answers. The goal is to bring back ONLY what genuinely needs a human in the loop.`,
    ``,
    `## Investigating a bug or runtime error`,
    ``,
    `When the issue describes a runtime error, unexpected behaviour, or a "X stopped working / why is Y happening" report (rather than a new-feature request), your job is root-cause investigation. The three rules below apply in order — A before B before C.`,
    ``,
    `### A. URL → app/workspace mapping (when the issue carries a production URL)`,
    ``,
    `If the issue text or any prior comment includes a production URL, error-tracking link, or domain, identify which app/workspace/service in the monorepo serves that URL BEFORE grepping for code. Anchoring on the first app where you find a matching code pattern is a frequent pitfall — the app you grep into first is rarely the one that owns the URL, and confirmation bias does the rest. Check, in priority order:`,
    ``,
    `- Per-app \`package.json\` (\`name\`, \`homepage\` fields)`,
    `- Deployment manifests anywhere in the repo — grep the domain across \`vercel.json\`, \`netlify.toml\`, \`*.tf\`, \`k8s/**\`, \`Caddyfile\`, \`nginx.conf\`, \`docker-compose*.yml\`, \`Procfile\`, \`fly.toml\`, \`render.yaml\`, \`app.yaml\``,
    `- Per-app \`README.md\` / \`DEPLOYMENT.md\``,
    `- Monorepo root config (\`turbo.json\`, \`nx.json\`, \`pnpm-workspace.yaml\`, \`lerna.json\`, root \`README.md\`)`,
    ``,
    `If those sources do NOT yield a confident URL → app mapping, do NOT guess from the URL path alone. Surface it as a \`### Pre-plan questions\` item ("Which app/workspace owns \`<URL>\`? I couldn't confidently map it from the repo's deployment config.") and stop the investigation there until the user confirms.`,
    ``,
    `### B. Simplest hypothesis first`,
    ``,
    `For "missing X" / "X not found" / "X is undefined" errors (missing provider, missing env var, missing config entry, undefined function, undefined property, undefined hook return), generate hypotheses in order of cost-to-test and rule out cheap ones before proposing expensive ones:`,
    ``,
    `1. **Cheap — X is genuinely not present in the failing app/module.** Read the app's entrypoint (\`App.tsx\`, \`main.tsx\`, \`index.tsx\`, \`_app.tsx\`, root layout file, \`server.ts\`, top-level module). If X isn't mounted/declared there, that's the answer — full stop.`,
    `2. **Medium — X is present but not in the right scope.** Trace the route / module / dependency hierarchy from the failure site upward. The provider/declaration may exist but not wrap the failing path.`,
    `3. **Expensive — X is in scope but the consumer reads a different instance** (dual-bundle, dedupe gap, peer-dep duplication, SSR/CSR mismatch, version skew, native module mismatch).`,
    ``,
    `Sophisticated theories sometimes hold but are easy to confirmation-bias toward, especially when symptoms match a pattern you've seen before. Do NOT propose a level-3 hypothesis until level 1 has been ruled out by actually reading the failing app's entrypoint and confirming X is mounted there. "Plausible-sounding theory + symptoms that match the theory + no read of the file that would disprove it" is the classic wrong-diagnosis recipe.`,
    ``,
    `### C. Diagnostic depth`,
    ``,
    `Once the failing site is located AND you've worked through A and B:`,
    ``,
    `- \`git log -p <file>\` + \`git blame <line>\` on the failing site — what recently changed there? Recent commits frequently ARE the cause; pin the breaking commit hash when possible.`,
    `- When the error shape suggests build / bundler / dependency issues (context-identity mismatches, "X is not a function" after a hot reload, ESM/CJS interop, duplicate singletons, hooks-rules violations at runtime only), read the consumer's bundler config (\`vite.config.*\`, \`webpack.config.*\`, \`next.config.*\`, \`rollup.config.*\`, \`esbuild.config.*\`, \`tsconfig.json\`) AND any cross-package import's \`package.json\` for \`dependencies\` vs \`peerDependencies\`.`,
    `- "Likely", "probably", "may", "appears to", "could be" are hypothesis smells. If one shows up in your draft findings, find the specific file that would prove or disprove it and read THAT file before finalising. Speculation in pre-plan findings produces wrong plans downstream.`,
    `- List fix options that span the cause hierarchy: a fix at the source (where the bug originated), a fix at the consumer (config-level), a workaround at the call site. Don't stop at "rewrite the failing file" if the durable fix lives upstream.`,
    ``,
    `## Scope rules (strict)`,
    ``,
    `- READ-ONLY. Do NOT use Edit, Write, MultiEdit. Do NOT run \`git commit\`, \`git push\`, or any state-changing shell command.`,
    `- Budget: at most ~20 file reads + a handful of \`Glob\` / \`Grep\` passes on a fresh feature issue. Raise the budget to ~35 reads + unlimited \`git log\` / \`git blame\` / grep passes when EITHER (a) the issue is a bug / runtime error / unexpected-behaviour report requiring root-cause investigation, OR (b) you have a previous-comment answer to produce. A thin answer with no evidence is worse than no answer; a "likely / probably" diagnosis is worse than a verified one.`,
    `- \`Bash\` is allowed only for read-only inspection (\`git log\`, \`git diff\`, \`git blame\`, \`ls\`, \`cat\`).`,
    `- Keep your final response ≤ 80 lines on a fresh feature issue, ≤ 180 lines on a bug-investigation or conversational pass (root-cause analysis + fix-hierarchy options eat budget — that's fine, that's what they're for).`,
    ``,
    `## Response Format (MANDATORY)`,
    ``,
    `Begin with EXACTLY this line:`,
    ``,
    `**The Research Agent** completed pre-plan discovery for issue #${ctx.issueNumber}.`,
    ``,
    `Then a one-sentence summary of the project's relevant shape (e.g. "Monorepo with apps/test-jedi as the only React app; no API service yet."). On a conversational pass the summary should reflect the user's latest framing, not your stale prior framing.`,
    ``,
    `### Answers to your previous comment`,
    ``,
    `**Include this section ONLY when the conversation history shows the user's most recent message asked a question, pushed back on prior reasoning, or requested investigation. Omit the section entirely otherwise — first pass on an issue, or a user comment that only answers your prior questions, has nothing to answer back.**`,
    ``,
    `When you do include it: answer each thing the user raised in plain prose (paragraphs are fine, not just bullets). Cite concrete evidence — file paths with line numbers, commit hashes from \`git log\`, grep counts. If your prior pass was wrong, acknowledge it explicitly: "You were right that …; my prior pass got it wrong because …". Do NOT pad with restating what the user said — go straight to the answer and the evidence.`,
    ``,
    `### Codebase context`,
    ``,
    `- <observation 1, with concrete file paths>`,
    `- <observation 2>`,
    `- ...`,
    ``,
    `On a conversational pass: refresh this section to reflect the user's framing (e.g. if they pointed you at a different app, the bullets should now describe THAT app's layout, not the one you previously scoped to).`,
    ``,
    `### Pre-plan questions`,
    ``,
    `Bullet each genuine open question. If the codebase fully answers everything and there is nothing left for a human to decide, emit \`_none._\` on its own line — never omit this section. Do NOT pad with rhetorical or confirmatory questions.`,
    ``,
    `IMPORTANT: read the conversation history above before listing questions. If the user has already answered some questions in a prior comment, do NOT re-ask them — surface only what remains genuinely open. When ALL prior questions are answered AND the codebase determines the rest, emit \`_none._\`.`,
    ``,
    `- <question 1>`,
    `- <question 2>`,
  ];
}

/**
 * Build the parent-Claude prompt for the GitHub Action.
 *
 * Two shapes:
 *  - **Single-spawn router** (default): parent spawns one specialist via Task
 *    and echoes its result verbatim. Used by plan / quick / review /
 *    feedback / post-impl-iteration and by implement on plans with 0–1
 *    per-agent slices.
 *  - **Multi-spawn orchestrator**: only for `implement` flow when the
 *    workspace has a three-tier plan with ≥2 per-agent slices. The parent
 *    spawns one Task per slice in parallel, collects each spawn's
 *    structured `commits_pending` block, runs the commits sequentially,
 *    pushes once, and produces a per-agent attribution header.
 */
export function buildRouterPrompt(ctx: ActionContext): string {
  if (
    ctx.flow.kind === "implement" &&
    ctx.orchestration &&
    ctx.orchestration.slices.length >= 2
  ) {
    return buildOrchestratorPrompt(ctx);
  }

  const subagent = pickSubagent(ctx.flow);
  const brief = buildSubagentBrief(ctx);

  return [
    `# Software Teams Action Router`,
    ``,
    `You are the parent process for a GitHub Actions run. Your ONLY job is:`,
    ``,
    `1. Call the \`Task\` tool exactly once with:`,
    `   - \`subagent_type: "${subagent.type}"\``,
    `   - \`description: "${subagent.description}"\``,
    `   - \`prompt:\` the brief below`,
    `2. When the Task returns, output its final text VERBATIM as your response.`,
    ``,
    `Do NOT call any other tools first. Do NOT add your own commentary, headers, or summaries — the specialist's response is the response. Do NOT spawn multiple Task calls; pick one specialist and trust it.`,
    ``,
    `## Subagent brief`,
    ``,
    brief,
  ].join("\n");
}

/**
 * Build a per-slice brief for one Task spawn inside the multi-spawn
 * orchestrator. Embedded inline in the parent's router prompt — each
 * spawn receives this text as its `prompt:` argument when the parent
 * calls Task.
 */
function buildPerSliceBrief(ctx: ActionContext, slice: { slicePath: string; agentType: string }, sliceIndex: number): string {
  const orch = ctx.orchestration!;
  const lines: string[] = [];
  lines.push(`TASK_FILE: ${slice.slicePath}`);
  if (orch.specPath) lines.push(`SPEC: ${orch.specPath}`);
  lines.push(`ORCHESTRATION: ${orch.orchestrationPath}`);
  lines.push(`ISSUE: #${ctx.issueNumber}`);
  lines.push(`REPO: ${ctx.repo}`);
  lines.push(``);
  lines.push(`You are slice ${sliceIndex + 1} of ${orch.slices.length}. Read your TASK_FILE for the objective, steps, verification, done_when, and \`agent_rationale\`.`);
  if (orch.specPath) lines.push(`Read the SPEC for shared requirements + acceptance criteria.`);
  lines.push(`Read the ORCHESTRATION's Tasks manifest only — do NOT read sibling slices (other \`.T{n}.md\` files).`);
  lines.push(``);
  lines.push(`Implement via Edit / Write. Do NOT modify \`.software-teams/\` or \`.claude/\`. Do NOT run \`git commit\` or \`git push\` — the orchestrator (your parent) handles all commits + the push after every spawn returns.`);
  lines.push(``);
  lines.push(`Return EXACTLY this YAML block at the end of your response (no surrounding prose):`);
  lines.push("```yaml");
  lines.push(`files_modified: [<workspace-relative path>, ...]`);
  lines.push(`files_created: [<workspace-relative path>, ...]`);
  lines.push(`commits_pending:`);
  lines.push(`  - subject: "<type>(<scope>): <imperative subject>"`);
  lines.push(`    body: "<one short paragraph; do NOT include 'Closes #N' — the orchestrator appends it>"`);
  lines.push(`    files: [<workspace-relative path>, ...]`);
  lines.push(`summary: "<one sentence — what changed and why>"`);
  lines.push("```");
  lines.push(``);
  lines.push(`If you genuinely cannot complete your slice (missing dependency, ambiguity, etc.), return \`status: blocked\` plus a brief \`blocker:\` field and skip \`commits_pending\`. The orchestrator will surface your blocker in the final response without aborting other spawns.`);
  return lines.join("\n");
}

function buildOrchestratorPrompt(ctx: ActionContext): string {
  const orch = ctx.orchestration!;
  const fb = ctx.featureBranch;
  // CRITICAL: use the `compare/<default>...<branch>` URL form, NOT
  // `pull/new/<branch>`. Only the compare form honours `?title=` /
  // `?body=` query params (per GitHub docs); `pull/new/` silently
  // discards them.
  const prCompareUrl = fb
    ? `https://github.com/${ctx.repo}/compare/${fb.defaultBranch}...${fb.branchName}`
    : "";

  const sliceBlocks = orch.slices.map((slice, i) => {
    const briefText = buildPerSliceBrief(ctx, slice, i);
    return [
      `### Spawn ${i + 1}: \`${slice.agentType}\` — \`${slice.slicePath}\``,
      ``,
      `Task tool call:`,
      "```",
      `Task(`,
      `  subagent_type: "${slice.agentType}",`,
      `  description: "Implement ${slice.slicePath.split("/").pop()}",`,
      `  prompt: <<<EOF`,
      briefText,
      `EOF`,
      `)`,
      "```",
    ].join("\n");
  });

  const attributionTemplate = orch.slices
    .map((s) => `- **${agentTypeToRoleLabel(s.agentType)}** changed \`<comma-separated files_modified + files_created from this spawn>\``)
    .join("\n");

  const finalBlock: string[] = [];
  if (fb) {
    finalBlock.push(``);
    finalBlock.push(`## Step 3 — End your response with the PR proposal block`);
    finalBlock.push(``);
    // The encoding rules below are INSTRUCTIONS for building the
    // `[Open this PR]` link — do NOT emit them as a heading or quoted
    // block in the response. The user-facing output ends with the
    // `## PR proposal` block + the link only.
    finalBlock.push(`**How to build the [Open this PR] link below — internal rules, do NOT emit these as a heading or quote block in your response:**`);
    finalBlock.push(``);
    finalBlock.push(`- **Title** — choose ONE umbrella conventional-commit title that summarises the combined change across all spawns: \`<type>: <subject>\` where type is \`feat\` / \`fix\` / \`chore\` / \`refactor\` / \`docs\` / \`test\` / \`perf\` / \`style\`. Example: \`feat: hardcoded /stats endpoint + frontend route\`.`);
    finalBlock.push(`- **Body** — MUST start with \`Closes #${ctx.issueNumber}\` on its own line, followed by a blank line, followed by your combined summary (or the FILLED PR template if one was detected). The \`Closes\` keyword is what GitHub uses to wire the Issue ↔ PR "Development" link.`);
    finalBlock.push(`- **URL** — MUST be the \`compare/\` form with \`?expand=1\` (NOT \`pull/new/...\` — GitHub drops query params on that one): \`${prCompareUrl}?expand=1&title=<encoded-title>&body=<encoded-body>\`.`);
    finalBlock.push(`- **URL-encode** both params. space→\`%20\`, newline→\`%0A\` (blank line→\`%0A%0A\`), colon→\`%3A\`, hash→\`%23\` (so \`#${ctx.issueNumber}\` → \`%23${ctx.issueNumber}\`), slash→\`%2F\`.`);
    finalBlock.push(`- **Worked example** (for your reference only, do not echo): title \`feat: render Nav across all routes\` encodes to \`feat%3A%20render%20Nav%20across%20all%20routes\`; body \`Closes #${ctx.issueNumber}\\n\\nSummary.\` encodes to \`Closes%20%23${ctx.issueNumber}%0A%0ASummary.\`.`);
    finalBlock.push(`- **Never** include "Software Teams" in the title or body — the brand is intentionally hidden from end users.`);
    finalBlock.push(``);
    finalBlock.push(`Emit EXACTLY this block as the end of your response (no further text after the link):`);
    finalBlock.push(``);
    finalBlock.push(`## PR proposal`);
    finalBlock.push(``);
    finalBlock.push(`**Title:** \`<your conventional-commit title — same one you encoded into the URL>\``);
    finalBlock.push(`**Branch:** \`${fb.branchName}\``);
    finalBlock.push(`**Closes:** #${ctx.issueNumber}`);
    finalBlock.push(``);
    if (ctx.prTemplate) {
      finalBlock.push(`<the FILLED PR template — preserve its section headings, replace every \`<!-- … -->\` placeholder hint with implementation details drawn from the spawn summaries. The repo's PR template is below, between the fences:>`);
      finalBlock.push("");
      // Same conciseness rules as the single-spawn brief — see fragment.
      finalBlock.push(prTemplateConcisenessFragment.trim());
      finalBlock.push("");
      finalBlock.push("```markdown");
      finalBlock.push(ctx.prTemplate.body.trim());
      finalBlock.push("```");
    } else {
      finalBlock.push(`<one short paragraph summary of the combined change across all spawns>`);
    }
    finalBlock.push(``);
    finalBlock.push(`[Open this PR](${prCompareUrl}?expand=1&title=<url-encoded-title>&body=<url-encoded-body-starting-with-Closes-${ctx.issueNumber}>)`);
  } else {
    finalBlock.push(`End with "Pushed to PR branch."`);
  }

  return [
    `# Software Teams Action — Implementation Orchestrator`,
    ``,
    `You are the parent process for a GitHub Actions implementation run. This plan has **${orch.slices.length} per-agent slices** that you MUST dispatch in parallel. You ARE the orchestrator — the agents you spawn are workers without the Task tool; they cannot delegate further.`,
    ``,
    `## Context`,
    ``,
    ...ctx.projectLines,
    ``,
    ...ctx.workspaceLines,
    ``,
    ...(ctx.rulesBlock.length > 0 ? [...ctx.rulesBlock, ``] : []),
    ctx.conversationHistory
      ? fenceUserInput("conversation-history", ctx.conversationHistory)
      : `<conversation-history>\n(none)\n</conversation-history>`,
    ``,
    selfReferenceStyleFragment.trim(),
    ``,
    `## User Request`,
    fenceUserInput("user-request", ctx.userRequest),
    ``,
    `## Step 1 — Spawn ALL ${orch.slices.length} tasks in a SINGLE assistant message`,
    ``,
    `Multiple Task tool calls inside one assistant message run **concurrently**. Sequential messages do NOT — they serialise. You MUST emit all ${orch.slices.length} Task calls below in ONE message:`,
    ``,
    ...sliceBlocks,
    ``,
    `## Step 2 — After all spawns return: commit + push`,
    ``,
    `Each spawn returns a YAML block with \`files_modified\`, \`files_created\`, and \`commits_pending\`. Process them in spawn order (spawn 1 first, then 2, ...):`,
    ``,
    `For each entry in a spawn's \`commits_pending\`:`,
    `1. \`git add <files from this entry>\``,
    `2. \`git commit\` using multiple \`-m\` flags so the body contains \`Closes #${ctx.issueNumber}\`. Example:`,
    fb
      ? `   \`git commit -m "<subject>" -m "Closes #${ctx.issueNumber}" -m "<body>"\``
      : `   \`git commit -m "<subject>" -m "<body>"\``,
    ``,
    `After all commits across all spawns are made, push once:`,
    fb
      ? `\`git push -u origin ${fb.branchName}\``
      : `\`git push\``,
    ``,
    `If a spawn returned \`status: blocked\`, skip its commit block but include its blocker in the final response. Never abort the whole run because one spawn failed — push what succeeded.`,
    ``,
    `## Step 3 — Format the final response (MANDATORY shape)`,
    ``,
    `Begin with EXACTLY this opener line followed by the per-spawn attribution bullets:`,
    ``,
    `**The Implementation Agent** orchestrated ${orch.slices.length} per-agent spawns for issue #${ctx.issueNumber}.`,
    ``,
    attributionTemplate,
    ``,
    `Then a 1–2 sentence overall summary that ties the spawns together.`,
    ``,
    `If any spawn was blocked, add an \`### Open items\` section listing each blocker by its user-facing agent role.`,
    ...finalBlock,
    ``,
    `## Non-negotiables`,
    `- NEVER run \`gh pr create\`, \`gh pr merge\`, or any PR-creating/merging command — a human opens the PR.`,
    fb
      ? `- NEVER push to \`${fb.defaultBranch}\` directly. NEVER force-push.`
      : `- NEVER force-push. NEVER push to a different branch.`,
    `- NEVER commit \`.software-teams/\` or \`.claude/\` paths.`,
    `- NEVER emit the internal subagent identifiers (\`software-teams-*\`) in your final response — use role labels.`,
  ].join("\n");
}
