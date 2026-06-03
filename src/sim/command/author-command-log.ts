/**
 * AuthorCommandLog — the replayable record of applied editor (god-mode) commands.
 *
 * Editor edits are exogenous: the LLM's choice is non-deterministic and cannot be
 * re-derived on replay. So we record the *resolved* command keyed by the tick it
 * applied, and the executor re-emits the entries due at each tick during silent
 * replay — they re-apply deterministically against the restored RNG stream.
 *
 * This is history, not transient input: unlike CommandQueue it is NOT cleared on
 * snapshot restore. It truncates on timeline commit/re-roll and resets on a
 * one-way time-skip baseline (no recorded ticks survive a skip to replay against).
 */
import type { Command } from './types';

export interface AuthorEntry {
  tick: number;
  command: Command;
}

export class AuthorCommandLog {
  private entries: AuthorEntry[] = [];

  /** Append an applied editor command at the tick it applied. */
  record(tick: number, command: Command): void {
    this.entries.push({ tick, command });
  }

  /** Commands recorded at exactly `tick`, in insertion order. */
  at(tick: number): Command[] {
    return this.entries.filter(e => e.tick === tick).map(e => e.command);
  }

  /** Drop entries strictly after `cutoff` (mirrors EventLog.truncateAfter). */
  truncateAfter(cutoff: number): void {
    this.entries = this.entries.filter(e => e.tick <= cutoff);
  }

  /** Clear all entries (one-way time-skip baseline). */
  reset(): void {
    this.entries = [];
  }

  all(): readonly AuthorEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }
}
