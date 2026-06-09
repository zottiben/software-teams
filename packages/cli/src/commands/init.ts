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
    "state-only": {
      type: "boolean",
      description:
        "Scaffold only `.software-teams/` — skip all `.claude/` command and agent generation (intended for plugin users who already have native commands/agents).",
      default: false,
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
      ...(!args["state-only"] ? [".claude/commands/st"] : []),
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

    // Copy doctrine subtrees (templates, rules) to .software-teams/<sub>/.
    // The stateOnly flag suppresses all .claude/ writes inside copyFrameworkFiles.
    await copyFrameworkFiles(cwd, projectType, args.force, args.ci, undefined, args["state-only"]);

    // Seed config from the package's config/ dir and state from templates/.
    // The consumer-side layout is `.software-teams/config/config.yaml` and
    // `.software-teams/state.yaml`.
    const cfgSrc = join(packageRoot, "config", "config.yaml");
    const cfgDest = join(cwd, ".software-teams", "config", "config.yaml");
    if (existsSync(cfgSrc) && (args.force || !existsSync(cfgDest))) {
      await Bun.write(cfgDest, await Bun.file(cfgSrc).text());
    }

    const stateSrc = join(packageRoot, "templates", "state.yaml");
    const stateDest = join(cwd, ".software-teams", "state.yaml");
    if (existsSync(stateSrc) && (args.force || !existsSync(stateDest))) {
      await Bun.write(stateDest, await Bun.file(stateSrc).text());
    }

    // Generate Claude Code native subagents from canonical agent specs.
    // Behind a feature flag (`features.native_subagents`, default true).
    // Skipped entirely when --state-only is set.
    if (!args["state-only"]) {
      const { parse: parseYaml } = await import("yaml");
      const cfgPath = join(cwd, ".software-teams", "config", "config.yaml");
      const nativeSubagentsEnabled = !existsSync(cfgPath) || await (async () => {
        try {
          const cfgContent = await Bun.file(cfgPath).text();
          const cfg = (parseYaml(cfgContent) ?? {}) as Record<string, unknown>;
          return !(cfg.features && typeof cfg.features === "object" && cfg.features.native_subagents === false);
        } catch {
          return true;
        }
      })();

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
          // Init must not clobber a user's existing AGENTS.md, RULES.md,
          // or hand-crafted .claude/agents/<name>.md files. The
          // `preserve-user-owned` mode overwrites only files that carry
          // the AUTO-GENERATED banner (i.e. ones Software Teams owns).
          // `--force` reverts to the previous behaviour for users who
          // need a hard refresh.
          onConflict: args.force ? "overwrite" : "preserve-user-owned",
        });
        if (!args.ci && conv.skipped.length > 0) {
          consola.info(
            `Preserved ${conv.skipped.length} existing user-owned file(s) in .claude/ (use --force to overwrite).`,
          );
        }
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

    // Scaffold project templates (only if missing).
    const scaffoldFiles = ["project.yaml", "requirements.yaml", "roadmap.yaml"];
    for (const name of scaffoldFiles) {
      const src = join(packageRoot, "templates", name);
      const dest = join(cwd, ".software-teams", name);
      if (existsSync(src) && !existsSync(dest)) {
        await Bun.write(dest, await Bun.file(src).text());
      }
    }

    // Add Software Teams entries to .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const stMarker = "# Software Teams framework";
    const stEntries = [
      "",
      `${stMarker} — remove these lines to version control Software Teams artefacts`,
      ".software-teams/",
      ...(!args["state-only"] ? [".claude/commands/st/"] : []),
    ].join("\n");

    const existingGitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    if (!existingGitignore.includes(stMarker)) {
      const newContent = existingGitignore
        ? existingGitignore.trimEnd() + "\n" + stEntries + "\n"
        : stEntries.trimStart() + "\n";
      await Bun.write(gitignorePath, newContent);
    }

    // Configure storage in software-teams-config.yaml if flags provided
    if (args.storage || args["storage-path"]) {
      const { parse, stringify } = await import("yaml");
      const configPath = join(cwd, ".software-teams", "config", "software-teams-config.yaml");
      const config = (await Bun.file(configPath).text().then((t) => parse(t) ?? {}).catch(() => ({}))) as Record<string, unknown>;

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
    } else if (args["state-only"]) {
      consola.success("Software Teams initialised successfully (state-only)!");
      consola.info(".software-teams/ scaffolded — use your plugin's native skills to get started.");
    } else {
      consola.success("Software Teams initialised successfully!");
      consola.info("");
      consola.info("Get started:");
      consola.info("  /st:create-plan \"your feature\"");
      consola.info("  /st:review-plan          (quality-check a plan before approving)");
      consola.info("  /st:quick \"small fix\"");
    }
  },
});
