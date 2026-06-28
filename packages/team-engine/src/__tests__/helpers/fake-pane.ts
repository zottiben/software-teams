import type { Pane, Unsubscribe } from '../../pane/pane';
import type { PaneStatus } from '../../types';

/**
 * In-memory {@link Pane} for tests: records what was submitted/written and lets the
 * test drive the idle/busy/exit transitions by hand, so the broker's delivery loop
 * can be exercised without a real harness process.
 */
export class FakePane implements Pane {
  readonly submitted: string[] = [];
  readonly written: string[] = [];
  lastResize: { cols: number; rows: number } | undefined;
  private state: PaneStatus;
  private readonly idleListeners = new Set<() => void>();
  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  constructor(
    readonly name: string,
    initial: PaneStatus = 'idle',
  ) {
    this.state = initial;
  }

  status(): PaneStatus {
    return this.state;
  }

  submit(text: string): void {
    this.submitted.push(text);
    // A submitted turn makes the pane busy until the test marks it idle again.
    this.state = 'busy';
  }

  write(text: string): void {
    this.written.push(text);
  }

  resize(cols: number, rows: number): void {
    this.lastResize = { cols, rows };
  }

  onOutput(listener: (chunk: string) => void): Unsubscribe {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onIdle(listener: () => void): Unsubscribe {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  onExit(listener: (code: number) => void): Unsubscribe {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.state = 'exited';
  }

  // --- test controls ---

  /** Transition to idle and notify listeners (drives broker delivery). */
  goIdle(): void {
    this.state = 'idle';
    this.idleListeners.forEach((listener) => listener());
  }

  /** Emit synthetic output to subscribers. */
  emitOutput(chunk: string): void {
    this.outputListeners.forEach((listener) => listener(chunk));
  }

  /** Simulate process exit. */
  exit(code = 0): void {
    this.state = 'exited';
    this.exitListeners.forEach((listener) => listener(code));
  }
}
