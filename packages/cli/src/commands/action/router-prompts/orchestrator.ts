import { fenceUserInput } from "../../../utils/sanitize";
import { agentTypeToRoleLabel } from "../../../utils/orchestration";
import { type ActionContext } from "./types";
import { pickSubagent } from "./types";
import { buildSubagentBrief } from "./brief-builders";
import selfReferenceStyleFragment from "../../../../commands/_shared/self-reference-style.md" with { type: "text" };
import prTemplateConcisenessFragment from "../../../../commands/_shared/pr-template-conciseness.md" with { type: "text" };

function buildPerSliceBrief(ctx: ActionContext, slice: { slicePath: string; agentType: string }, sliceIndex: number): string {
  if (!ctx.orchestration) throw new Error("buildPerSliceBrief called without orchestration context");
  const orch = ctx.orchestration;
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
  if (!ctx.orchestration) throw new Error("buildOrchestratorPrompt called without orchestration context");
  const orch = ctx.orchestration;
  const fb = ctx.featureBranch;
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
