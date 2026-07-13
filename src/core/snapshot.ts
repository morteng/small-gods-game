import type { GameState } from '@/core/state';
import type { Entity, ActiveEvent, SettlementEventType } from '@/core/types';
import type { RngState } from '@/core/rng';
import type { Spirit } from '@/core/spirit';
import type { PlotThread } from '@/sim/threads/thread-types';
import type { StagedBeat } from '@/sim/threads/staging-types';
import type { WeatherSnapshot } from '@/sim/water/weather-stepper';
import type { CausalSiteSnapshot } from '@/world/causal-site';
import type { TrampleSnapshot } from '@/sim/trample';
import type { SettlementCohorts } from '@/sim/cohorts';
import { fromState } from '@/core/rng';
import { World } from '@/world/world';
import { TrampleGrid } from '@/sim/trample';
import { reconcileSettlementTiles } from '@/world/settlement-reconcile';

export interface Snapshot {
  /** Sim tick count at capture time. */
  tick: number;
  /** Serialized RNG state. */
  rng: RngState;
  /** Deep-cloned copies of every world entity. */
  entities: Entity[];
  /** Active settlement events keyed by POI id. */
  activeEvents: [string, ActiveEvent[]][];
  /** Fate's forced next-event per POI. Optional so older saves restore via `?? []`. */
  forcedEvents?: [string, SettlementEventType][];
  /** Complete deep-cloned copies of every spirit. Snapshot is authoritative. */
  spirits: Spirit[];
  /** Narrative substrate: recognized plot threads. Optional so pre-substrate
   *  saves and hand-built test snapshots deserialize without it (restore `?? []`). */
  threads?: PlotThread[];
  /** Narrative substrate: armed staged beats. Optional for the same reason. */
  staging?: StagedBeat[];
  /** W-G: water/atmosphere fields (flood depth, lake offsets, humidity/cloud/temp).
   *  Optional so pre-weather saves + partial test states deserialize without it. */
  weather?: WeatherSnapshot;
  /** W-G: ids of places currently latched as flooded (FloodWatch hysteresis state),
   *  so scrub/replay re-establishes the latch without re-firing flood edges. */
  floodedPlaces?: string[];
  /** W-I: live causal sites (ephemeral event-born places). Optional so pre-W-I saves
   *  + partial test states deserialize without it. */
  causalSites?: CausalSiteSnapshot;
  /** Desire-line trample grid (sparse accumulator + promoted-trail originals).
   *  Optional so pre-trample saves + partial test states deserialize without it. */
  trample?: TrampleSnapshot;
  /** WP-D scrub-ghost pattern: internal tick-system state keyed by system name
   *  (`SettlementEventSystem` cooldowns, `NpcSimSystem` edge sides,
   *  `AbandonmentSystem` believed/lapsed history). Optional — an absent field
   *  (old save / hand-built snapshot) resets every registered system cleanly. */
  systems?: Record<string, unknown>;
  /** Inland water-level offset (metres). A render parameter today; snapshotted
   *  as insurance so the value survives scrub/save once the climate seam drives
   *  it. Optional — absent field restores to 0 (the neutral datum). */
  waterLevelM?: number;
  /** Two-tier population (P1): the STATISTICAL cohort tier, sorted by poiId.
   *  Optional — pre-P1 saves and hand-built test snapshots restore to an empty
   *  tier (those worlds never had statistical souls). */
  statCohorts?: SettlementCohorts[];
}

export function captureSnapshot(state: GameState): Snapshot {
  return buildSnapshot(state, true);
}

/**
 * Snapshot that ALIASES live state (entities, spirits, active events) instead of
 * deep-cloning it. ~Half the cost of `captureSnapshot` on a big world — the
 * autosave path uses it because IndexedDB's `put()` structured-clones the value
 * synchronously anyway, so the deep copy here was paid twice.
 *
 * CONTRACT: the returned object is only coherent within the CURRENT task. Hand
 * it to a synchronous consumer (an IDB `put`, a `postMessage`) before yielding
 * to the event loop; never store it (the sim keeps mutating the aliased
 * objects — that's what `captureSnapshot` is for, e.g. the timeline ring).
 */
export function captureSnapshotLive(state: GameState): Snapshot {
  return buildSnapshot(state, false);
}

