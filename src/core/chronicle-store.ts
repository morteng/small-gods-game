/**
 * chronicle-store.ts — the world's durable annals (M1 follow-up).
 *
 * The chronicler's bounded ring of daily entries, moved off the service and
 * into `GameState` so it rides the snapshot (StagingBuffer discipline, no
 * SAVE_VERSION bump). Two things this buys:
 *
 *  - the annals survive save/load — the boot loading screen can read a
 *    just-restored world's chronicle while the art settles ("while the world
 *    wakes, read what the monks wrote");
 *  - a timeline scrub rewinds the chronicle with the world — an annal about a
 *    day that un-happened un-happens with it (sim is truth; the record of the
 *    sim follows it).
 *
 * Plain display data; generation stays on `ChronicleService` (async, off the
 * sim tick). The store never touches the event log.
 */
import type { Season } from '@/core/calendar';

/** Bounded ring size — enough for a season of dailies without bloating saves. */
export const CHRONICLE_RING_CAP = 30;

export interface ChronicleEntry {
  /** The 0-based calendar day index this entry covers (see `core/calendar.ts`). */
  dayIndex: number;
  year: number;
  season: Season;
  dayOfYear: number;
  text: string;
  /** True when produced by the deterministic offline template — either no LLM
   *  client was configured, or the LLM call failed and this is the honest
   *  fallback (never a silent swallow). */
  offline: boolean;
  /** F6: true for an ERA entry — one entry summarizing a whole time-skip span
   *  (authored from the skip summary + the arcs that spanned it), rather than
   *  a single day. Optional so pre-F6 snapshots hydrate unchanged. */
  era?: boolean;
}

export class ChronicleStore {
  private ring: ChronicleEntry[] = [];

  /** Append an entry, evicting the oldest past the cap. */
  push(entry: ChronicleEntry): void {
    this.ring.push(structuredClone(entry));
    if (this.ring.length > CHRONICLE_RING_CAP) this.ring.shift();
  }

  /** Oldest first. */
  entries(): readonly ChronicleEntry[] {
    return this.ring;
  }

  latest(): ChronicleEntry | null {
    return this.ring.length ? this.ring[this.ring.length - 1] : null;
  }

  serialize(): ChronicleEntry[] {
    return structuredClone(this.ring);
  }

  hydrate(entries: ChronicleEntry[]): void {
    this.ring = structuredClone(entries).slice(-CHRONICLE_RING_CAP);
  }
}
