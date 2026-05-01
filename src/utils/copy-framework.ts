import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { ProjectType } from "./detect-project";

/**
 * Subdirectories shipped from the package root into a consumer's
 * `.software-teams/<sub>/` install. Phase B retired the
 * `.software-teams/framework/` mirror and dropped subtrees that have no
 * runtime consumer-side reader (`teams/`, `agents/`, `commands/`). Phase C
 * additionally dropped `hooks/` and `stacks/` once those markdown sources
 * were folded into the TS component registry — agents fetch them via
 * `software-teams component get <Name>` instead of reading a copied .md.
 */
const COPIED_SUBDIRS = ["templates", "learnings", "rules"] as const;

export async function copyFrameworkFiles(
  cwd: string,
  projectType: ProjectType,
  force: boolean,
  ci: boolean = false,
  /**
   * Optional override for the package root. Defaults to the directory two
   * levels above this file (`<package>` when the bundled CLI is shipped via
   * npm). Pass an explicit path in tests so fixtures don't touch real source
   * dirs.
   */
  packageRootOverride?: string,
): Promise<void> {
  // `import.meta.dir` resolves to `<package>/dist/` when running the bundled
  // CLI and `<package>/src/utils/` when running uncompiled. The bundle is
  // one level below the package root; the source file is two levels below.
  // Detect by checking which candidate has package.json.
  const oneUp = join(import.meta.dir, "..");
  const twoUp = join(import.meta.dir, "..", "..");
  const packageRoot =
    packageRootOverride ??
    (existsSync(join(oneUp, "package.json")) ? oneUp : twoUp);
  const consumerRoot = join(cwd, ".software-teams");

  // Copy doctrine subtrees directly to .software-teams/<sub>/ (no framework/
  // wrapper). Phase B target layout.
  for (const sub of COPIED_SUBDIRS) {
    const srcDir = join(packageRoot, sub);
    if (!existsSync(srcDir)) continue;
    const destDir = join(consumerRoot, sub);
    const subGlob = new Bun.Glob("**/*");
    for await (const file of subGlob.scan({ cwd: srcDir })) {
      const src = join(srcDir, file);
      const dest = join(destDir, file);
      if (!force && existsSync(dest)) continue;
      const dir = dirname(dest);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const content = await Bun.file(src).text();
      await Bun.write(dest, content);
    }
  }

  // Note: `.claude/agents/` is intentionally NOT copied here. Native subagent
  // files are generated mechanically from `agents/software-teams-*.md` by
  // `convertAgents()` (invoked from `init` after this step, and standalone
  // via `software-teams sync-agents`).

  // Copy command stubs to .claude/commands/st/ from the plugin commands/ tree.
  const commandsDir = join(packageRoot, "commands");
  const commandsDest = join(cwd, ".claude", "commands", "st");
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
  const settingsTemplate = join(packageRoot, "templates", ".claude", "settings.json");
  if (existsSync(settingsTemplate)) {
    const settingsDest = join(cwd, ".claude", "settings.json");
    const destDir = dirname(settingsDest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    if (force || !existsSync(settingsDest)) {
      const content = await Bun.file(settingsTemplate).text();
      await Bun.write(settingsDest, content);
    }
  }

  // Apply adapter config for the detected project type.
  const adapterPath = join(packageRoot, "adapters", `${projectType}.yaml`);
  if (existsSync(adapterPath)) {
    const dest = join(cwd, ".software-teams", "config", "adapter.yaml");
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
  const sharedTemplatePath = join(packageRoot, "templates", "CLAUDE-SHARED.md");
  const sharedBase = existsSync(sharedTemplatePath)
    ? await Bun.file(sharedTemplatePath).text()
    : "";

  if (ci) {
    const ciSections = `
## Codebase Index

Check \`.software-teams/persistence/codebase-index.md\` for an indexed representation of the codebase.
If it exists, use it for faster navigation. If it doesn't, consider generating one
and saving it to \`.software-teams/persistence/codebase-index.md\` for future runs.

## Workflow Routing

Based on the user's request, follow the appropriate workflow:

- **Plan requests** ("plan", "design", or ClickUp ticket URLs): Read \`.software-teams/framework/agents/software-teams-planner.md\` and create a plan in \`.software-teams/plans/\`. Present a summary and ask for feedback.
- **Implementation** ("implement", "build", "execute"): Read the current plan from state.yaml. Run \`software-teams component get ComplexityRouter\` to decide single-agent vs teams mode.
- **Quick changes** ("quick", "fix", "small"): Make minimal focused changes. Commit when done.
- **Review** ("review"): Run \`software-teams component get PRReview\` for the review checklist; review PR changes against it.
- **PR feedback** ("feedback"): Address review comments using \`.software-teams/framework/agents/software-teams-pr-feedback.md\`. Extract learnings from reviewer preferences.
- **"do" + ClickUp URL**: Full flow — plan from ticket, then implement.

## Auto-Commit (CI Mode)

You are already on the correct PR branch. Do NOT create new branches or switch branches.
After **implementing** changes (NOT after planning or plan refinement):
1. \`git add\` only source files you changed (NOT .software-teams/ or .claude/)
2. \`git commit -m "feat: ..."\` with a conventional commit message
3. \`git push\` (no -u, no origin, no branch name — just \`git push\`)
Plan files (\`.software-teams/plans/\`) are cached separately and should NOT be committed.

## Iterative Refinement

After completing any workflow, present a summary and ask for feedback.
- **Plan refinement feedback** (e.g. "add error handling", "change task 2", "use a different approach"): Update ONLY the plan files in \`.software-teams/plans/\`. Present the updated plan. Ask "Any changes before implementation?" Do NOT implement code.
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
    const routingBlock = `${routingHeader}

For any non-trivial task, delegate to an appropriate specialist agent via the Task tool rather than performing the work yourself. Solo work is acceptable only for:

- Trivial edits (single file, single grep, single shell command).
- Tasks with no matching specialist in \`.software-teams/framework/agents\` or \`.claude/agents/\`.
- Agent/framework orchestration itself (configuring, routing, triage, memory updates).

Match specialists to domain: react → \`software-teams-frontend\` / \`software-teams-programmer\`; php → \`software-teams-backend\` / \`software-teams-programmer\`; research → \`software-teams-researcher\`; QA → \`software-teams-qa-tester\` / \`software-teams-quality\`; etc. The user does NOT want to repeat "use available agents" in every prompt — treat it as default.

### Scope spawn prompts tightly

Spawned agents can be truncated mid-task when briefings are too broad. To prevent it:

- **One concern per invocation.** Bundle unrelated fixes? Run them as parallel agents instead.
- **Split investigation from implementation** when the audit is wide. Agent A finds, agent B fixes with exact file:line targets.
- **Give exact file paths and line numbers**, not open-ended "find all bugs in X" prompts.
- **Cap exploration** — "read at most N files, then act."
- **Ask for short reports (<400 words).** Long formal reports are where truncation bites.
- If an agent is cut off, \`SendMessage({to: agentId})\` resumes them — their edits persist.

## Software Teams Workflow Routing

Recognise natural language Software Teams intents and invoke the matching skill via the Skill tool. Pass the user's full message as the argument.

- Plan/ticket analysis → \`/st:create-plan\`
- Implement/build/execute → \`/st:implement-plan\`
- Review PR → \`/st:pr-review\`
- Address PR feedback → \`/st:pr-feedback\`
- Commit changes → \`/st:commit\`
- Generate/create PR → \`/st:generate-pr\`
- Quick/small fix → \`/st:quick\`

Extract flags from context: "in a worktree" → \`--worktree\`, "lightweight" → \`--worktree-lightweight\`, "single agent" → \`--single\`, "use teams" → \`--team\`. If the intent is unclear, ask. Never guess.

## Planning and Implementation

Per-sub-plan flow (create-plan → implement → commit) from an orchestration plan - full flow (orchestration plan -> implementation plan -> implementation -> commit); resume-cold checklist.

- SDD plan implementation flow.
- Planning and implementation are separate gates — NEVER auto-proceed to implementation after plan approval.

## Iterative Refinement

After \`/st:create-plan\` or \`/st:implement-plan\` completes, the conversation continues naturally — no new command invocation needed. When the user provides feedback (e.g. "change task 2", "move this to a helper", "add error handling"), apply the changes directly, update state, and present the updated summary. When the user approves (e.g. "approved", "looks good", "lgtm"), finalise the review state. The conversation IS the feedback loop.
`;
    if (!existsSync(claudeMdPath)) {
      await Bun.write(claudeMdPath, routingBlock);
    } else {
      const existing = await Bun.file(claudeMdPath).text();
      if (!existing.includes(routingHeader)) {
        await Bun.write(claudeMdPath, existing + "\n" + routingBlock);
      }
    }
  }
}
