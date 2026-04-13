import { defineCommand } from "citty";
import { consola } from "consola";
import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";
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
      ".jdi/feedback",
    ];

    for (const dir of dirs) {
      await Bun.write(join(cwd, dir, ".gitkeep"), "");
    }

    // Copy framework files with adapter resolution
    // In CI mode, never overwrite existing persistence data
    await copyFrameworkFiles(cwd, projectType, args.force, args.ci);

    // Initialise config files from framework templates
    const configFiles = ["state.yaml", "variables.yaml", "jdi-config.yaml"];
    for (const file of configFiles) {
      const src = join(cwd, ".jdi", "framework", "config", file);
      const dest = join(cwd, ".jdi", "config", file);
      if (existsSync(src) && (args.force || !existsSync(dest))) {
        const content = await Bun.file(src).text();
        await Bun.write(dest, content);
      }
    }

    // Scaffold project templates (only if missing)
    const scaffoldFiles = ["PROJECT.yaml", "REQUIREMENTS.yaml", "ROADMAP.yaml"];
    for (const file of scaffoldFiles) {
      const src = join(cwd, ".jdi", "framework", "templates", file);
      const dest = join(cwd, ".jdi", file);
      if (existsSync(src) && !existsSync(dest)) {
        const content = await Bun.file(src).text();
        await Bun.write(dest, content);
      }
    }

    // Add JDI entries to .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const jdiMarker = "# JDI framework";
    const jdiEntries = [
      "",
      `${jdiMarker} — remove these lines to version control JDI artefacts`,
      ".jdi/",
      ".claude/commands/jdi/",
    ].join("\n");

    let existingGitignore = "";
    if (existsSync(gitignorePath)) {
      existingGitignore = readFileSync(gitignorePath, "utf-8");
    }
    if (!existingGitignore.includes(jdiMarker)) {
      const newContent = existingGitignore
        ? existingGitignore.trimEnd() + "\n" + jdiEntries + "\n"
        : jdiEntries.trimStart() + "\n";
      await Bun.write(gitignorePath, newContent);
    }

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
