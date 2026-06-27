import { describe, expect, test } from 'bun:test';
import { resolveEnginePaths } from '../engine-paths';

describe('resolveEnginePaths', () => {
  test('resolves the engine bundles and persona dir from the app directory', () => {
    const paths = resolveEnginePaths(process.cwd());
    expect(paths.proxyPath).toContain(['packages', 'team-engine', 'dist', 'mcp-proxy.mjs'].join('/'));
    expect(paths.routeHookPath).toContain(
      ['packages', 'team-engine', 'dist', 'team-route-hook.mjs'].join('/'),
    );
    expect(paths.agentsDir).toContain(['packages', 'cli', 'agents'].join('/'));
  });

  test('throws when not inside the monorepo', () => {
    expect(() => resolveEnginePaths('/')).toThrow(/Could not locate/);
  });
});
