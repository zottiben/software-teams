import { execFileSync } from 'node:child_process';

export interface TmuxOptions {
  /** Use a dedicated tmux server socket (isolates tests / parallel teams). */
  readonly socketName?: string;
}

/**
 * Thin wrapper over the `tmux` CLI. In tmux mode, tmux owns the terminals — each
 * pane runs a real `claude` process — so the engine drives panes through this:
 * `runLine` launches a command, `submitText` delivers a brokered message into a
 * pane via bracketed paste + Enter, and `capturePane` reads a pane's contents.
 */
export class Tmux {
  constructor(
    readonly session: string,
    private readonly opts: TmuxOptions = {},
  ) {}

  private run(args: readonly string[], input?: string): string {
    const base = this.opts.socketName ? ['-L', this.opts.socketName] : [];
    return execFileSync('tmux', [...base, ...args], {
      encoding: 'utf8',
      // Capture stderr instead of inheriting it: several callers (hasSession,
      // killSession) intentionally probe and may fail with "no server running".
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(input === undefined ? {} : { input }),
    }).trim();
  }

  /** True if `tmux` is installed and runnable. */
  static available(socketName?: string): boolean {
    try {
      const base = socketName ? ['-L', socketName] : [];
      execFileSync('tmux', [...base, '-V'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  hasSession(): boolean {
    try {
      this.run(['has-session', '-t', this.session]);
      return true;
    } catch {
      return false;
    }
  }

  /** Create the detached session and return its first pane id. */
  newSession(cwd: string, cols = 250, rows = 64): string {
    return this.run([
      'new-session', '-d', '-s', this.session, '-c', cwd,
      '-x', String(cols), '-y', String(rows), '-P', '-F', '#{pane_id}',
    ]);
  }

  /** Split the session's window and return the new pane id. */
  splitWindow(cwd: string): string {
    return this.run(['split-window', '-t', this.session, '-c', cwd, '-P', '-F', '#{pane_id}']);
  }

  selectLayout(layout: string): void {
    this.run(['select-layout', '-t', this.session, layout]);
  }

  setMainPaneWidth(width: number): void {
    this.run(['set-window-option', '-t', this.session, 'main-pane-width', String(width)]);
  }

  setPaneTitle(target: string, title: string): void {
    this.run(['select-pane', '-t', target, '-T', title]);
  }

  /** Type a command line into a pane and submit it (used to launch `claude`). */
  runLine(target: string, line: string): void {
    this.run(['send-keys', '-t', target, '-l', line]);
    this.run(['send-keys', '-t', target, 'Enter']);
  }

  /** Paste text into a pane's input without submitting. */
  pasteText(target: string, text: string, bracketed = true): void {
    this.run(['load-buffer', '-b', 'st-deliver', '-'], text);
    const flags = bracketed ? ['-p', '-d'] : ['-d'];
    this.run(['paste-buffer', ...flags, '-b', 'st-deliver', '-t', target]);
  }

  /** Deliver a full turn into a pane: bracketed paste of `text`, then Enter. */
  submitText(target: string, text: string): void {
    this.pasteText(target, text, true);
    this.run(['send-keys', '-t', target, 'Enter']);
  }

  capturePane(target: string): string {
    return this.run(['capture-pane', '-p', '-t', target]);
  }

  killPane(target: string): void {
    try {
      this.run(['kill-pane', '-t', target]);
    } catch {
      // pane already gone
    }
  }

  killSession(): void {
    try {
      this.run(['kill-session', '-t', this.session]);
    } catch {
      // session already gone
    }
  }

  /** The command a human runs to attach to this team's session. */
  attachCommand(): string {
    const sock = this.opts.socketName ? `-L ${this.opts.socketName} ` : '';
    return `tmux ${sock}attach -t ${this.session}`;
  }
}
