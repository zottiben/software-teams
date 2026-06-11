'use strict';

/**
 * Post-build Node-load gate (ADR-003, Decision 5).
 *
 * Runs with CWD = packages/n8n/ so the workspace node_modules supplies:
 *   - n8n-workflow  → dist/cjs/index.js  (the CJS build, not the Bun-install ESM path)
 *   - @websitelabs/software-teams → lib/n8n-api.js  (via the exports.require condition)
 *
 * Derives the paths to load from package.json n8n.nodes[] + n8n.credentials[].
 * Never hardcodes the file list.
 */

const path = require('node:path');
const fs = require('node:fs');

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const entries = [
  ...(pkg.n8n.credentials || []),
  ...(pkg.n8n.nodes || []),
];

let failures = 0;

for (const entry of entries) {
  const absPath = path.resolve(__dirname, '..', entry);
  try {
    require(absPath);
    process.stdout.write(`PASS  ${entry}\n`);
  } catch (err) {
    failures += 1;
    process.stderr.write(`FAIL  ${entry}\n      ${err.message}\n`);
  }
}

process.stdout.write(`\n${entries.length - failures}/${entries.length} loaded successfully.\n`);

if (failures > 0) {
  process.stderr.write(`\n${failures} file(s) failed to load under Node. See FAIL lines above.\n`);
  process.exit(1);
}
