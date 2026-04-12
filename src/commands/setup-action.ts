import { defineCommand } from "citty";
import { consola } from "consola";
import { join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";

export const setupActionCommand = defineCommand({
  meta: {
    name: "setup-action",
    description: "Set up the JDI GitHub Action in your repository",
  },
  args: {},
  async run() {
    const cwd = process.cwd();

    // Copy workflow template
    const workflowDest = join(cwd, ".github", "workflows", "jdi.yml");
    if (existsSync(workflowDest)) {
      consola.warn(`Workflow already exists at ${workflowDest}`);
      consola.info("Skipping workflow copy. Delete it manually to regenerate.");
    } else {
      // import.meta.dir resolves to dist/ after bundling, so go up one level
      const templatePath = join(import.meta.dir, "../action/workflow-template.yml");
      if (!existsSync(templatePath)) {
        consola.error("Workflow template not found. Ensure @benzotti/jdi is properly installed.");
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
        "JDI GitHub Action Setup",
        "",
        "Uses: JDI CLI via Claude Code",
        "Trigger: 'Hey jdi' in issue/PR comments",
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
        "  Hey jdi plan <description>",
        "  Hey jdi quick <small fix>",
        "  Hey jdi do <clickup-ticket-url>",
        "  Hey jdi review",
        "  Hey jdi feedback",
        "  Hey jdi ping",
        "",
        "Conversation: Reply to JDI with feedback to iterate,",
        "or say 'approved' to finalise.",
      ].join("\n"),
    );
  },
});
