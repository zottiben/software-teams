import { join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import type { ProjectType } from "./detect-project";

export async function copyFrameworkFiles(
  cwd: string,
  projectType: ProjectType,
  force: boolean
): Promise<void> {
  const frameworkDir = join(import.meta.dir, "../framework");

  // Copy framework files to .jdi/framework/ (agents, components, teams, etc.)
  const frameworkDest = join(cwd, ".jdi", "framework");
  const glob = new Bun.Glob("**/*");
  for await (const file of glob.scan({ cwd: frameworkDir })) {
    // Skip adapters (handled separately) and command stubs (copied to .claude/commands/jdi/)
    if (file.startsWith("adapters/") || file.startsWith("commands/")) continue;

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

  // Write CLAUDE.md routing if not present
  const claudeMdPath = join(cwd, ".claude", "CLAUDE.md");
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

## Iterative Refinement

After \`/jdi:create-plan\` or \`/jdi:implement-plan\` completes, the conversation continues naturally — no new command invocation needed. When the user provides feedback (e.g. "change task 2", "move this to a helper", "add error handling"), apply the changes directly, update state, and present the updated summary. When the user approves (e.g. "approved", "looks good", "lgtm"), finalise the review state. The conversation IS the feedback loop.
`);
    }
  }
}
