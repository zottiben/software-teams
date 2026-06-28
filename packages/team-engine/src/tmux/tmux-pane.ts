import type { Pane, Unsubscribe } from '../pane/pane';
import type { PaneStatus } from '../types';

/** The slice of {@link import('./tmux').Tmux} a pane needs (fakeable in tests). */
export interface TmuxDriver {
  submitText(target: string, text: string): void;
  pasteText(target: string, text: string, bracketed?: boolean): void;
  killPane(target: string): void;
}

/**
 * A {@link Pane} backed by a tmux pane running a real `claude`. tmux owns the
 * terminal, so the engine cannot watch output for idleness — instead each pane's
 * Stop hook calls the control server, which routes the signal here via
 * {@link TmuxPane.signalIdle}. Delivery is a bracketed paste + Enter (handles
 * multi-line message bodies without premature submission).
 */
export class TmuxPane implements Pane {
  private state: PaneStatus = 'starting';
  private readonly idleListeners = new Set<() => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  constructor(
    readonly name: string,
    private readonly tmux: TmuxDriver,
    /** tmux pane id (e.g. `%3`); exposed so the GUI/tests can target this pane. */
    readonly target: string,
  ) {}

  status(): PaneStatus {
    return this.state;
  }

  submit(text: string): void {
    if (this.state === 'exited') return;
    this.tmux.submitText(this.target, text);
    this.state = 'busy';
  }

  write(text: string): void {
    if (this.state === 'exited') return;
    this.tmux.pasteText(this.target, text, false);
  }

  // tmux owns the terminal geometry (layout/attached client); nothing to resize here.
  resize(): void {
    /* no-op */
  }

  // tmux owns the terminal; the engine does not stream a pane's output.
  onOutput(): Unsubscribe {
    return () => undefined;
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
    if (this.state === 'exited') return;
    this.state = 'exited';
    this.tmux.killPane(this.target);
    this.exitListeners.forEach((listener) => listener(0));
  }

  /** Called when this pane's Stop hook fires — it finished a turn and is idle. */
  signalIdle(): void {
    if (this.state === 'exited') return;
    this.state = 'idle';
    this.idleListeners.forEach((listener) => listener());
  }
}
