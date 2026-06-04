import type { GameState } from '@/core/state';
import type { TimelineController } from '@/core/timeline';
import { toSaveFile, type SaveFile } from '@/core/save-file';
import { writeSave } from '@/services/save-store';

export interface PersistenceDeps {
  state: GameState;
  /** Only `isScrubbed` is consulted — narrowed so tests can stub it trivially. */
  timeline: Pick<TimelineController, 'isScrubbed'>;
  /** Wall clock (injected so the sim stays Date.now-free and tests are deterministic). */
  now: () => number;
  /** Coalesce window for autosaves. Default 3000 ms. */
  throttleMs?: number;
  /** Injectable for tests; defaults to the IndexedDB save-store writer. */
  write?: (save: SaveFile) => Promise<void>;
}

/**
 * Throttled-on-change autosave. Subscribes to the event log; every meaningful
 * change marks the controller dirty and schedules at most one write per
 * `throttleMs`. Saves are gated on `!timeline.isScrubbed` so a scrubbed past is
 * never persisted as "current". Flushed on tab hide / unload.
 */
export class PersistenceController {
  private readonly state: GameState;
  private readonly timeline: Pick<TimelineController, 'isScrubbed'>;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly write: (save: SaveFile) => Promise<void>;

  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.flush();
  };
  private readonly onUnload = (): void => { void this.flush(); };

  constructor(deps: PersistenceDeps) {
    this.state = deps.state;
    this.timeline = deps.timeline;
    this.now = deps.now;
    this.throttleMs = deps.throttleMs ?? 3000;
    this.write = deps.write ?? writeSave;
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

  private async save(): Promise<void> {
    if (!this.dirty) return;
    // Never persist a scrubbed past as "current". Leave `dirty` set so the next
    // live save still fires once the player returns to the live timeline.
    if (this.timeline.isScrubbed) return;
    if (!this.state.world || !this.state.map) return;
    this.dirty = false;
    await this.write(toSaveFile(this.state, this.now()));
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
