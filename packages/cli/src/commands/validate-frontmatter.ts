/**
 * `software-teams validate-frontmatter` — CI gate for the Claude Code surface.
 *
 * Checks every shipped agent spec, native skill, and the model profiles in
 * config.yaml against the real tool names, model aliases, and effort levels.
 * Runs against the package's own payload directories, so it validates what we
 * ship rather than what happens to be installed in the caller's repo.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { consola } from "consola";
import { parse } from "yaml";
import {
  validateFrontmatter,
  validateModelConfig,
  type FrontmatterFinding,
} from "../utils/validate-frontmatter";

/**
 * Resolve the package root from this module, walking up until the payload
 * directories appear. Works from `src/` under Bun and from the bundled
 * `dist/index.js`, which sit at different depths.
 */
function resolvePackageRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  const candidates = ["..", "../..", "../../..", "../../../.."];
  const found = candidates
    .map((c) => resolve(start, c))
    .find((dir) => existsSync(join(dir, "agents")) && existsSync(join(dir, "skills")));
  return found ?? resolve(start, "../..");
}

function report(label: string, findings: readonly FrontmatterFinding[]): void {
  for (const f of findings) {
    consola.log(`  ${label} ${f.file}`);
    consola.log(`      ${f.field}: ${f.value} — ${f.message}`);
  }
}

export const validateFrontmatterCommand = defineCommand({
  meta: {
    name: "validate-frontmatter",
    description:
      "Validate agent/skill frontmatter and model profiles against the real Claude Code surface",
  },
  args: {
    root: {
      type: "string",
      description: "Package root to validate (defaults to the installed package)",
      required: false,
    },
    "warnings-as-errors": {
      type: "boolean",
      description: "Exit non-zero on warnings as well as errors",
      default: false,
    },
  },
  async run({ args }) {
    const root = args.root ? resolve(String(args.root)) : resolvePackageRoot();

    const result = await validateFrontmatter({
      agentsDir: join(root, "agents"),
      skillDirs: [join(root, "skills")],
    });

    const configPath = join(root, "config", "config.yaml");
    const configFindings = existsSync(configPath)
      ? validateModelConfig(parse(await readFile(configPath, "utf8")))
      : [];

    const errors = [...result.errors, ...configFindings];
    const { warnings } = result;

    if (errors.length > 0) {
      consola.error(`Frontmatter validation failed (${errors.length} error(s)):`);
      report("✗", errors);
    }

    if (warnings.length > 0) {
      consola.warn(`${warnings.length} warning(s):`);
      report("!", warnings);
    }

    if (errors.length === 0 && warnings.length === 0) {
      consola.success(
        `Frontmatter valid across ${result.filesChecked} file(s) and the model profiles.`,
      );
    }

    const failed = errors.length > 0 || (args["warnings-as-errors"] && warnings.length > 0);
    if (failed) process.exit(1);
  },
});
