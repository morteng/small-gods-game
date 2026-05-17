// src/core/timeline.ts
import type { GameState } from '@/core/state';
import type { Scheduler } from '@/core/scheduler';
import { SnapshotStore, captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import { SilentEventLog, type AppendedEvent } from '@/core/events';
import { createRng } from '@/core/rng';

export interface TimelineOptions {
  state: GameState;
  scheduler: Scheduler;
  /** Capture a snapshot every N events appended to the live log. Default 50. */
  snapshotEveryNEvents?: number;
  /** Ring-buffer capacity for snapshots. Default 40. */
  snapshotCapacity?: number;
}

interface DiscardedTail {
  parentTick: number;
  events: AppendedEvent[];
  rerolled: boolean;
}

const SIM_STEP_MS = 1000 / 60;

export class TimelineController {
  private readonly state: GameState;
  private readonly scheduler: Scheduler;
  private readonly store: SnapshotStore;
  private readonly snapEveryN: number;
  private readonly silentLog: SilentEventLog;

  private liveSnapshot: Snapshot | null = null;
  private lastSnapshotEventCount = 0;
  private _isScrubbed = false;
  private discardedFutures: DiscardedTail[] = [];

  constructor(opts: TimelineOptions) {
    this.state = opts.state;
    this.scheduler = opts.scheduler;
    this.snapEveryN = opts.snapshotEveryNEvents ?? 50;
    this.store = new SnapshotStore({ capacity: opts.snapshotCapacity ?? 40 });
    this.silentLog = new SilentEventLog(this.state.clock);
  }

  get isScrubbed(): boolean { return this._isScrubbed; }
  get currentTick(): number { return this.state.clock.now(); }
  get maxTick(): number {
    return this.liveSnapshot ? this.liveSnapshot.tick : this.state.clock.now();
  }

  /** Called by game.ts after every live (non-scrubbed) scheduler.tick. */
  onAfterLiveTick(): void {
    if (this._isScrubbed) return;
    const evNow = this.state.eventLog.size();
    if (evNow - this.lastSnapshotEventCount >= this.snapEveryN || this.store.size() === 0) {
      this.store.push(captureSnapshot(this.state));
      this.lastSnapshotEventCount = evNow;
    }
  }

  jumpTo(targetTick: number): void {
    if (!this._isScrubbed) {
      this.liveSnapshot = captureSnapshot(this.state);
      this._isScrubbed = true;
    }
    // Clamp so forwardSilent can never loop past the most recent live tick.
    const clamped = Math.min(Math.max(0, targetTick), this.maxTick);
    const snap = this.store.nearestAtOrBefore(clamped);
    if (!snap) {
      if (this.liveSnapshot && this.liveSnapshot.tick >= clamped) {
        restoreSnapshot(this.state, this.liveSnapshot);
        this.scheduler.resetAccumulators();
      }
      return;
    }
    restoreSnapshot(this.state, snap);
    this.scheduler.resetAccumulators();
    this.forwardSilent(clamped);
  }

  returnToLive(): void {
    if (!this._isScrubbed || !this.liveSnapshot) return;
    restoreSnapshot(this.state, this.liveSnapshot);
    this.scheduler.resetAccumulators();
    this.liveSnapshot = null;
    this._isScrubbed = false;
  }

  commit(opts: { reroll: boolean }): void {
    if (!this._isScrubbed) return;
    const cutoff = this.state.clock.now();
    const tail = this.state.eventLog.since(0).filter(e => e.t > cutoff);
    this.discardedFutures.push({
      parentTick: cutoff,
      events: tail,
      rerolled: opts.reroll,
    });
    this.state.eventLog.truncateAfter(cutoff);
    this.store.truncateAfter(cutoff);
    if (opts.reroll) {
      const newSeed = this.state.rng.nextInt(0x7fffffff);
      this.state.rng = createRng(newSeed);
    }
    this.liveSnapshot = null;
    this._isScrubbed = false;
    this.lastSnapshotEventCount = this.state.eventLog.size();
  }

  getDiscardedFutures(): readonly DiscardedTail[] { return this.discardedFutures; }

  private forwardSilent(targetTick: number): void {
    const baseCtx = {
      world: this.state.world!,
      spirits: this.state.spirits,
      log: this.silentLog,
      clock: this.state.clock,
      rng: this.state.rng,
    };
    while (this.state.clock.now() < targetTick) {
      this.scheduler.tick(SIM_STEP_MS, baseCtx);
    }
  }
}

