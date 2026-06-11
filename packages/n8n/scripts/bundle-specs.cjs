'use strict';

/**
 * Post-build spec-bundling step (ADR-004, Decisions L & M).
 *
 * Runs AFTER `n8n-node build` emits dist/. Copies the 33 specialist persona
 * specs (`software-teams-*.md`) from the repo's `.claude/agents/` into
 * `dist/agents/`, so a packed/installed package ships the personas that
 * `resolveAgentSpecPath` (single-turn.ts) resolves at runtime.
 *
 * NOT a bundler — a plain file copy (ADR-003 no-bundler constraint). Only
 * `software-teams-*.md` is copied; the framework/JDI specs are never shipped.
 */

const path = require('node:path');
const fs = require('node:fs');

const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const sourceDir = path.resolve(repoRoot, '.claude', 'agents');
const destDir = path.resolve(pkgRoot, 'dist', 'agents');

const specs = fs
  .readdirSync(sourceDir)
  .filter((name) => name.startsWith('software-teams-') && name.endsWith('.md'));

fs.mkdirSync(destDir, { recursive: true });

for (const spec of specs) {
  fs.copyFileSync(path.resolve(sourceDir, spec), path.resolve(destDir, spec));
  process.stdout.write(`COPY  ${spec}\n`);
}

process.stdout.write(`\n${specs.length} specialist spec(s) bundled into dist/agents/.\n`);
