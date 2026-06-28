import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { resolveEnginePaths } from '../engine-paths';

describe('resolveEnginePaths (dev / monorepo)', () => {
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

describe('resolveEnginePaths (packaged)', () => {
  const original = (process as any).resourcesPath;

  afterEach(() => {
    (process as any).resourcesPath = original;
  });

  test('prefers bundled resources when packaged', () => {
    const resources = mkdtempSync(join(tmpdir(), 'st-res-'));
    mkdirSync(join(resources, 'engine'), { recursive: true });
    mkdirSync(join(resources, 'agents'), { recursive: true });
    writeFileSync(join(resources, 'engine', 'mcp-proxy.mjs'), '// bundled');
    writeFileSync(join(resources, 'engine', 'team-route-hook.mjs'), '// bundled');
    (process as any).resourcesPath = resources;
    try {
      const paths = resolveEnginePaths('/some/where');
      expect(paths.proxyPath).toBe(join(resources, 'engine', 'mcp-proxy.mjs'));
      expect(paths.routeHookPath).toBe(join(resources, 'engine', 'team-route-hook.mjs'));
      expect(paths.agentsDir).toBe(join(resources, 'agents'));
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });
});
