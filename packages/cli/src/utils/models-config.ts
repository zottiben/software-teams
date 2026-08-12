import { join } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/**
 * Resolve the packaged fallback config.yaml path relative to this file.
 *
 * `import.meta.dir` resolves to:
 *   - `<package>/src/utils/`   when running uncompiled (dev / bun run)
 *   - `<package>/dist/`        when running the bundled CLI
 *
 * The packaged config lives at `<package>/config/config.yaml`.
 * From src/utils/ that is two levels up then into config/.
 * From dist/ that is one level up then into config/.
 * We detect which by checking for package.json (same pattern as copy-framework.ts).
 */
function packagedConfigPath(): string {
  const oneUp = join(import.meta.dir, "..");
  const twoUp = join(import.meta.dir, "..", "..");
  const packageRoot = existsSync(join(oneUp, "package.json")) ? oneUp : twoUp;
  return join(packageRoot, "config", "config.yaml");
}

/**
 * Resolved per-agent routing, keyed by the hyphenated agent name minus the
 * `software-teams-` prefix.
 *
 * The two dials are independent and resolved independently: `models` says how
 * capable the agent is, `efforts` how thorough. `efforts` is deliberately
 * sparse - an agent absent from it inherits the model's default effort, which
 * is what Anthropic recommends for most work.
 */
export interface AgentRoutingConfig {
  readonly models: Record<string, string>;
  readonly efforts: Record<string, string>;
}

/** Config arrives as `unknown` from a YAML parse; narrow before indexing. */
function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Collect the non-empty string entries of a record, ignoring everything else. */
function stringEntries(source: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Load the resolved `{ models, efforts }` routing from the Software Teams
 * config.yaml.
 *
 * Resolution order for the file:
 *   1. `<cwd>/.software-teams/config/config.yaml`  (project-local)
 *   2. Packaged `<cli-package>/config/config.yaml`  (installed fallback)
 *
 * Within the file, the active profile comes from `models.profile`. Its agent
 * entries seed `models`, its nested `effort:` map seeds `efforts`, and the
 * `overrides` / `effort_overrides` maps are applied on top.
 *
 * Returns empty maps on every error path: missing file, missing `models` block,
 * malformed YAML, or unknown active profile. Never throws - callers fall back
 * to the per-agent frontmatter.
 */
export async function loadAgentRouting(cwd: string): Promise<AgentRoutingConfig> {
  const empty: AgentRoutingConfig = { models: {}, efforts: {} };
  try {
    const localPath = join(cwd, ".software-teams", "config", "config.yaml");
    const configPath = existsSync(localPath) ? localPath : packagedConfigPath();
    if (!existsSync(configPath)) return empty;

    const raw = readRecord(parseYaml(await Bun.file(configPath).text()));
    const models = readRecord(raw?.["models"]);
    if (!models) return empty;

    const activeProfile = models["profile"];
    if (typeof activeProfile !== "string" || !activeProfile) return empty;

    const profile = readRecord(readRecord(models["profiles"])?.[activeProfile]);
    if (!profile) return empty;

    // `effort` is a nested map inside the profile, so stringEntries skips it
    // here (its value is an object, not a string) and it is read separately.
    return {
      models: { ...stringEntries(profile), ...stringEntries(readRecord(models["overrides"])) },
      efforts: {
        ...stringEntries(readRecord(profile["effort"])),
        ...stringEntries(readRecord(models["effort_overrides"])),
      },
    };
  } catch {
    return empty;
  }
}

/**
 * Back-compat accessor for callers that only need the model map.
 *
 * @deprecated Prefer `loadAgentRouting`, which also returns effort.
 */
export async function loadModelMap(cwd: string): Promise<Record<string, string>> {
  return (await loadAgentRouting(cwd)).models;
}
