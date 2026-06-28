import { describe, expect, test } from 'bun:test';
import { IdleDetector } from '../pane/idle';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('IdleDetector', () => {
  test('starts busy and goes idle after a quiet period', async () => {
    const detector = new IdleDetector(20);
    const fired: number[] = [];
    detector.onIdle(() => fired.push(1));
    detector.bump();
    expect(detector.status()).toBe('busy');
    await wait(45);
    expect(detector.status()).toBe('idle');
    expect(fired).toHaveLength(1);
  });

  test('continued activity keeps it busy (timer re-arms)', async () => {
    const detector = new IdleDetector(30);
    const fired: number[] = [];
    detector.onIdle(() => fired.push(1));
    detector.bump();
    await wait(15);
    detector.bump(); // still streaming
    await wait(15);
    expect(detector.status()).toBe('busy');
    expect(fired).toHaveLength(0);
    await wait(30);
    expect(detector.status()).toBe('idle');
    expect(fired).toHaveLength(1);
  });

  test('stop() prevents a pending idle from firing', async () => {
    const detector = new IdleDetector(20);
    const fired: number[] = [];
    detector.onIdle(() => fired.push(1));
    detector.bump();
    detector.stop();
    await wait(40);
    expect(fired).toHaveLength(0);
  });
});
