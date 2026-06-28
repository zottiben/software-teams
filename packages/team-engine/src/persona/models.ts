import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Per-agent model resolution, mirroring how Software Teams' `sync-agents` resolves
 * a spec's model:
 *   1. the active `config.yaml` `models:` profile (override applied) — highest priority
 *   2. the agent's frontmatter `model:` alias — fallback
 *
 * Without this, every pane launches on the user's default model (e.g. Opus) and
 * ignores the per-agent assignments in the agents/config.
 */
export interface ModelMapOptions {
  /** Repo the team works on; a project-local config.yaml here takes precedence. */
  readonly repoRoot?: string;
  /** Fallback config.yaml (packaged or monorepo default). */
  readonly configPath?: string;
}

function findCliConfig(start: string): string | undefined {
  const visit = (dir: string): string | undefined => {
    const candidate = join(dir, 'packages', 'cli', 'config', 'config.yaml');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    return parent === dir ? undefined : visit(parent);
  };
  return visit(start);
}

/** The monorepo's packaged `config.yaml`, if found by walking up from this module. */
export function defaultConfigPath(): string | undefined {
  return findCliConfig(dirname(fileURLToPath(import.meta.url)));
}

function resolveConfigPath(options: ModelMapOptions): string | undefined {
  const local = options.repoRoot
    ? join(options.repoRoot, '.software-teams', 'config', 'config.yaml')
    : undefined;
  if (local && existsSync(local)) return local;
  return options.configPath ?? defaultConfigPath();
}

/**
 * Load the `{ agentKey → modelId }` map for the active config profile (with
 * overrides applied). Agent keys are the hyphenated name minus `software-teams-`
 * (e.g. `frontend`, `qa-tester`). Returns `{}` on any error so callers fall back
 * to frontmatter.
 */
export function loadModelMap(options: ModelMapOptions = {}): Record<string, string> {
  try {
    const path = resolveConfigPath(options);
    if (!path || !existsSync(path)) return {};
    const raw = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown> | null;
    const models = raw?.models;
    if (!models || typeof models !== 'object') return {};
    const block = models as Record<string, unknown>;

    const profile = block.profile;
    const profiles = block.profiles;
    if (typeof profile !== 'string' || !profiles || typeof profiles !== 'object') return {};
    const entry = (profiles as Record<string, unknown>)[profile];
    if (!entry || typeof entry !== 'object') return {};

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value;
    }
    const overrides = block.overrides;
    if (overrides && typeof overrides === 'object') {
      for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 0) result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Resolve one agent's model: config profile override, else its frontmatter alias. */
export function resolveAgentModel(
  agentName: string,
  frontmatterModel: string | undefined,
  modelMap: Record<string, string>,
): string | undefined {
  const key = agentName.replace(/^software-teams-/, '');
  return modelMap[key] ?? frontmatterModel;
}
