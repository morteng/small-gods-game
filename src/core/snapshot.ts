import type { GameState } from '@/core/state';
import type { Entity, ActiveEvent, SettlementEventType } from '@/core/types';
import type { RngState } from '@/core/rng';
import type { Spirit } from '@/core/spirit';
import type { PlotThread } from '@/sim/threads/thread-types';
import type { StagedBeat } from '@/sim/threads/staging-types';
import type { FateArc } from '@/sim/fate/arc-types';
import type { ChronicleEntry } from '@/core/chronicle-store';
import type { WeatherSnapshot } from '@/sim/water/weather-stepper';
import type { CausalSiteSnapshot } from '@/world/causal-site';
import type { RuntimePoiSnapshot } from '@/world/runtime-poi';
import type { TrampleSnapshot } from '@/sim/trample';
import { RoadUseTally, type RoadUseSnapshot } from '@/world/road-use';
import { reconcileCrossingTiers, type CrossingTierSnapshot } from '@/world/crossing-tier-store';
import type { SettlementCohorts } from '@/sim/cohorts';
import type { LordState } from '@/sim/lord';
import { fromState } from '@/core/rng';
import { World } from '@/world/world';
import { TrampleGrid } from '@/sim/trample';
import { reconcileSettlementTiles } from '@/world/settlement-reconcile';
import { projectRuntimePois, reconcileRuntimePoiStamps, rebuildDominions } from '@/world/runtime-poi';

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
  /** M3 (mortal power): the lord's seat per settlement. Optional so pre-lord
   *  saves + hand-built test snapshots restore to no seated lords (LordSystem
   *  re-attaches from the living nobles within a game hour). */
  lords?: [string, LordState][];
  /** Complete deep-cloned copies of every spirit. Snapshot is authoritative. */
  spirits: Spirit[];
  /** Narrative substrate: recognized plot threads. Optional so pre-substrate
   *  saves and hand-built test snapshots deserialize without it (restore `?? []`). */
  threads?: PlotThread[];
  /** Narrative substrate: armed staged beats. Optional for the same reason. */
  staging?: StagedBeat[];
  /** Track 4 (Proactive Fate): Fate's long-range arcs. Optional so pre-arc saves +
   *  hand-built test snapshots restore to an empty arc set. `ArcGoal.met` is NOT
   *  trusted from disk — it is recomputed against the restored world on restore. */
  fateArcs?: FateArc[];
  /** M1: the chronicler's annals. Optional so pre-chronicle saves + hand-built
   *  test snapshots restore to an empty ring. */
  chronicle?: ChronicleEntry[];
  /** W-G: water/atmosphere fields (flood depth, lake offsets, humidity/cloud/temp).
   *  Optional so pre-weather saves + partial test states deserialize without it. */
  weather?: WeatherSnapshot;
  /** W-G: ids of places currently latched as flooded (FloodWatch hysteresis state),
   *  so scrub/replay re-establishes the latch without re-firing flood edges. */
  floodedPlaces?: string[];
  /** W-I: live causal sites (ephemeral event-born places). Optional so pre-W-I saves
   *  + partial test states deserialize without it. */
  causalSites?: CausalSiteSnapshot;
  /** M4: permanent runtime-created POIs (the lord's castle) + the physical stamp
   *  each owns. Restore re-projects `worldSeed.pois` and reconciles the owned
   *  `map.earthworks`/`map.barrierRuns`, so a scrub to before a foundation
   *  un-builds it. Optional so pre-M4 saves + hand-built test snapshots restore
   *  to an empty store (no SAVE_VERSION bump — the established optional-field
   *  precedent, spike §1.8). */
  runtimePois?: RuntimePoiSnapshot;
  /** Desire-line trample grid (sparse accumulator + promoted-trail originals).
   *  Optional so pre-trample saves + partial test states deserialize without it. */
  trample?: TrampleSnapshot;
  /** Road-wear economy (S1): the inter-fold raw footfall tally per edge (`sinceTick` + sparse
   *  `[edgeId, count][]`). The FOLDED `edge.use` EMA rides `SaveFile.map` with the graph, not
   *  here — only the transient counter needs to scrub with the timeline. Optional so pre-S1
   *  saves + partial test states restore to an empty tally. */
  roadUse?: RoadUseSnapshot;
  /** Road-wear economy (S3): runtime crossing upgrades — the store of every crossing whose
   *  BUILT span deviates from the gen pick (+ its accruing streaks). Span ENTITIES ride
   *  `entities` above; restore reconciles the two (`reconcileCrossingTiers`) so a scrub to
   *  before an upgrade shows the log again and forward rebuilds byte-identically. Optional
   *  so pre-S3 saves + partial test states restore to an empty store. */
  crossingTiers?: CrossingTierSnapshot;
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
  const lords: [string, LordState][] = [];
  for (const [poiId, seat] of state.world.lords) {
    lords.push([poiId, deep ? structuredClone(seat) : seat]);
  }
  return {
    tick: state.clock.now(),
    rng: state.rng.getState(),
    entities,
    activeEvents,
    forcedEvents,
    lords,
    spirits,
    // Optional access: production states (createState) always have these; some
    // test harnesses cast a partial GameState that omits the substrate stores.
    threads: state.plotThreads?.serialize() ?? [],
    staging: state.staging?.serialize() ?? [],
    fateArcs: state.fateArcs?.serialize() ?? [],
    chronicle: state.chronicle?.serialize() ?? [],
    weather: state.weather?.serialize(),
    floodedPlaces: state.floodWatch?.floodedPlaceIds(),
    causalSites: state.causalSites?.serialize(),
    // Optional chaining: partial test states may omit the store; `serialize()`
    // deep-clones internally (entries are tiny), so the live/deep split is moot.
    runtimePois: state.runtimePois?.serialize(),
    trample: state.trample?.serialize(),
    roadUse: state.roadUse?.serialize(),
    crossingTiers: state.crossingTiers?.serialize(),
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
  // M3: the lord's seats restore with the world (a scrub un-seats a lord who
  // rose after the restore point); pre-lord snapshots restore to no seats.
  for (const [poiId, seat] of snap.lords ?? []) fresh.lords.set(poiId, structuredClone(seat));
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

  // Road-wear economy (S1): the raw footfall tally scrubs with the timeline (the folded
  // `edge.use` rides the map, not the snapshot). Snapshot is authoritative — rebuild from it, or
  // reset to an empty tally for a pre-S1 snapshot so a scrub past a fold can't inherit future
  // counts. No tile reconcile needed: the tally is pure counters, not a map projection.
  state.roadUse = snap.roadUse ? RoadUseTally.fromSnapshot(snap.roadUse) : new RoadUseTally();

  // `?? []` tolerates pre-substrate snapshots (older saves) with no threads field;
  // optional chaining tolerates partial test states that omit the substrate stores.
  state.plotThreads?.hydrate(snap.threads ?? []);
  state.staging?.hydrate(snap.staging ?? []);

  // Track 4 (Proactive Fate): restore Fate's arcs (or clear them for a pre-arc
  // snapshot). Arc state is sim truth, so a scrub un-happens any arc opened after
  // the restore point. `ArcGoal.met` is recomputed against the just-restored world
  // — the persisted value is never trusted (spec §4.1).
  state.fateArcs?.hydrate(snap.fateArcs ?? []);
  state.fateArcs?.recomputeGoals(state);

  // M1: the annals scrub WITH the timeline — an entry about a day that
  // un-happened un-happens with it (pre-chronicle snapshots restore empty).
  state.chronicle?.hydrate(snap.chronicle ?? []);

  // W-G: restore the water fields + flood-watch latch so scrub/replay reproduce the
  // exact flood state (and don't re-fire edges for places already under water).
  if (snap.weather) state.weather?.hydrate(snap.weather);
  state.floodWatch?.hydrateFlooded(snap.floodedPlaces ?? []);
  // W-I: restore live causal sites (or clear them for a pre-W-I snapshot).
  state.causalSites?.hydrate(snap.causalSites ?? { sites: [], nextId: 0 });

  // M4: restore the runtime-POI store (or clear it for a pre-M4 snapshot), then
  // re-assert BOTH of its world projections: the POI directory (`worldSeed.pois`
  // — a scrub un-lists a castle founded after the restore point, and a stale
  // save projection is dropped as an orphan) and the physical stamp
  // (`map.earthworks`/`map.barrierRuns` — the motte, ditch and walls un-build /
  // re-build with the store; the deformation memo re-keys off the counts, and
  // no `tile.type` is written so no `bumpTilesRev`). Barrier/keep ENTITIES come
  // back via `snap.entities` above — this keeps the map-level dual
  // representation in lockstep with them.
  if (state.runtimePois) {
    state.runtimePois.hydrate(snap.runtimePois ?? { entries: [], nextId: 1 });
    projectRuntimePois(state.runtimePois, [state.worldSeed, state.map.worldSeed]);
    reconcileRuntimePoiStamps(state.map, state.runtimePois);
    // M5: dominion links are DERIVED from store provenance — rebuild them on the
    // fresh World so the knights' extraction reach (`titheRateFor`) is correct
    // immediately after a scrub, not one game hour later. Grip transition
    // memory (`gripsPoiId`) rides the snapshotted LordState above.
    rebuildDominions(fresh.dominions, state.runtimePois);
  }

  // Road-wear S3: restore the crossing-tier store (or clear it for a pre-S3 snapshot),
  // then reconcile world entities against it. Span entities already rode `snap.entities`
  // above, so after a normal scrub both sides agree — the reconcile is the idempotent
  // guard for divergence (a stale save): it rebuilds a missing store span byte-identically,
  // keeps the gen span it replaced absent, and evicts orphaned store spans.
  if (state.crossingTiers) {
    state.crossingTiers.hydrate(snap.crossingTiers ?? { entries: [] });
    reconcileCrossingTiers(fresh, state.map, state.crossingTiers);
  }

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