function buildSnapshot(state: GameState, deep: boolean): Snapshot {
  if (!state.world) {
    throw new Error('captureSnapshot: state.world is null — call after world seed');
  }
  const entities: Entity[] = deep
    ? state.world.query({}).map(e => ({ ...e, properties: structuredClone(e.properties) }))
    : state.world.query({});
  const spirits = deep
    ? Array.from(state.spirits.values()).map(s => structuredClone(s))
    : Array.from(state.spirits.values());
  const activeEvents: [string, ActiveEvent[]][] = [];
  for (const [poiId, events] of state.world.activeEvents) {
    activeEvents.push([poiId, deep ? structuredClone(events) : events]);
  }
  const forcedEvents: [string, SettlementEventType][] = [];
  for (const [poiId, type] of state.world.forcedEvents) forcedEvents.push([poiId, type]);
  return {
    tick: state.clock.now(),
    rng: state.rng.getState(),
    entities,
    activeEvents,
    forcedEvents,
    spirits,
    // Optional access: production states (createState) always have these; some
    // test harnesses cast a partial GameState that omits the substrate stores.
    threads: state.plotThreads?.serialize() ?? [],
    staging: state.staging?.serialize() ?? [],
    weather: state.weather?.serialize(),
    floodedPlaces: state.floodWatch?.floodedPlaceIds(),
    causalSites: state.causalSites?.serialize(),
    trample: state.trample?.serialize(),
    systems: state.systemState?.serialize(),
    waterLevelM: state.waterLevelM,
    statCohorts: state.cohorts
      ? [...state.cohorts.keys()].sort()
          .map(k => (deep ? structuredClone(state.cohorts.get(k)!) : state.cohorts.get(k)!))
      : undefined,
  };
}

export function restoreSnapshot(state: GameState, snap: Snapshot): void {
  // Only `map` is required: a fresh World is built from it below, and the old
  // state.world is never read. The resume-from-save path (applySaveFile) calls
  // this with state.world still null, so requiring a pre-existing world here
  // would wrongly throw and silently break autosave resume.
  if (!state.map) {
    throw new Error('restoreSnapshot: map not initialized');
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
  for (const [poiId, type] of snap.forcedEvents ?? []) fresh.forcedEvents.set(poiId, type);
  state.world = fresh;

  // Runtime growth mutates tiles + lot claims AFTER snapshots are taken;
  // re-derive both from the restored entities so scrub-back leaves no ghost
  // footprints and re-rolled growth can claim freed lots (S3).
  reconcileSettlementTiles(state.map, fresh);

  // Desire-line trails also mutate tiles in place (dirt) after a snapshot, so a
  // scrub-back must undo trails carved past the restore point. Rebuild the grid
  // from the snapshot (authoritative) and reconcile the map against it, handing
  // the PRE-restore grid so its extra trails can be reverted to real ground.
  if (snap.trample) {
    const prev = state.trample;
    const restored = TrampleGrid.fromSnapshot(snap.trample);
    restored.reconcileTiles(state.map, prev);
    state.trample = restored;
  } else if (state.trample) {
    // Pre-trample snapshot restored over a live grid: undo every trail it carved.
    const cleared = new TrampleGrid(state.map.width, state.map.height);
    cleared.reconcileTiles(state.map, state.trample);
    state.trample = cleared;
  }

  // `?? []` tolerates pre-substrate snapshots (older saves) with no threads field;
  // optional chaining tolerates partial test states that omit the substrate stores.
  state.plotThreads?.hydrate(snap.threads ?? []);
  state.staging?.hydrate(snap.staging ?? []);

  // W-G: restore the water fields + flood-watch latch so scrub/replay reproduce the
  // exact flood state (and don't re-fire edges for places already under water).
  if (snap.weather) state.weather?.hydrate(snap.weather);
  state.floodWatch?.hydrateFlooded(snap.floodedPlaces ?? []);
  // W-I: restore live causal sites (or clear them for a pre-W-I snapshot).
  state.causalSites?.hydrate(snap.causalSites ?? { sites: [], nextId: 0 });

  // WP-D scrub-ghost pattern: restore internal tick-system state (cooldowns,
  // edge-detection sides, believed/lapsed history) so a committed scrubbed
  // timeline can't inherit eligibility state from the discarded future. Absent
  // field (old save) → every registered system resets to its initial state.
  state.systemState?.hydrate(snap.systems);

  // Insurance: the inland water-level offset survives scrub/save (latent until
  // the climate seam drives it). Absent field → the neutral datum.
  state.waterLevelM = snap.waterLevelM ?? 0;

  // Two-tier population (P1): the snapshot is authoritative for the statistical
  // tier (counts are constant in P1, but restore exactly anyway so P2's flows
  // inherit correct semantics). Absent field (pre-P1 save) → empty tier.
  state.cohorts = new Map(
    (snap.statCohorts ?? []).map(sc => [sc.poiId, structuredClone(sc)] as const),
  );
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
