/**
 * CommandQueue — a transient FIFO of pending commands.
 *
 * This is pending *input* (like a keypress), NOT sim state: it is never part of a
 * snapshot, and `TimelineController` calls `clear()` on every restore so scrubbing
 * drops in-flight commands. The executor drains it at the top of each tick.
 */
import type { Command } from './types';

export class CommandQueue {
  private pending: Command[] = [];
  private seqCounter = 0;

  /** Enqueue a command; stamps a monotonic `seq`. */
  emit(cmd: Omit<Command, 'seq'>): void {
    this.pending.push({ ...cmd, seq: this.seqCounter++ });
  }

  /** Return all pending commands in FIFO order and empty the queue. */
  drain(): Command[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Drop all pending commands (e.g. on snapshot restore). Does not reset `seq`. */
  clear(): void {
    this.pending = [];
  }

  size(): number {
    return this.pending.length;
  }
}
