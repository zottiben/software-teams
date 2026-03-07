import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve, join } from "path";
import { detectProjectType } from "../utils/detect-project";
import { copyFrameworkFiles } from "../utils/copy-framework";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialise JDI in the current project",
  },
  args: {
    force: {
      type: "boolean",
      description: "Overwrite existing files",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const projectType = await detectProjectType(cwd);

    consola.info(`Detected project type: ${projectType}`);
    consola.start("Initialising JDI...");

    // Create directory structure
    const dirs = [
      ".claude/commands/jdi",
      ".jdi/plans",
      ".jdi/research",
      ".jdi/codebase",
      ".jdi/reviews",
      ".jdi/config",
    ];

    for (const dir of dirs) {
      await Bun.write(join(cwd, dir, ".gitkeep"), "");
    }

    // Copy framework files with adapter resolution
    await copyFrameworkFiles(cwd, projectType, args.force);

    consola.success("JDI initialised successfully!");
    consola.info("");
    consola.info("Get started:");
    consola.info("  /jdi:create-plan \"your feature\"");
    consola.info("  /jdi:quick \"small fix\"");
  },
});
