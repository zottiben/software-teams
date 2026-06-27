import type { IPty } from 'node-pty';
import { createRequire } from 'node:module';
import type { Pane, Unsubscribe } from './pane';
import type { PaneStatus } from '../types';
import { IdleDetector } from './idle';
import { ensureSpawnHelperExecutable } from './spawn-helper';

export interface PtyPaneOptions {
  /** Addressable agent identity. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cols?: number;
  readonly rows?: number;
  /** Quiet window (ms) with no output before the pane is treated as idle. */
  readonly idleQuietMs?: number;
  /** Keystroke appended by `submit` to send a turn (default carriage return). */
  readonly submitKey?: string;
}

/** The slice of node-pty's surface the engine uses. */
interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): IPty;
}

/**
 * node-pty is a native addon that loads only under Node (not Bun) and only when a
 * pane is actually spawned. Loading it lazily here keeps merely importing this
 * module safe under the Bun test runner.
 */
function loadNodePty(): NodePtyModule {
  const require = createRequire(import.meta.url);
  return require('node-pty') as NodePtyModule;
}

/**
 * A {@link Pane} backed by a real interactive harness process over a PTY. Output is
 * streamed to subscribers and fed to an {@link IdleDetector}; the broker delivers a
 * brokered message by calling {@link PtyPane.submit}, which writes the turn to stdin.
 */
export class PtyPane implements Pane {
  private state: PaneStatus = 'starting';
  private readonly idleListeners = new Set<() => void>();
  private readonly outputListeners = new Set<(chunk: string) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  private constructor(
    readonly name: string,
    private readonly pty: IPty,
    private readonly idle: IdleDetector,
    private readonly submitKey: string,
  ) {}

  static spawn(options: PtyPaneOptions): PtyPane {
    ensureSpawnHelperExecutable();
    const proc = loadNodePty().spawn(options.command, [...options.args], {
      name: 'xterm-color',
      cols: options.cols ?? 120,
      rows: options.rows ?? 32,
      cwd: options.cwd,
      env: { ...options.env },
    });
    const pane = new PtyPane(
      options.name,
      proc,
      new IdleDetector(options.idleQuietMs ?? 750),
      options.submitKey ?? '\r',
    );
    pane.wire();
    return pane;
  }

  status(): PaneStatus {
    return this.state;
  }

  submit(text: string): void {
    if (this.state === 'exited') return;
    this.pty.write(`${text}${this.submitKey}`);
    this.state = 'busy';
    this.idle.bump();
  }

  write(text: string): void {
    if (this.state === 'exited') return;
    this.pty.write(text);
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
    this.idle.stop();
    if (this.state !== 'exited') this.pty.kill();
  }

  private wire(): void {
    this.pty.onData((chunk) => {
      if (this.state !== 'exited') this.state = 'busy';
      this.outputListeners.forEach((listener) => listener(chunk));
      this.idle.bump();
    });
    this.pty.onExit(({ exitCode }) => {
      this.state = 'exited';
      this.idle.stop();
      this.exitListeners.forEach((listener) => listener(exitCode));
    });
    this.idle.onIdle(() => {
      if (this.state === 'exited') return;
      this.state = 'idle';
      this.idleListeners.forEach((listener) => listener());
    });
    // Arm the detector so a process that prints a banner then waits resolves to idle.
    this.idle.bump();
  }
}
