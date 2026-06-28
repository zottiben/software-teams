import type { PaneStatus } from '../types';

export type Unsubscribe = () => void;

/**
 * The engine-facing handle to one running harness pane.
 *
 * Implementations: `PtyPane` (a real node-pty `claude` process) and the test
 * `FakePane`. The broker drives panes purely through this interface and never
 * touches node-pty directly — that seam is what lets the entire comms loop be
 * unit-tested without spawning a real harness.
 *
 * Activity model: a pane is `busy` while the model is producing a turn and `idle`
 * when it is waiting for input. Delivery of a brokered message is only ever done
 * into an `idle` pane (writing to a busy interactive session would interleave
 * with the in-flight turn).
 */
export interface Pane {
  /** Addressable agent identity (matches {@link import('../types').AgentSpec.name}). */
  readonly name: string;

  /** Current lifecycle/activity state. */
  status(): PaneStatus;

  /** Write a full user turn: `text` followed by the submit keystroke. */
  submit(text: string): void;

  /** Raw stdin write with no submit (control sequences, partial input). */
  write(text: string): void;

  /** Resize the underlying terminal to match the view (cols × rows). */
  resize(cols: number, rows: number): void;

  /** Subscribe to raw output chunks streamed from the pane. */
  onOutput(listener: (chunk: string) => void): Unsubscribe;

  /** Subscribe to idle transitions (the pane finished a turn and awaits input). */
  onIdle(listener: () => void): Unsubscribe;

  /** Subscribe to process exit. */
  onExit(listener: (code: number) => void): Unsubscribe;

  /** Terminate the underlying process and release resources. */
  dispose(): Promise<void>;
}
