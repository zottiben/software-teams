import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface EnginePaths {
  /** Bundled MCP proxy (`packages/team-engine/dist/mcp-proxy.mjs`). */
  readonly proxyPath: string;
  /** Bundled Task-route hook (`packages/team-engine/dist/team-route-hook.mjs`). */
  readonly routeHookPath: string;
  /** Canonical persona directory (`packages/cli/agents`). */
  readonly agentsDir: string;
}

function findUp(start: string, rel: string): string | undefined {
  const visit = (dir: string): string | undefined => {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    return parent === dir ? undefined : visit(parent);
  };
  return visit(start);
}

/**
 * In a packaged build, electron-builder copies the engine bundles to
 * `<Resources>/engine` and the personas to `<Resources>/agents` (see
 * electron-builder.yml `extraResources`). `process.resourcesPath` points at the
 * app's Resources directory only in a packaged Electron app; in dev it points at
 * Electron's own resources (which won't contain these), so this returns undefined
 * and we fall back to the monorepo layout.
 */
function packagedPaths(): EnginePaths | undefined {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (!resources) return undefined;
  const proxyPath = join(resources, 'engine', 'mcp-proxy.mjs');
  if (!existsSync(proxyPath)) return undefined;
  return {
    proxyPath,
    routeHookPath: join(resources, 'engine', 'team-route-hook.mjs'),
    agentsDir: join(resources, 'agents'),
  };
}

/**
 * Locate the team-engine bundles and persona directory: from the packaged app's
 * Resources when packaged, else by walking up the monorepo from `start` (dev).
 */
export function resolveEnginePaths(start: string): EnginePaths {
  const packaged = packagedPaths();
  if (packaged) return packaged;

  const engineRoot = findUp(start, join('packages', 'team-engine'));
  const agentsDir = findUp(start, join('packages', 'cli', 'agents'));
  if (!engineRoot || !agentsDir) {
    throw new Error(
      'Could not locate packages/team-engine and packages/cli/agents in the monorepo. ' +
        'Run `bun run --cwd packages/team-engine build` first.',
    );
  }
  return {
    proxyPath: join(engineRoot, 'dist', 'mcp-proxy.mjs'),
    routeHookPath: join(engineRoot, 'dist', 'team-route-hook.mjs'),
    agentsDir,
  };
}
