import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { detectProjectType } from "../utils/detect-project";
import { copyFrameworkFiles } from "../utils/copy-framework";
import { convertAgents } from "../utils/convert-agents";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialise Software Teams in the current project",
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
      description: "Storage base path (default: .software-teams/persistence/)",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const projectType = await detectProjectType(cwd);

    if (!args.ci) {
      consola.info(`Detected project type: ${projectType}`);
      consola.start("Initialising Software Teams...");
    }

    // Create directory structure
    const dirs = [
      ".claude/commands/st",
      ".software-teams/plans",
      ".software-teams/research",
      ".software-teams/codebase",
      ".software-teams/reviews",
      ".software-teams/config",
      ".software-teams/persistence",
      ".software-teams/feedback",
    ];

    for (const dir of dirs) {
      await Bun.write(join(cwd, dir, ".gitkeep"), "");
    }

    // Resolve the package root the same way copyFrameworkFiles does.
    const oneUp = join(import.meta.dir, "..");
    const twoUp = join(import.meta.dir, "..", "..");
    const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;

    // Copy doctrine subtrees (templates, hooks, stacks, learnings, rules) to
    // .software-teams/<sub>/.
    await copyFrameworkFiles(cwd, projectType, args.force, args.ci);

    // Initialise config files from package's config/ templates. Phase B
    // renamed software-teams-config.yaml → config.yaml; state.yaml lives at
    // .software-teams/state.yaml (out of config/).
    const cfgSrcDir = join(packageRoot, "config");
    if (existsSync(cfgSrcDir)) {
      const cfgDest = join(cwd, ".software-teams", "config", "config.yaml");
      const cfgSrc = join(cfgSrcDir, "config.yaml");
      if (existsSync(cfgSrc) && (args.force || !existsSync(cfgDest))) {
        await Bun.write(cfgDest, await Bun.file(cfgSrc).text());
      }
      const stateSrc = join(cfgSrcDir, "state.yaml");
      const stateDest = join(cwd, ".software-teams", "state.yaml");
      if (existsSync(stateSrc) && (args.force || !existsSync(stateDest))) {
        await Bun.write(stateDest, await Bun.file(stateSrc).text());
      }
    }

    // Generate Claude Code native subagents from canonical agent specs.
    // Behind a feature flag (`features.native_subagents`, default true).
    {
      const { parse: parseYaml } = await import("yaml");
      const cfgPath = join(cwd, ".software-teams", "config", "config.yaml");
      let nativeSubagentsEnabled = true;
      if (existsSync(cfgPath)) {
        try {
          const cfgContent = await Bun.file(cfgPath).text();
          const cfg = (parseYaml(cfgContent) ?? {}) as Record<string, any>;
          if (cfg.features && typeof cfg.features === "object" && cfg.features.native_subagents === false) {
            nativeSubagentsEnabled = false;
          }
        } catch {
          // Treat parse failure as "flag not set" — default to enabled.
        }
      }

      if (!nativeSubagentsEnabled) {
        if (!args.ci) {
          consola.warn(
            "Native subagents disabled (features.native_subagents=false). Skipping conversion.",
          );
        }
      } else {
        const conv = await convertAgents({
          cwd,
          // Resolve agent specs from the package's `agents/` dir.
          sourceDir: join(packageRoot, "agents"),
          targetDir: ".claude/agents",
        });
        if (!args.ci) {
          consola.success(
            `Generated ${conv.written.length} native subagents in .claude/agents/`,
          );
          if (conv.errors.length > 0) {
            consola.warn(`Skipped ${conv.errors.length} agent(s) — see log above`);
          }
        }
      }
    }

    // Scaffold project templates (only if missing). Phase B lowercases the
    // top-level filenames: PROJECT.yaml → project.yaml, etc.
    const scaffoldFiles: Array<{ src: string; dest: string }> = [
      { src: "PROJECT.yaml", dest: "project.yaml" },
      { src: "REQUIREMENTS.yaml", dest: "requirements.yaml" },
      { src: "ROADMAP.yaml", dest: "roadmap.yaml" },
    ];
    for (const { src: srcName, dest: destName } of scaffoldFiles) {
      const src = join(packageRoot, "templates", srcName);
      const dest = join(cwd, ".software-teams", destName);
      if (existsSync(src) && !existsSync(dest)) {
        await Bun.write(dest, await Bun.file(src).text());
      }
    }

    // Add Software Teams entries to .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const jdiMarker = "# Software Teams framework";
    const jdiEntries = [
      "",
      `${jdiMarker} — remove these lines to version control Software Teams artefacts`,
      ".software-teams/",
      ".claude/commands/st/",
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

    // Configure storage in software-teams-config.yaml if flags provided
    if (args.storage || args["storage-path"]) {
      const { parse, stringify } = await import("yaml");
      const configPath = join(cwd, ".software-teams", "config", "software-teams-config.yaml");
      let config: any = {};
      try {
        const existing = await Bun.file(configPath).text();
        config = parse(existing) ?? {};
      } catch { /* file may not exist yet */ }

      config.storage = {
        adapter: args.storage ?? "fs",
        base_path: args["storage-path"] ?? ".software-teams/persistence/",
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
          base_path: args["storage-path"] ?? ".software-teams/persistence/",
        },
      };
      console.log(JSON.stringify(result));
    } else {
      consola.success("Software Teams initialised successfully!");
      consola.info("");
      consola.info("Get started:");
      consola.info("  /st:create-plan \"your feature\"");
      consola.info("  /st:quick \"small fix\"");
    }
  },
});
