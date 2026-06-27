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
 * Locate the team-engine bundles and persona directory in the monorepo, starting
 * from `start` (the app directory). Bundled into the Electron app, the engine's own
 * auto-resolution can't find its sibling package, so the app passes these paths
 * explicitly to TeamEngine.start. (Packaged builds will ship these — Phase 5.)
 */
export function resolveEnginePaths(start: string): EnginePaths {
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
