'use strict';

/**
 * Post-build spec-bundling step (ADR-004, Decisions L & M).
 *
 * Runs AFTER `n8n-node build` emits dist/. Copies the specialist persona
 * specs (`software-teams-*.md`) and native rule defaults from the tracked plugin source
 * `packages/cli/agents/` into `dist/agents/`, so a packed/installed package
 * ships the personas that `resolveAgentSpecPath` (single-turn.ts) resolves at
 * runtime. The source is the version-controlled `packages/cli/agents/` (NOT the
 * gitignored, generated `.claude/agents/` copy), so a fresh clone / CI / npm
 * build all bundle the specs deterministically.
 *
 * NOT a bundler — a plain file copy (ADR-003 no-bundler constraint). Only
 * `software-teams-*.md` agent specs and rule Markdown are copied.
 */

const path = require('node:path');
const fs = require('node:fs');

const pkgRoot = path.resolve(__dirname, '..');
const sourceDir = path.resolve(pkgRoot, '..', 'cli', 'agents');
const destDir = path.resolve(pkgRoot, 'dist', 'agents');
const rulesSourceDir = path.resolve(pkgRoot, '..', 'cli', 'rules');
const rulesDestDir = path.resolve(pkgRoot, 'dist', 'rules');

const specs = fs
  .readdirSync(sourceDir)
  .filter((name) => name.startsWith('software-teams-') && name.endsWith('.md'));

fs.mkdirSync(destDir, { recursive: true });

for (const spec of specs) {
  fs.copyFileSync(path.resolve(sourceDir, spec), path.resolve(destDir, spec));
  process.stdout.write(`COPY  ${spec}\n`);
}

const rules = fs.readdirSync(rulesSourceDir).filter((name) => name.endsWith('.md'));
fs.mkdirSync(rulesDestDir, { recursive: true });
for (const rule of rules) {
  fs.copyFileSync(path.resolve(rulesSourceDir, rule), path.resolve(rulesDestDir, rule));
  process.stdout.write(`COPY  rules/${rule}\n`);
}

process.stdout.write(
  `\n${specs.length} specialist spec(s) and ${rules.length} native rule file(s) bundled.\n`,
);
