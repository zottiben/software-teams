/**
 * PreToolUse(Task) hook entry, bundled for Node into `dist/team-route-hook.mjs`.
 *
 * Reads the hook payload on stdin and a roster file path from argv[2]; if the call
 * spawns a teammate that is already a live pane, exits 2 (Claude Code hard-blocks
 * the Task) with guidance to delegate instead. Fails open on any error.
 */
import { readFileSync } from 'node:fs';
import { decideTaskRoute, type HookPayload } from './route';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main(): Promise<void> {
  const rosterPath = process.argv[2];
  const roster = rosterPath ? (JSON.parse(readFileSync(rosterPath, 'utf8')) as string[]) : [];
  const raw = await readStdin();
  const payload = (raw.trim() ? JSON.parse(raw) : {}) as HookPayload;
  const decision = decideTaskRoute(payload, roster);
  if (decision.deny) {
    process.stderr.write(`${decision.message ?? ''}\n`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
