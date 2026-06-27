import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, test } from 'bun:test';
import { Tmux } from '../tmux/tmux';

const socket = `st-test-${randomUUID().slice(0, 8)}`;
const liveDescribe = Tmux.available(socket) ? describe : describe.skip;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

liveDescribe('Tmux primitives (live tmux, no claude)', () => {
  const tmux = new Tmux(`st-${randomUUID().slice(0, 8)}`, { socketName: socket });

  afterAll(() => {
    tmux.killSession();
  });

  test('runLine executes a command line in a pane', async () => {
    const pane = tmux.newSession(tmpdir());
    tmux.runLine(pane, 'echo RUNLINE_MARKER_OK');
    await wait(450);
    expect(tmux.capturePane(pane)).toContain('RUNLINE_MARKER_OK');
  });

  test('submitText delivers text into a running pane (bracketed paste + Enter)', async () => {
    const pane = tmux.splitWindow(tmpdir());
    tmux.runLine(pane, 'cat'); // echoes whatever is submitted
    await wait(250);
    tmux.submitText(pane, 'PASTE_MARKER_OK');
    await wait(450);
    expect(tmux.capturePane(pane)).toContain('PASTE_MARKER_OK');
  });
});
