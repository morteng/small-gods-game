import type { GameState } from '@/core/state';
import type { Entity, ActiveEvent } from '@/core/types';
import type { RngState } from '@/core/rng';
import type { Spirit } from '@/core/spirit';
import type { PlotThread } from '@/sim/threads/thread-types';
import { fromState } from '@/core/rng';
import { World } from '@/world/world';

export interface Snapshot {
  /** Sim tick count at capture time. */
  tick: number;
  /** Number of events in the log at capture time. */
  eventId: number;
  /** Serialized RNG state. */
  rng: RngState;
  /** Deep-cloned copies of every world entity. */
  entities: Entity[];
  /** Active settlement events keyed by POI id. */
  activeEvents: [string, ActiveEvent[]][];
  /** Complete deep-cloned copies of every spirit. Snapshot is authoritative. */
  spirits: Spirit[];
  /** Narrative substrate: recognized plot threads. Optional so pre-substrate
   *  saves and hand-built test snapshots deserialize without it (restore `?? []`). */
  threads?: PlotThread[];
}

export function captureSnapshot(state: GameState): Snapshot {
  if (!state.world) {
    throw new Error('captureSnapshot: state.world is null — call after world seed');
  }
  const entities: Entity[] = state.world.query({}).map(e => ({
    ...e,
    properties: structuredClone(e.properties),
  }));
  const spirits = Array.from(state.spirits.values()).map(s => structuredClone(s));
  const activeEvents: [string, ActiveEvent[]][] = [];
  if (state.world) {
    for (const [poiId, events] of state.world.activeEvents) {
      activeEvents.push([poiId, structuredClone(events)]);
    }
  }
  return {
    tick: state.clock.now(),
    eventId: state.eventLog.size(),
    rng: state.rng.getState(),
    entities,
    activeEvents,
    spirits,
    threads: state.plotThreads.serialize(),
  };
}

export function restoreSnapshot(state: GameState, snap: Snapshot): void {
  if (!state.world || !state.map) {
    throw new Error('restoreSnapshot: world/map not initialized');
  }
  state.clock.setNow(snap.tick);
  state.rng = fromState(snap.rng);

  // Snapshot is authoritative: replace the spirits map wholesale so spirits
  // present at capture time are reinstated, and any added after capture are
  // dropped (matches "rewind == go back to that exact world" semantics).
  state.spirits.clear();
  for (const s of snap.spirits) {
    state.spirits.set(s.id, structuredClone(s));
  }

  const fresh = new World(state.map);
  for (const e of snap.entities) {
    fresh.addEntity({ ...e, properties: structuredClone(e.properties) });
  }
  for (const [poiId, events] of snap.activeEvents) {
    fresh.activeEvents.set(poiId, structuredClone(events));
  }
  state.world = fresh;

  // `?? []` tolerates pre-substrate snapshots (older saves) with no threads field.
  state.plotThreads.hydrate(snap.threads ?? []);
}

export interface SnapshotStoreOptions {
  capacity: number;
}

export class SnapshotStore {
  private readonly capacity: number;
  private buf: Snapshot[] = [];

  constructor(opts: SnapshotStoreOptions) {
    if (opts.capacity < 1) throw new Error('SnapshotStore capacity must be >= 1');
    this.capacity = opts.capacity;
  }

  push(snap: Snapshot): void {
    this.buf.push(snap);
    while (this.buf.length > this.capacity) this.buf.shift();
  }

  /**
   * Highest-tick snapshot with tick <= target, or null if none.
   * O(n) scan is fine: the buffer is bounded by capacity (40 by default)
   * and snapshots arrive in ascending tick order.
   */
  nearestAtOrBefore(tick: number): Snapshot | null {
    let best: Snapshot | null = null;
    for (const s of this.buf) {
      if (s.tick <= tick && (!best || s.tick > best.tick)) best = s;
    }
    return best;
  }

  truncateAfter(tick: number): void {
    this.buf = this.buf.filter(s => s.tick <= tick);
  }

  /** Empty the ring buffer. Used when a time-skip rebaselines the timeline so the
   *  pre-skip span (which has no recorded ticks) can never be scrubbed into. */
  reset(): void {
    this.buf = [];
  }

  list(): readonly Snapshot[] { return this.buf; }

  size(): number { return this.buf.length; }
}
