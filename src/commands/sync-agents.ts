import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "path";
import { existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { convertAgents } from "../utils/convert-agents";

/**
 * Read `features.native_subagents` from `.software-teams/config/software-teams-config.yaml` if it
 * exists. Returns the boolean value, defaulting to `true` when the file or
 * key is absent. Any read/parse failure also defaults to `true` — the
 * feature flag is an escape hatch, not a gate.
 */
async function readNativeSubagentsFlag(cwd: string): Promise<boolean> {
  const configPath = join(cwd, ".software-teams", "config", "software-teams-config.yaml");
  if (!existsSync(configPath)) return true;
  try {
    const content = await Bun.file(configPath).text();
    const config = (parseYaml(content) ?? {}) as Record<string, any>;
    const features = config.features as Record<string, unknown> | undefined;
    if (!features || typeof features !== "object") return true;
    const flag = features.native_subagents;
    if (flag === false) return false;
    return true;
  } catch {
    return true;
  }
}

export const syncAgentsCommand = defineCommand({
  meta: {
    name: "sync-agents",
    description: "Regenerate .claude/agents/ from framework/agents/",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Show what would change without writing",
      default: false,
    },
    "source-dir": {
      type: "string",
      description: "Override source directory (default: .software-teams/framework/agents)",
    },
    "target-dir": {
      type: "string",
      description: "Override target directory (default: .claude/agents)",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();

    // Feature flag escape hatch (R-01 mitigation)
    const enabled = await readNativeSubagentsFlag(cwd);
    if (!enabled) {
      consola.warn(
        "Native subagents disabled (features.native_subagents=false in .software-teams/config/software-teams-config.yaml). Skipping.",
      );
      return;
    }

    const result = await convertAgents({
      cwd,
      sourceDir: args["source-dir"],
      targetDir: args["target-dir"],
      dryRun: args["dry-run"] === true,
    });

    const verb = args["dry-run"] ? "Would write" : "Wrote";
    consola.info(`${verb} ${result.written.length} agent(s) to .claude/agents/`);

    if (result.skipped.length > 0) {
      consola.info(`Skipped ${result.skipped.length} existing file(s)`);
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        consola.error(`${err.file}: ${err.reason}`);
      }
      consola.error(`${result.errors.length} error(s) during conversion`);
      process.exit(1);
    }
  },
});
