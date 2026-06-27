import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // scripts/
const appDir = join(here, '..');
const dist = join(appDir, 'dist');
const rendererSrc = join(appDir, 'src', 'renderer');

mkdirSync(dist, { recursive: true });

const require = createRequire(import.meta.url);
const xtermCss = require.resolve('@xterm/xterm/css/xterm.css');

copyFileSync(join(rendererSrc, 'index.html'), join(dist, 'index.html'));
copyFileSync(join(rendererSrc, 'styles.css'), join(dist, 'styles.css'));
copyFileSync(xtermCss, join(dist, 'xterm.css'));

console.log('cockpit: copied renderer assets (index.html, styles.css, xterm.css) to dist/');
