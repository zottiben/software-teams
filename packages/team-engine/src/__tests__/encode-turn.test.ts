import { describe, expect, test } from 'bun:test';
import { wrapForPaste } from '../pane/pty-pane';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

describe('wrapForPaste', () => {
  test('leaves a single-line turn unchanged (submit key sent separately)', () => {
    expect(wrapForPaste('/clear')).toBe('/clear');
    expect(wrapForPaste('hi there')).toBe('hi there');
  });

  test('wraps a multi-line turn in a bracketed paste', () => {
    const out = wrapForPaste('[team] from frontend:\n\nThanks!\n\n(reply…)');
    expect(out.startsWith(PASTE_START)).toBe(true);
    expect(out.endsWith(PASTE_END)).toBe(true);
    expect(out).toContain('Thanks!');
    // no stray submit char inside the wrapped body
    expect(out).not.toContain('\r');
  });
});
