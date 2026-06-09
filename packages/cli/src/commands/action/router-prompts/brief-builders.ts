import { fenceUserInput } from "../../../utils/sanitize";
import { type ActionContext } from "./types";
import { buildPrePlanDiscoveryBrief } from "./discovery-brief";

export { buildPrePlanDiscoveryBrief };

import selfReferenceStyleFragment from "../../../../commands/_shared/self-reference-style.md" with { type: "text" };
import planThreeTierArtifactsFragment from "../../../../commands/_shared/plan-three-tier-artifacts.md" with { type: "text" };
import prTemplateConcisenessFragment from "../../../../commands/_shared/pr-template-conciseness.md" with { type: "text" };

export function buildSubagentBrief(ctx: ActionContext): string {
  const { flow, repo, issueNumber, userRequest, conversationHistory, featureBranch } = ctx;
  const lines: string[] = [];

  lines.push(`## Context`);
  lines.push(`Repo: ${repo}`);
  lines.push(`Trigger: ${flow.kind === "plan" && flow.isRefinement ? "plan refinement" : flow.kind === "plan" && flow.isApproval ? "plan approved" : flow.kind} on #${issueNumber}`);
  lines.push("");

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

  lines.push("");
  lines.push(`## User Request`);
  lines.push(fenceUserInput("user-request", userRequest));

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

    const compareUrlBase = `https://github.com/${repo}/compare/${featureBranch.defaultBranch}...${featureBranch.branchName}`;
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

export function buildPlanBrief(ctx: ActionContext, flow: { kind: "plan"; isRefinement?: boolean; isApproval?: boolean }): string[] {
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
    `### Verification`,
    `- [ ] {check 1}`,
    `- [ ] {check 2}`,
    ``,
    `</details>`,
    ``,
    `End with EXACTLY: \`Any changes before implementation?\``,
  ];
}

export function buildImplementBrief(ctx: ActionContext): string[] {
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

export function buildQuickBrief(ctx: ActionContext): string[] {
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

export function buildReviewBrief(ctx: ActionContext): string[] {
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

export function buildFeedbackBrief(ctx: ActionContext): string[] {
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

export function buildPostImplBrief(ctx: ActionContext): string[] {
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


