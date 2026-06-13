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
 * Load the merged `{ profileKey → modelId }` map from the Software Teams
 * config.yaml.
 *
 * Resolution order:
 *   1. `<cwd>/.software-teams/config/config.yaml`  (project-local)
 *   2. Packaged `<cli-package>/config/config.yaml`  (installed fallback)
 *
 * The active profile is read from `models.profile`. Overrides from
 * `models.overrides` whose values are non-null, non-empty strings are
 * applied on top of the active profile entries.
 *
 * Returns `{}` on every error path: missing file, missing `models` block,
 * malformed YAML, or unknown active profile. Never throws.
 */
export async function loadModelMap(cwd: string): Promise<Record<string, string>> {
  try {
    // Step 2: resolve config path — project-local first, then packaged fallback.
    const localPath = join(cwd, ".software-teams", "config", "config.yaml");
    const configPath = existsSync(localPath) ? localPath : packagedConfigPath();

    if (!existsSync(configPath)) return {};

    // Step 3: read and parse.
    const content = await Bun.file(configPath).text();
    const raw = (parseYaml(content) ?? {}) as Record<string, unknown>;

    // Step 4: extract models block — missing or wrong type → {}.
    const modelsBlock = raw.models;
    if (!modelsBlock || typeof modelsBlock !== "object") return {};
    const models = modelsBlock as Record<string, unknown>;

    const activeProfile = models.profile;
    if (typeof activeProfile !== "string" || !activeProfile) return {};

    const profiles = models.profiles;
    if (!profiles || typeof profiles !== "object") return {};
    const profilesMap = profiles as Record<string, unknown>;

    // Step 5: look up the active profile — unknown profile → {}.
    const profileEntry = profilesMap[activeProfile];
    if (!profileEntry || typeof profileEntry !== "object") return {};
    const profileData = profileEntry as Record<string, unknown>;

    // Step 6: build base map from profile (string values only).
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(profileData)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }

    // Apply overrides: non-null, non-empty string values overwrite profile entries.
    const overrides = models.overrides;
    if (overrides && typeof overrides === "object") {
      const overridesMap = overrides as Record<string, unknown>;
      for (const [key, value] of Object.entries(overridesMap)) {
        if (typeof value === "string" && value.length > 0) {
          result[key] = value;
        }
        // null / undefined / empty string → keep profile value (step 6 logic).
      }
    }

    // Step 7: model IDs pass through verbatim — no alias translation.
    return result;
  } catch {
    // Step 8: any throw → return {} so callers fall back to per-agent frontmatter.
    return {};
  }
}
