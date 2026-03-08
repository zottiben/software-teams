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
    ci: {
      type: "boolean",
      description: "Headless CI mode (no prompts, JSON output)",
      default: false,
    },
    storage: {
      type: "string",
      description: "Storage adapter to configure (default: fs)",
    },
    "storage-path": {
      type: "string",
      description: "Storage base path (default: .jdi/persistence/)",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const projectType = await detectProjectType(cwd);

    if (!args.ci) {
      consola.info(`Detected project type: ${projectType}`);
      consola.start("Initialising JDI...");
    }

    // Create directory structure
    const dirs = [
      ".claude/commands/jdi",
      ".jdi/plans",
      ".jdi/research",
      ".jdi/codebase",
      ".jdi/reviews",
      ".jdi/config",
      ".jdi/persistence",
    ];

    for (const dir of dirs) {
      await Bun.write(join(cwd, dir, ".gitkeep"), "");
    }

    // Copy framework files with adapter resolution
    // In CI mode, never overwrite existing persistence data
    await copyFrameworkFiles(cwd, projectType, args.force);

    // Configure storage in jdi-config.yaml if flags provided
    if (args.storage || args["storage-path"]) {
      const { parse, stringify } = await import("yaml");
      const configPath = join(cwd, ".jdi", "config", "jdi-config.yaml");
      let config: any = {};
      try {
        const existing = await Bun.file(configPath).text();
        config = parse(existing) ?? {};
      } catch { /* file may not exist yet */ }

      config.storage = {
        adapter: args.storage ?? "fs",
        base_path: args["storage-path"] ?? ".jdi/persistence/",
      };

      await Bun.write(configPath, stringify(config));
    }

    if (args.ci) {
      // JSON output for CI consumption
      const result = {
        status: "initialised",
        project_type: projectType,
        cwd,
        storage: {
          adapter: args.storage ?? "fs",
          base_path: args["storage-path"] ?? ".jdi/persistence/",
        },
      };
      console.log(JSON.stringify(result));
    } else {
      consola.success("JDI initialised successfully!");
      consola.info("");
      consola.info("Get started:");
      consola.info("  /jdi:create-plan \"your feature\"");
      consola.info("  /jdi:quick \"small fix\"");
    }
  },
});
