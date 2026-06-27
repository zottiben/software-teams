import type { Unsubscribe } from './pane';

/**
 * Quiescence-based idle detector.
 *
 * An interactive harness has no "I'm done" signal on stdout, so we infer it: every
 * output chunk (and every input we submit) `bump`s the detector back to busy and
 * (re)arms a timer; when output stays quiet for `quietMs`, the pane is considered
 * idle and listeners fire. This is harness-agnostic and needs no hook wiring, which
 * is what makes it the MVP default; a precise Stop-hook detector can replace it
 * later behind the same `onIdle` surface.
 */
export class IdleDetector {
  private state: 'busy' | 'idle' = 'busy';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly quietMs: number) {}

  status(): 'busy' | 'idle' {
    return this.state;
  }

  /** Mark activity (output produced or input submitted) and re-arm the idle timer. */
  bump(): void {
    this.state = 'busy';
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), this.quietMs);
  }

  onIdle(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Cancel any pending timer (call on process exit / dispose). */
  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private fire(): void {
    this.timer = undefined;
    this.state = 'idle';
    this.listeners.forEach((listener) => listener());
  }
}
