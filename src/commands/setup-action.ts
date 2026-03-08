import { defineCommand } from "citty";
import { consola } from "consola";
import { join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";

export const setupActionCommand = defineCommand({
  meta: {
    name: "setup-action",
    description: "Set up the Jedi GitHub Action in your repository",
  },
  args: {},
  async run() {
    const cwd = process.cwd();

    // Copy workflow template
    const workflowDest = join(cwd, ".github", "workflows", "jedi.yml");
    if (existsSync(workflowDest)) {
      consola.warn(`Workflow already exists at ${workflowDest}`);
      consola.info("Skipping workflow copy. Delete it manually to regenerate.");
    } else {
      const templatePath = join(import.meta.dir, "../../action/workflow-template.yml");
      if (!existsSync(templatePath)) {
        consola.error("Workflow template not found. Ensure @benzotti/jedi is properly installed.");
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
        "Jedi GitHub Action Setup",
        "",
        "Uses: anthropics/claude-code-action@v1",
        "Trigger: @jedi in issue/PR comments",
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
        "  @jedi plan <description>",
        "  @jedi quick <small fix>",
        "  @jedi do <clickup-ticket-url>",
        "  @jedi review",
        "  @jedi feedback",
        "",
        "Conversation: Reply to Jedi with feedback to iterate,",
        "or say 'approved' to finalise.",
      ].join("\n"),
    );
  },
});
