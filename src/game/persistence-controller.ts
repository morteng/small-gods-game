import type { GameState } from '@/core/state';
import type { TimelineController } from '@/core/timeline';
import type { AppendedEvent } from '@/core/events';
import { toSaveFileLive, type SaveFile } from '@/core/save-file';
import { writeSave, type SaveSlot, type SaveMetaInput } from '@/services/save-store';

/** A journal delta ready to append: everything since `from` (the slot's
 *  previous cursor). Mirrors `writeSave`'s `journal` parameter. */
export interface JournalDelta { events: AppendedEvent[]; from: number; }

export interface PersistenceDeps {
  state: GameState;
  /** Only `isScrubbed` is consulted — narrowed so tests can stub it trivially. */
  timeline: Pick<TimelineController, 'isScrubbed'>;
  /** Wall clock (injected so the sim stays Date.now-free and tests are deterministic). */
  now: () => number;
  /** Which slot the throttled autosave writes to. Default 'autosave'. */
  slot?: SaveSlot;
  /** Journal cursor to resume from — pass the resumed save's `eventCursor` so
   *  the FIRST autosave after a resume appends only events NEW since that
   *  save, instead of re-journaling everything already persisted under this
   *  slot. Default 0 (a fresh world, or a caller not yet wired to the resume
   *  path — degrades to re-journaling from scratch, never to data loss). */
  initialCursor?: number;
  /** Coalesce window for autosaves. Default 30 s (REAL time) — a save serializes
   *  the whole world on the main thread (hundreds of ms on a real map), so the
   *  cadence is a smoothness dial: at the old 3 s every play session hitched
   *  ~25% of its main-thread time into autosaves (profiled 2026-07-13). At 1:1
   *  realtime a crash loses ≤30 s of slow-moving world — nothing; tab hide /
   *  unload still flush immediately. */
  throttleMs?: number;
  /** Supplies the meta fields this controller cannot compute itself
   *  (dateLabel, godTier, beliefMass, playtimeMs, thumbnail) — injected rather
   *  than reached for on `Game`, so this module stays state-shaped rather than
   *  Game-shaped. Defaulted (a plain "Autosave" name, zeroed tier/mass/
   *  playtime, no thumbnail) so existing callers/tests keep working before a
   *  real provider is wired in. */
  meta?: () => SaveMetaInput;
  /** Injectable for tests; defaults to the atomic IndexedDB writer
   *  (`writeSave`). Receives a FACTORY: the writer must invoke it
   *  synchronously with its own persist step (see `writeSave`) because the
   *  built SaveFile aliases live state — plus the meta row and journal delta
   *  for this write, and the slot it's writing to. */
  write?: (
    makeSave: () => SaveFile,
    meta: SaveMetaInput,
    journal: JournalDelta,
    slot: SaveSlot,
  ) => Promise<void>;
}

/**
 * Throttled-on-change autosave. Subscribes to the event log; every meaningful
 * change marks the controller dirty and schedules at most one write per
 * `throttleMs`. Saves are gated on `!timeline.isScrubbed` so a scrubbed past is
 * never persisted as "current". Flushed on tab hide / unload.
 *
 * Each write persists only the JOURNAL DELTA since the slot's last cursor
 * (`state.eventLog.since(cursor)`), not the full history — the blob, its meta
 * row, and the delta land in one atomic IndexedDB transaction (`writeSave`).
 */
export class PersistenceController {
  private readonly state: GameState;
  private readonly timeline: Pick<TimelineController, 'isScrubbed'>;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly slot: SaveSlot;
  private readonly metaProvider: () => SaveMetaInput;
  private readonly write: (
    makeSave: () => SaveFile,
    meta: SaveMetaInput,
    journal: JournalDelta,
    slot: SaveSlot,
  ) => Promise<void>;

  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Per-slot journal high-water mark: `eventLog.since(cursor)` is the delta a
   *  write to that slot still owes the journal. A `Map` because `saveNow` can
   *  target a slot other than the configured autosave one, and each slot's
   *  history is journaled (and therefore cursored) independently. */
  private readonly cursors = new Map<SaveSlot, number>();

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.flush();
  };
  private readonly onUnload = (): void => { void this.flush(); };

  constructor(deps: PersistenceDeps) {
    this.state = deps.state;
    this.timeline = deps.timeline;
    this.now = deps.now;
    this.throttleMs = deps.throttleMs ?? 30_000;
    this.slot = deps.slot ?? 'autosave';
    this.metaProvider = deps.meta ?? ((): SaveMetaInput => ({
      name: 'Autosave',
      tick: this.state.clock.now(),
      dateLabel: '',
      godTier: '',
      beliefMass: 0,
      playtimeMs: 0,
      thumbnail: null,
    }));
    this.write = deps.write ?? ((makeSave, meta, journal, slot) => writeSave(makeSave, slot, meta, journal));
    if (deps.initialCursor !== undefined) this.cursors.set(this.slot, deps.initialCursor);
  }

  /**
   * Set a slot's journal cursor after construction.
   *
   * Needed because the controller is built in the `Game` constructor, LONG before
   * anyone knows whether this session is resuming a save. On a resume the events
   * already in the log came out of the journal (so they are persisted, and
   * re-journaling them would duplicate history); on a fresh world the cursor
   * belongs at 0 so the seed events are captured. Only the resume path calls this.
   */
  setCursor(slot: SaveSlot, from: number): void {
    this.cursors.set(slot, from);
  }

  start(): void {
    this.unsubscribe = this.state.eventLog.subscribe(() => this.markDirty());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('beforeunload', this.onUnload);
    }
  }

  markDirty(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, this.throttleMs);
  }

  /** Force an immediate save if dirty and not scrubbed. */
  async flush(): Promise<void> {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    await this.save();
  }

  /**
   * Manual save to an explicit slot (the `save_slot` meta verb). Bypasses the
   * dirty/throttle/scrub gates that guard the autosave path — a manual save
   * always writes if a world exists, even a scrubbed one (the player asked
   * for THIS moment). `name` overrides the meta provider's name for this
   * write only; omit to keep the provider's default.
   */
  async saveNow(slot: SaveSlot, name?: string): Promise<void> {
    await this.doWrite(slot, name);
    // A manual save to the SAME slot the throttled autosave targets subsumes
    // whatever it owed — clear its dirty flag/timer so it doesn't immediately
    // re-fire a redundant (now empty) delta write.
    if (slot === this.slot) {
      this.dirty = false;
      if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    }
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    // Never persist a scrubbed past as "current". Leave `dirty` set so the next
    // live save still fires once the player returns to the live timeline.
    if (this.timeline.isScrubbed) return;
    if (!this.state.world || !this.state.map) return;
    this.dirty = false;
    await this.doWrite(this.slot);
  }

  private async doWrite(slot: SaveSlot, nameOverride?: string): Promise<void> {
    if (!this.state.world || !this.state.map) return;
    const from = this.cursors.get(slot) ?? 0;
    const events = this.state.eventLog.since(from);
    const base = this.metaProvider();
    const meta: SaveMetaInput = nameOverride !== undefined ? { ...base, name: nameOverride } : base;
    // Live-reference save: the writer invokes the factory synchronously with its
    // IDB put (put's structured clone captures the state atomically), so the
    // world is deep-copied ONCE per save instead of twice.
    await this.write(
      () => toSaveFileLive(this.state, this.now(), meta.playtimeMs),
      meta,
      { events, from },
      slot,
    );
    this.cursors.set(slot, events.length > 0 ? events[events.length - 1].id : from);
  }

  destroy(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('beforeunload', this.onUnload);
    }
  }
}
