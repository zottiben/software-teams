import { join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import type { ProjectType } from "./detect-project";

export async function copyFrameworkFiles(
  cwd: string,
  projectType: ProjectType,
  force: boolean,
  ci: boolean = false,
): Promise<void> {
  const frameworkDir = join(import.meta.dir, "../framework");

  // Copy framework files to .jdi/framework/ (agents, components, teams, etc.)
  const frameworkDest = join(cwd, ".jdi", "framework");
  const glob = new Bun.Glob("**/*");
  for await (const file of glob.scan({ cwd: frameworkDir })) {
    // Skip adapters (handled separately)
    if (file.startsWith("adapters/")) continue;

    const src = join(frameworkDir, file);
    const dest = join(frameworkDest, file);

    if (!force && existsSync(dest)) continue;

    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const content = await Bun.file(src).text();
    await Bun.write(dest, content);
  }

  // Copy command stubs to .claude/commands/jdi/
  const commandsDir = join(frameworkDir, "commands");
  const commandsDest = join(cwd, ".claude", "commands", "jdi");
  if (existsSync(commandsDir)) {
    const commandGlob = new Bun.Glob("*.md");
    for await (const file of commandGlob.scan({ cwd: commandsDir })) {
      const src = join(commandsDir, file);
      const dest = join(commandsDest, file);

      if (!force && existsSync(dest)) continue;

      const dir = dirname(dest);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const content = await Bun.file(src).text();
      await Bun.write(dest, content);
    }
  }

  // Apply adapter config for the detected project type
  const adapterPath = join(frameworkDir, "adapters", `${projectType}.yaml`);
  if (existsSync(adapterPath)) {
    const dest = join(cwd, ".jdi", "config", "adapter.yaml");
    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const content = await Bun.file(adapterPath).text();
    await Bun.write(dest, content);
  }

  // Write CLAUDE.md — CI mode gets full framework instructions, local mode gets skill routing
  const claudeMdPath = join(cwd, ".claude", "CLAUDE.md");
  const claudeDir = join(cwd, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  if (ci) {
    // CI mode: full framework instructions for GitHub Action (no skills available)
    await Bun.write(claudeMdPath, `# Jedi AI Development Framework

You are Jedi, an AI development framework that uses specialised agents to plan, implement, review, and ship features.

## Identity

You are **Jedi**, not Claude. Always refer to yourself as "Jedi" in your responses.
Use "Jedi" in summaries and status updates (e.g. "Jedi has completed..." not "Claude has completed...").
Do not add a signature line — the response is already branded by the Jedi CLI.
Never include meta-commentary about agent activation (e.g. "You are now active as jdi-planner" or "Plan created as requested"). Just give the response directly.

## Framework

Read \`.jdi/framework/components/meta/AgentBase.md\` for the base agent protocol.
Your framework files are in \`.jdi/framework/\` — agents, components, learnings, and teams.
Your state is tracked in \`.jdi/config/state.yaml\`.
Plans live in \`.jdi/plans/\`.

## Learnings

IMPORTANT: Always read learnings BEFORE starting any work.
Check \`.jdi/persistence/learnings.md\` for accumulated team learnings and preferences.
Check \`.jdi/framework/learnings/\` for categorised learnings (backend, frontend, testing, devops, general).
These learnings represent the team's coding standards — follow them.
When you learn something new from a review or feedback, update the appropriate learnings file
AND write the consolidated version to \`.jdi/persistence/learnings.md\`.

## Codebase Index

Check \`.jdi/persistence/codebase-index.md\` for an indexed representation of the codebase.
If it exists, use it for faster navigation. If it doesn't, consider generating one
and saving it to \`.jdi/persistence/codebase-index.md\` for future runs.

## Scope Discipline

Only do what was explicitly requested. Do not add extras, tooling, or features the user did not ask for.
If something is ambiguous, ask — do not guess.
NEVER use time estimates (minutes, hours, etc). Use S/M/L t-shirt sizing for all task and plan sizing.
Follow response templates exactly as instructed in the prompt — do not improvise the layout or structure.

## Workflow Routing

Based on the user's request, follow the appropriate workflow:

- **Plan requests** ("plan", "design", or ClickUp ticket URLs): Read \`.jdi/framework/agents/jdi-planner.md\` and create a plan in \`.jdi/plans/\`. Present a summary and ask for feedback.
- **Implementation** ("implement", "build", "execute"): Read the current plan from state.yaml, use \`.jdi/framework/components/meta/ComplexityRouter.md\` to decide single-agent vs teams mode.
- **Quick changes** ("quick", "fix", "small"): Make minimal focused changes. Commit when done.
- **Review** ("review"): Review PR changes using \`.jdi/framework/components/quality/PRReview.md\`.
- **PR feedback** ("feedback"): Address review comments using \`.jdi/framework/agents/jdi-pr-feedback.md\`. Extract learnings from reviewer preferences.
- **"do" + ClickUp URL**: Full flow — plan from ticket, then implement.

## Auto-Commit (CI Mode)

You are running inside a GitHub Action on a PR branch. After implementing or making changes:
1. Stage all changed files with \`git add\` (only files you changed — NOT .jdi/ or .claude/)
2. Commit with a conventional commit message (e.g. "feat: implement X")
3. Push to the current branch with \`git push\`
Do NOT ask the user whether to commit — just do it. The user will review the PR diff directly.

## Iterative Refinement

After completing any workflow, present a summary and ask for feedback.
When the user provides feedback, apply changes incrementally — do not restart from scratch.
When the user approves ("approved", "lgtm", "looks good"), finalise the work — commit and push all outstanding changes.

## ClickUp Integration

If the user provides a ClickUp URL, fetch the ticket details:
\`\`\`bash
curl -s -H "Authorization: $CLICKUP_API_TOKEN" "https://api.clickup.com/api/v2/task/{task_id}"
\`\`\`
Use the ticket name, description, and checklists as requirements.
`);
  } else {
    // Local mode: skill routing for Claude Code CLI
    const routingHeader = "## JDI Workflow Routing";
    if (!existsSync(claudeMdPath)) {
      await Bun.write(claudeMdPath, `${routingHeader}

Recognise natural language JDI intents and invoke the matching skill via the Skill tool. Pass the user's full message as the argument.

- Plan/ticket analysis → \`/jdi:create-plan\`
- Implement/build/execute → \`/jdi:implement-plan\`
- Review PR → \`/jdi:pr-review\`
- Address PR feedback → \`/jdi:pr-feedback\`
- Commit changes → \`/jdi:commit\`
- Generate/create PR → \`/jdi:generate-pr\`
- Quick/small fix → \`/jdi:quick\`

Extract flags from context: "in a worktree" → \`--worktree\`, "lightweight" → \`--worktree-lightweight\`, "single agent" → \`--single\`, "use teams" → \`--team\`. If the intent is unclear, ask. Never guess.

Planning and implementation are separate gates — NEVER auto-proceed to implementation after plan approval.

## Iterative Refinement

After \`/jdi:create-plan\` or \`/jdi:implement-plan\` completes, the conversation continues naturally — no new command invocation needed. When the user provides feedback (e.g. "change task 2", "move this to a helper", "add error handling"), apply the changes directly, update state, and present the updated summary. When the user approves (e.g. "approved", "looks good", "lgtm"), finalise the review state. The conversation IS the feedback loop.
`);
    } else {
      const existing = await Bun.file(claudeMdPath).text();
      if (!existing.includes(routingHeader)) {
        await Bun.write(claudeMdPath, existing + "\n" + `${routingHeader}

Recognise natural language JDI intents and invoke the matching skill via the Skill tool. Pass the user's full message as the argument.

- Plan/ticket analysis → \`/jdi:create-plan\`
- Implement/build/execute → \`/jdi:implement-plan\`
- Review PR → \`/jdi:pr-review\`
- Address PR feedback → \`/jdi:pr-feedback\`
- Commit changes → \`/jdi:commit\`
- Generate/create PR → \`/jdi:generate-pr\`
- Quick/small fix → \`/jdi:quick\`

Extract flags from context: "in a worktree" → \`--worktree\`, "lightweight" → \`--worktree-lightweight\`, "single agent" → \`--single\`, "use teams" → \`--team\`. If the intent is unclear, ask. Never guess.

Planning and implementation are separate gates — NEVER auto-proceed to implementation after plan approval.

## Iterative Refinement

After \`/jdi:create-plan\` or \`/jdi:implement-plan\` completes, the conversation continues naturally — no new command invocation needed. When the user provides feedback (e.g. "change task 2", "move this to a helper", "add error handling"), apply the changes directly, update state, and present the updated summary. When the user approves (e.g. "approved", "looks good", "lgtm"), finalise the review state. The conversation IS the feedback loop.
`);
      }
    }
  }
}
