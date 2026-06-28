import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * electron-builder packs `node_modules/node-pty`, but Bun installs it as a SYMLINK
 * into its global store (outside the app dir), which electron-builder refuses to
 * pack ("must be under apps/electron"). Replace the symlink with a real, fully
 * dereferenced copy so it can be packaged, and make sure the macOS/Linux
 * spawn-helper keeps its executable bit (Bun extraction can strip it).
 */
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(appDir, 'node_modules', 'node-pty');

if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
  const real = realpathSync(dest);
  rmSync(dest, { force: true });
  cpSync(real, dest, { recursive: true, dereference: true });
  console.log(`prepare-native: materialized node-pty from ${real}`);
} else {
  console.log('prepare-native: node-pty already a real directory');
}

const prebuilds = join(dest, 'prebuilds');
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
console.log('prepare-native: spawn-helper executable bit ensured');
