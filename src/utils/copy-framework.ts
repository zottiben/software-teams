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

  // Copy the declarative `.claude/settings.json` template into the project root.
  // This defines the scoped tool allowlist for spawned Claude sessions.
  // Do NOT clobber an existing settings.json unless --force was passed.
  const settingsTemplate = join(frameworkDir, "templates", ".claude", "settings.json");
  if (existsSync(settingsTemplate)) {
    const settingsDest = join(cwd, ".claude", "settings.json");
    const destDir = dirname(settingsDest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    if (force || !existsSync(settingsDest)) {
      const content = await Bun.file(settingsTemplate).text();
      await Bun.write(settingsDest, content);
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

  // Read the shared CLAUDE.md base template
  const sharedTemplatePath = join(frameworkDir, "templates", "CLAUDE-SHARED.md");
  const sharedBase = existsSync(sharedTemplatePath)
    ? await Bun.file(sharedTemplatePath).text()
    : "";

  if (ci) {
    // CI mode: shared base + CI-specific sections
    const ciSections = `
## Codebase Index

Check \`.jdi/persistence/codebase-index.md\` for an indexed representation of the codebase.
If it exists, use it for faster navigation. If it doesn't, consider generating one
and saving it to \`.jdi/persistence/codebase-index.md\` for future runs.

## Workflow Routing

Based on the user's request, follow the appropriate workflow:

- **Plan requests** ("plan", "design", or ClickUp ticket URLs): Read \`.jdi/framework/agents/jdi-planner.md\` and create a plan in \`.jdi/plans/\`. Present a summary and ask for feedback.
- **Implementation** ("implement", "build", "execute"): Read the current plan from state.yaml, use \`.jdi/framework/components/meta/ComplexityRouter.md\` to decide single-agent vs teams mode.
- **Quick changes** ("quick", "fix", "small"): Make minimal focused changes. Commit when done.
- **Review** ("review"): Review PR changes using \`.jdi/framework/components/quality/PRReview.md\`.
- **PR feedback** ("feedback"): Address review comments using \`.jdi/framework/agents/jdi-pr-feedback.md\`. Extract learnings from reviewer preferences.
- **"do" + ClickUp URL**: Full flow — plan from ticket, then implement.

## Auto-Commit (CI Mode)

You are already on the correct PR branch. Do NOT create new branches or switch branches.
After **implementing** changes (NOT after planning or plan refinement):
1. \`git add\` only source files you changed (NOT .jdi/ or .claude/)
2. \`git commit -m "feat: ..."\` with a conventional commit message
3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)
Plan files (\`.jdi/plans/\`) are cached separately and should NOT be committed.

## Iterative Refinement

After completing any workflow, present a summary and ask for feedback.
- **Plan refinement feedback** (e.g. "add error handling", "change task 2", "use a different approach"): Update ONLY the plan files in \`.jdi/plans/\`. Present the updated plan. Ask "Any changes before implementation?" Do NOT implement code.
- **Approval** ("approved", "lgtm", "looks good", "ship it"): Mark the plan as approved. Do NOT implement — wait for an explicit "implement" command.
- **Questions** ("why did you...", "what about..."): Answer conversationally first, then take action if needed.

## ClickUp Integration

If the user provides a ClickUp URL, fetch the ticket details:
\`\`\`bash
curl -s -H "Authorization: $CLICKUP_API_TOKEN" "https://api.clickup.com/api/v2/task/{task_id}"
\`\`\`
Use the ticket name, description, and checklists as requirements.
`;
    await Bun.write(claudeMdPath, sharedBase + "\n" + ciSections);
  } else {
    const routingHeader = '## Agent-First Default'
    if (!existsSync(claudeMdPath)) {
      await Bun.write(claudeMdPath, `${routingHeader}

For any non-trivial task, delegate to an appropriate specialist agent via the Task tool rather than performing the work yourself. Solo work is acceptable only for:

- Trivial edits (single file, single grep, single shell command).
- Tasks with no matching specialist in \`.jdi/framework/agents\` or \`.claude/agents/\`.
- Agent/framework orchestration itself (configuring, routing, triage, memory updates).

Match specialists to domain: react → \`jdi-frontend\` / \`jdi-programmer\`; php → \`jdi-backend\` / \`jdi-programmer\`; research → \`jdi-researcher\`; QA → \`jdi-qa-tester\` / \`jdi-quality\`; etc. The user does NOT want to repeat "use available agents" in every prompt — treat it as default.

### Scope spawn prompts tightly

Spawned agents can be truncated mid-task when briefings are too broad. To prevent it:

- **One concern per invocation.** Bundle unrelated fixes? Run them as parallel agents instead.
- **Split investigation from implementation** when the audit is wide. Agent A finds, agent B fixes with exact file:line targets.
- **Give exact file paths and line numbers**, not open-ended "find all bugs in X" prompts.
- **Cap exploration** — "read at most N files, then act."
- **Ask for short reports (<400 words).** Long formal reports are where truncation bites.
- If an agent is cut off, \`SendMessage({to: agentId})\` resumes them — their edits persist.

## JDI Workflow Routing

Recognise natural language JDI intents and invoke the matching skill via the Skill tool. Pass the user's full message as the argument.

- Plan/ticket analysis → \`/jdi:create-plan\`
- Implement/build/execute → \`/jdi:implement-plan\`
- Review PR → \`/jdi:pr-review\`
- Address PR feedback → \`/jdi:pr-feedback\`
- Commit changes → \`/jdi:commit\`
- Generate/create PR → \`/jdi:generate-pr\`
- Quick/small fix → \`/jdi:quick\`

Extract flags from context: "in a worktree" → \`--worktree\`, "lightweight" → \`--worktree-lightweight\`, "single agent" → \`--single\`, "use teams" → \`--team\`. If the intent is unclear, ask. Never guess.

## Planning and Implementation

Per-sub-plan flow (create-plan → implement → commit) from an orchestration plan - full flow (orchestration plan -> implementation plan -> implementation -> commit); resume-cold checklist.

- SDD plan implementation flow.
- Planning and implementation are separate gates — NEVER auto-proceed to implementation after plan approval.

## Iterative Refinement

After \`/jdi:create-plan\` or \`/jdi:implement-plan\` completes, the conversation continues naturally — no new command invocation needed. When the user provides feedback (e.g. "change task 2", "move this to a helper", "add error handling"), apply the changes directly, update state, and present the updated summary. When the user approves (e.g. "approved", "looks good", "lgtm"), finalise the review state. The conversation IS the feedback loop.
`);
    } else {
      const existing = await Bun.file(claudeMdPath).text();
      if (!existing.includes(routingHeader)) {
        await Bun.write(claudeMdPath, existing + "\n" + `${routingHeader}

For any non-trivial task, delegate to an appropriate specialist agent via the Task tool rather than performing the work yourself. Solo work is acceptable only for:

- Trivial edits (single file, single grep, single shell command).
- Tasks with no matching specialist in \`.jdi/framework/agents\` or \`.claude/agents/\`.
- Agent/framework orchestration itself (configuring, routing, triage, memory updates).

Match specialists to domain: react → \`jdi-frontend\` / \`jdi-programmer\`; php → \`jdi-backend\` / \`jdi-programmer\`; research → \`jdi-researcher\`; QA → \`jdi-qa-tester\` / \`jdi-quality\`; etc. The user does NOT want to repeat "use available agents" in every prompt — treat it as default.

### Scope spawn prompts tightly

Spawned agents can be truncated mid-task when briefings are too broad. To prevent it:

- **One concern per invocation.** Bundle unrelated fixes? Run them as parallel agents instead.
- **Split investigation from implementation** when the audit is wide. Agent A finds, agent B fixes with exact file:line targets.
- **Give exact file paths and line numbers**, not open-ended "find all bugs in X" prompts.
- **Cap exploration** — "read at most N files, then act."
- **Ask for short reports (<400 words).** Long formal reports are where truncation bites.
- If an agent is cut off, \`SendMessage({to: agentId})\` resumes them — their edits persist.

## JDI Workflow Routing

Recognise natural language JDI intents and invoke the matching skill via the Skill tool. Pass the user's full message as the argument.

- Plan/ticket analysis → \`/jdi:create-plan\`
- Implement/build/execute → \`/jdi:implement-plan\`
- Review PR → \`/jdi:pr-review\`
- Address PR feedback → \`/jdi:pr-feedback\`
- Commit changes → \`/jdi:commit\`
- Generate/create PR → \`/jdi:generate-pr\`
- Quick/small fix → \`/jdi:quick\`

Extract flags from context: "in a worktree" → \`--worktree\`, "lightweight" → \`--worktree-lightweight\`, "single agent" → \`--single\`, "use teams" → \`--team\`. If the intent is unclear, ask. Never guess.

## Planning and Implementation

Per-sub-plan flow (create-plan → implement → commit) from an orchestration plan - full flow (orchestration plan -> implementation plan -> implementation -> commit); resume-cold checklist.

- SDD plan implementation flow.
- Planning and implementation are separate gates — NEVER auto-proceed to implementation after plan approval.

## Iterative Refinement

After \`/jdi:create-plan\` or \`/jdi:implement-plan\` completes, the conversation continues naturally — no new command invocation needed. When the user provides feedback (e.g. "change task 2", "move this to a helper", "add error handling"), apply the changes directly, update state, and present the updated summary. When the user approves (e.g. "approved", "looks good", "lgtm"), finalise the review state. The conversation IS the feedback loop.
`);
      }
    }
  }
}
