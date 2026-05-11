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

export type ActionFlow =
  | { kind: "plan"; isRefinement?: boolean; isApproval?: boolean }
  | { kind: "implement" }
  | { kind: "quick" }
  | { kind: "review" }
  | { kind: "feedback" }
  | { kind: "post-impl-iteration" };

export interface FeatureBranchContext {
  branchName: string;
  defaultBranch: string;
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
  }
}

function buildSubagentBrief(ctx: ActionContext): string {
  const { flow, repo, issueNumber, userRequest, conversationHistory, featureBranch } = ctx;
  const lines: string[] = [];

  lines.push(`## Context`);
  lines.push(`Repo: ${repo}`);
  lines.push(`Trigger: ${flow.kind === "plan" && flow.isRefinement ? "plan refinement" : flow.kind === "plan" && flow.isApproval ? "plan approved" : flow.kind} on #${issueNumber}`);
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

  // Branch context — only when the runner cut a feature branch upstream
  if (featureBranch && (flow.kind === "implement" || flow.kind === "quick")) {
    lines.push("");
    lines.push(`## Feature Branch (already created by the runner)`);
    lines.push(`- branch: \`${featureBranch.branchName}\``);
    lines.push(`- default: \`${featureBranch.defaultBranch}\``);
    lines.push(`- closes: #${issueNumber}`);
    lines.push(`Commit message body MUST contain \`Closes #${issueNumber}\`. Push with \`git push -u origin ${featureBranch.branchName}\`. Do NOT run \`gh pr create\` — a human opens the PR.`);
    lines.push(`End your response with EXACTLY this block:`);
    lines.push("");
    lines.push(`## PR proposal`);
    lines.push("");
    lines.push(`**Branch:** \`${featureBranch.branchName}\``);
    lines.push(`**Closes:** #${issueNumber}`);
    lines.push("");
    lines.push(`<one short paragraph summary>`);
    lines.push("");
    lines.push(`[Open this PR](https://github.com/${repo}/pull/new/${featureBranch.branchName})`);
  }

  return lines.join("\n");
}

function buildPlanBrief(ctx: ActionContext, flow: { kind: "plan"; isRefinement?: boolean; isApproval?: boolean }): string[] {
  if (flow.isRefinement) {
    return [
      `## Refinement Task`,
      `Read existing plan files under \`.software-teams/plans/\` and update them based on the user's feedback below. Do NOT create new plan files unless the existing ones are missing. Maintain the SPLIT format (index + .T{n}.md task files).`,
      `Do NOT write source code. Do NOT run git commit/push. Plan updates only.`,
      ``,
      `End with a 1-2 sentence summary of what changed plus the updated tasks table, then ask: "Any changes before implementation?"`,
    ];
  }
  if (flow.isApproval) {
    return [
      `## Finalise Plan`,
      `The user approved the plan. Confirm the plan is ready for implementation and return a 1-2 sentence summary plus the tasks table. Do NOT begin implementation in this run.`,
    ];
  }
  return [
    `## Plan Task`,
    `Create a fresh implementation plan in SPLIT format under \`.software-teams/plans/\`:`,
    `1. Index file \`{phase}-{plan}-{slug}.plan.md\` with frontmatter (\`task_files:\`, \`issue: ${ctx.issueNumber}\`, \`repo: ${ctx.repo}\`) and a manifest table only — no inline task details.`,
    `2. One \`{phase}-{plan}-{slug}.T{n}.md\` per task with full implementation detail.`,
    ``,
    `Scope rules:`,
    `- Only plan what was explicitly requested. No bonus testing/linting/CI work unless asked.`,
    `- Use t-shirt sizes (S, M, L) — never time estimates.`,
    `- If ambiguous, ask — do not guess.`,
    ``,
    `End with a 1-2 sentence summary, a collapsible \`<details>\` block containing the tasks table, then ask: "Any changes before implementation?"`,
  ];
}

function buildImplementBrief(_ctx: ActionContext): string[] {
  return [
    `## Implementation Task`,
    `Execute the implementation plan in \`.software-teams/plans/\` (read \`state.yaml\` or the most recent \`*.plan.md\` index). Follow each task file in order; mark progress in state.yaml.`,
    `Apply changes via Edit/Write tools. Do NOT modify \`.software-teams/\` or \`.claude/\`.`,
    `Stage source files only, commit with a conventional message (use multiple \`-m\` flags so the body contains \`Closes #N\` per the Feature Branch block below).`,
  ];
}

function buildQuickBrief(_ctx: ActionContext): string[] {
  return [
    `## Quick-Change Task`,
    `Make the smallest possible change that satisfies the user request below. No plan files. Keep the change focused.`,
    `Stage source files only, commit with a conventional message.`,
  ];
}

function buildReviewBrief(_ctx: ActionContext): string[] {
  return [
    `## Review Task`,
    `Review the current PR. Post line-level review comments via \`gh api repos/.../pulls/{n}/comments\`. End with a brief summary of findings.`,
    `Do NOT modify files or push commits — review only.`,
  ];
}

function buildFeedbackBrief(_ctx: ActionContext): string[] {
  return [
    `## PR Feedback Task`,
    `Address every unresolved PR review comment. Read comments via \`gh api\`, make the requested changes, reply to each comment confirming what you changed. Commit + push when done.`,
  ];
}

function buildPostImplBrief(_ctx: ActionContext): string[] {
  return [
    `## Post-Implementation Iteration`,
    `The user is iterating on already-shipped code on this PR. The conversation history above includes the originating issue (plan, approval) and any prior PR comments — use it to understand what was built before changing anything.`,
    `If the user asked a question, answer it first. If they requested a change, apply it incrementally — do not rewrite from scratch.`,
    `Commit + push on the existing PR branch. NEVER \`gh pr merge\`, force-push, or push to the default branch.`,
  ];
}

/**
 * Build the parent-Claude prompt for the GitHub Action.
 *
 * The parent's job is to spawn the right specialist via the Task tool and
 * echo the specialist's final text as the run's response — nothing else.
 * Every flow yields a prompt with the same shape so the comment-posting
 * code in `run.ts` doesn't need per-flow branches.
 */
export function buildRouterPrompt(ctx: ActionContext): string {
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
