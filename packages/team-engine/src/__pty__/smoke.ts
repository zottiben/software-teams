/**
 * Real-PTY integration smoke for PtyPane + Broker.
 *
 * node-pty's native addon runs under Node, not Bun, so this is NOT a `bun test`.
 * It is bundled for Node (`bun build --target=node --external node-pty`) and run
 * with `node` via the engine's `verify:pty` script. It spawns a trivial interactive
 * process (`bash -c 'printf ready; cat'`) — no `claude` required — and asserts the
 * full loop: stdin injection, output streaming, quiescence idle, and broker
 * deliver-on-idle.
 */
import { Broker } from '../broker/broker';
import { ClaudeCodeAdapter } from '../harness/claude-code';
import { PtyPane } from '../pane/pty-pane';
import type { AgentSpec } from '../types';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const echoSpec: AgentSpec = {
    name: 'echo-agent',
    role: 'echo',
    persona: 'n/a',
    isLead: false,
  };

  // `cat` echoes whatever we submit; `printf` gives an initial banner so we can
  // verify the starting → idle transition.
  const pane = PtyPane.spawn({
    name: echoSpec.name,
    command: 'bash',
    args: ['-c', 'printf "ready\\n"; cat'],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '' },
    idleQuietMs: 200,
  });

  const output: string[] = [];
  pane.onOutput((chunk) => output.push(chunk));

  const idleEvents = { count: 0 };
  pane.onIdle(() => {
    idleEvents.count += 1;
  });

  // 1) Banner arrives, then the pane quiesces to idle.
  await wait(600);
  assert(output.join('').includes('ready'), 'initial banner "ready" was streamed');
  assert(pane.status() === 'idle', `pane should be idle after banner, was ${pane.status()}`);
  assert(idleEvents.count >= 1, 'idle fired at least once after the banner');

  // 2) Broker delivers a queued message into the idle pane as a turn.
  const broker = new Broker(new ClaudeCodeAdapter());
  broker.registerPane(echoSpec, pane);
  broker.submit({ kind: 'send', from: 'tester', to: echoSpec.name, body: 'PING-TOKEN' });

  await wait(600);
  assert(output.join('').includes('PING-TOKEN'), 'broker-delivered message reached the PTY');
  assert(pane.status() === 'idle', 'pane returned to idle after the delivered turn');

  broker.dispose();
  await pane.dispose();
  console.log('PTY smoke OK: banner+idle, stdin injection, broker deliver-on-idle all verified.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('PTY smoke threw:', error);
  process.exit(1);
});
