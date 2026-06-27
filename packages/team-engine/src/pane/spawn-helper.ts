import { chmodSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const state = { ensured: false };

/**
 * node-pty ships a prebuilt `spawn-helper` binary on macOS/Linux that the native
 * addon `posix_spawn`s. Some installers (notably Bun's package store) extract it
 * without the executable bit, which makes every spawn fail with
 * `posix_spawnp failed`. This restores the bit, best-effort, the first time a pane
 * is launched — so the engine works regardless of how dependencies were installed.
 */
export function ensureSpawnHelperExecutable(): void {
  if (state.ensured) return;
  state.ensured = true;
  if (process.platform === 'win32') return;
  try {
    const require = createRequire(import.meta.url);
    const ptyRoot = dirname(dirname(require.resolve('node-pty')));
    const helper = join(ptyRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    const info = statSync(helper);
    const hasExec = (info.mode & 0o111) !== 0;
    if (!hasExec) chmodSync(helper, info.mode | 0o755);
  } catch {
    // Best-effort: if the layout differs, the spawn itself surfaces a clear error.
  }
}
