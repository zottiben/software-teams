import { defineCommand } from "citty";
import { consola } from "consola";
import { relative } from "path";
import { buildPlugin } from "../utils/build-plugin";

export const buildPluginCommand = defineCommand({
  meta: {
    name: "build-plugin",
    description:
      "Generate plugin agents/ and commands/ content trees from framework/",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print what would be written without writing any files",
      default: false,
    },
    "repo-root": {
      type: "string",
      description: "Override repo root (default: cwd)",
    },
  },
  async run({ args }) {
    const repoRoot = args["repo-root"] ?? process.cwd();
    const dryRun = args["dry-run"] === true;

    if (dryRun) {
      consola.info("Dry-run mode — no files will be written");
    }

    const result = await buildPlugin({ repoRoot, dryRun });

    const verb = dryRun ? "Would write" : "Wrote";

    if (result.agentsWritten.length > 0) {
      consola.info(
        `${verb} ${result.agentsWritten.length} agent file(s) to agents/`,
      );
      if (dryRun) {
        for (const f of result.agentsWritten) {
          consola.log(`  ${relative(repoRoot, f)}`);
        }
      }
    }

    if (result.commandsWritten.length > 0) {
      consola.info(
        `${verb} ${result.commandsWritten.length} command file(s) to commands/`,
      );
      if (dryRun) {
        for (const f of result.commandsWritten) {
          consola.log(`  ${relative(repoRoot, f)}`);
        }
      }
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        consola.error(`${err.file}: ${err.reason}`);
      }
      consola.error(`${result.errors.length} error(s) during plugin build`);
      process.exit(1);
    }

    if (result.agentsWritten.length === 0 && result.commandsWritten.length === 0) {
      consola.warn("No files were written — check that framework/ exists at the repo root");
    } else if (!dryRun) {
      consola.success(
        `Plugin content tree generated: ${result.agentsWritten.length} agents, ${result.commandsWritten.length} commands`,
      );
    }
  },
});
