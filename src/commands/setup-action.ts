import { defineCommand } from "citty";
import { consola } from "consola";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export const setupActionCommand = defineCommand({
  meta: {
    name: "setup-action",
    description: "Set up the Software Teams GitHub Action in your repository",
  },
  args: {},
  async run() {
    const cwd = process.cwd();

    // Copy workflow template
    const workflowDest = join(cwd, ".github", "workflows", "software-teams.yml");
    if (existsSync(workflowDest)) {
      consola.warn(`Workflow already exists at ${workflowDest}`);
      consola.info("Skipping workflow copy. Delete it manually to regenerate.");
    } else {
      // import.meta.dir resolves to dist/ after bundling, so go up one level
      const templatePath = join(import.meta.dir, "../action/workflow-template.yml");
      if (!existsSync(templatePath)) {
        consola.error("Workflow template not found. Ensure @websitelabs/software-teams is properly installed.");
        process.exit(1);
      }

      const dir = dirname(workflowDest);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const template = await Bun.file(templatePath).text();
      await Bun.write(workflowDest, template);
      consola.success(`Created ${workflowDest}`);
    }

    // Print setup instructions
    consola.info("");
    consola.box(
      [
        "AI Assistant GitHub Action Setup",
        "",
        "Trigger: 'Hey AI' in issue/PR comments",
        "",
        "Required secrets (set via GitHub UI or CLI):",
        "",
        "  gh secret set ANTHROPIC_API_KEY --body '<your-key>'",
        "",
        "Optional secrets:",
        "",
        "  gh secret set CLICKUP_API_TOKEN --body '<your-token>'",
        "",
        "Usage: Comment on any issue or PR with:",
        "",
        "  Hey AI plan <description>",
        "  Hey AI quick <small fix>",
        "  Hey AI do <clickup-ticket-url>",
        "  Hey AI review",
        "  Hey AI feedback",
        "  Hey AI ping",
        "",
        "Conversation: Reply to the assistant with feedback to iterate,",
        "or say 'approved' to finalise.",
      ].join("\n"),
    );
  },
});
