// Road-wear economy S3 — the CROSSING TIER STORE + stepper + reconcile (src/world/crossing-tier-
// store.ts). Mirrors the S2 tick-system discipline (`road-class-system.test.ts`): a stubbed World +
// a minimal GameMap, hand-authored road/edge state, and the pure store driven through the SAME year-
// pass functions the sim + time-skip call. Covers:
//   B  the snapshot store (round-trip, deep-clone aliasing both ways, sorted order);
//   C  `stepCrossingTiers` — the edge half (against a REAL shared opening) and the corridor half;
//   D  `standingSpanTier` (store entry vs probed gen span);
//   E  `reconcileCrossingTiers` (rebuild / evict / idempotent);
//   F  `buildTierSpanEntity` (determinism, axis quarter-turn, liftElev);
//   G  skip parity — the class ladder promoting AND the crossing tier following it up (LAG), driven
//      through `projectRoadClassesOverSkip`'s onSubStep hook exactly as `time-skip.ts` does.
//
// Strategy note (C, edge half): `stepCrossingTiers` enumerates graph crossings via
// `getCrossingOpenings(map)`, which memoises `detectCrossings` over the RENDER water mask. We build
// the MINIMAL real map that makes it return one opening — a grass tile grid with a vertical `water`
// column and a horizontal road polyline whose `bridgeCells` land on the column (the render mask
// degrades to the tile grid when a map carries no hydrology, so tile-water IS the visible water).
// So the edge half runs the true production path, not a stub — no fallback to units was needed.
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { clearRenderWaterTypeCache } from '@/render/gpu/render-water-mask';
import { World } from '@/world/world';
import {
  CrossingTierStore, buildTierSpanEntity, standingSpanTier, stepCrossingTiers,
  reconcileCrossingTiers, tierEntityIdFor,
  type CrossingTierEntry, type StepCrossingTiersOpts,
} from '@/world/crossing-tier-store';
import { projectRoadClassesOverSkip, type RoadUseFoldInputs, type EdgeClassInputs } from '@/world/road-use';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { CorridorCrossingSite } from '@/world/corridor-crossings';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { RoadEdge } from '@/world/road-graph';

beforeEach(() => {
  ensureBuildingTypesRegistered();
  // The render-water mask memoises on (seed, dims); clear it so two maps that share seed+dims but
  // differ in water can't read each other's cached ribbon.
  clearRenderWaterTypeCache();
});

const W = 20, H = 10;
/** A grass map (flat terrain so `buildTierSpanEntity`'s composed heightfield is a clean plane) with
 *  the given `water` columns, and an optional road graph. `flatHeight` also skips the seeded height
 *  build, keeping the entity seat elevation a pure constant. */
function gridMap(waterCols: number[], edges: RoadEdge[] | null, seed = 1): GameMap {
  const cols = new Set(waterCols);
  const tiles: Tile[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => {
      const isW = cols.has(x);
      return { type: isW ? 'water' : 'grass', x, y, walkable: !isW, state: 'realized' as const };
    }));
  return {
    tiles, width: W, height: H, villages: [], seed, success: true, flatHeight: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    ...(edges ? { roadGraph: { nodes: [], edges, rev: 0 } } : {}),
  } as unknown as GameMap;
}

/** A horizontal road at y=5 crossing the water column at x=9,10 (bridgeCells land on it), so
 *  `getCrossingOpenings` yields exactly one crossing `crossing@e0#0` with banks (8,5)–(11,5),
 *  span 3, axis [1,0]. `ema01` seeds the earned tier; class/wealth complete the `tierForUse`. */
function roadEdge(ema01: number, cls: RoadEdge['class'] = 'road'): RoadEdge {
  const poly = Array.from({ length: 13 }, (_, i) => ({ x: 4 + i, y: 5 }));
  const bridgeCells = poly.filter((p) => p.x === 9 || p.x === 10).map((p) => p.y * W + p.x);
  return {
    id: 'e0', a: 'n0', b: 'n1', polyline: poly, feature: 'road', class: cls, surface: 'dirt',
    bridgeCells, use: { ema01, tallies: 0, sinceTick: 0 },
  } as RoadEdge;
}

/** A gen-time span entity `<crossingId>-bridge` with a stubbed resolved blueprint — the exact shape
 *  `standingSpanTier` probes (`properties.blueprint.rb`). `walls` / a part `type:'arch_span'` select
 *  the tier the physical span represents. */
function genSpan(crossingId: string, rb: Record<string, unknown>, x = 10, y = 5): Entity {
  return {
    id: `${crossingId}-bridge`, kind: 'bridge', x, y, tags: [],
    properties: { blueprint: { rb } },
  } as unknown as Entity;
}

/** The full opts for one edge-half apply against a map's own graph. */
function edgeOpts(world: World, map: GameMap, store: CrossingTierStore, nowTick: number, wealth = 0.9): StepCrossingTiersOpts {
  return { world, map, store, nowTick, wealthFor: () => wealth };
}

// ── B · the snapshot store ────────────────────────────────────────────────────
describe('CrossingTierStore — snapshot serialize / hydrate', () => {
  function entry(id: string, over: Partial<CrossingTierEntry> = {}): CrossingTierEntry {
    return {
      crossingId: id, kind: 'edge', edgeId: 'e0', tier: 3, upStreak: 0, upgradedAtTick: 100,
      entityId: tierEntityIdFor(id), banks: [{ x: 8, y: 5 }, { x: 11, y: 5 }], axis: [1, 0], spanTiles: 3,
      ...over,
    };
  }

  it('round-trips through serialize → hydrate byte-for-byte', () => {
    const store = new CrossingTierStore();
    store.upsert(entry('c1'));
    store.upsert(entry('c2', { tier: 5 }));
    const restored = new CrossingTierStore();
    restored.hydrate(store.serialize());
    expect(restored.all()).toEqual(store.all());
  });

  it('serialize DEEP-CLONES — mutating the snapshot never touches live entries (the RuntimePoiStore lesson)', () => {
    const store = new CrossingTierStore();
    store.upsert(entry('c1'));
    const snap = store.serialize();
    // Mutate the snapshot's nested geometry.
    snap.entries[0].tier = 6;
    snap.entries[0].banks[0].x = -999;
    // The live entry is untouched.
    expect(store.byId('c1')!.tier).toBe(3);
    expect(store.byId('c1')!.banks[0].x).toBe(8);
  });

  it('hydrate DEEP-CLONES the incoming side too — mutating a live entry never touches the source snapshot', () => {
    const source = new CrossingTierStore();
    source.upsert(entry('c1'));
    const snap = source.serialize();
    const store = new CrossingTierStore();
    store.hydrate(snap);
    // Mutate the hydrated live entry in place.
    store.byId('c1')!.tier = 6;
    store.byId('c1')!.banks[0].x = -1;
    // The snapshot the store was restored from is unaffected.
    expect(snap.entries[0].tier).toBe(3);
    expect(snap.entries[0].banks[0].x).toBe(8);
  });

  it('serializes in deterministic crossingId-sorted order regardless of insertion order', () => {
    const store = new CrossingTierStore();
    store.upsert(entry('c3'));
    store.upsert(entry('c1'));
    store.upsert(entry('c2'));
    expect(store.serialize().entries.map((e) => e.crossingId)).toEqual(['c1', 'c2', 'c3']);
  });
});

// ── C · stepCrossingTiers — the EDGE half (real shared opening) ────────────────
describe('stepCrossingTiers — edge crossings (real getCrossingOpenings)', () => {
  const CID = 'crossing@e0#0';

  it('streaks for N_UP applies, then lays the earned span; world gains the store entity, from is undefined', () => {
    // High use + wealthy endpoints ⇒ earned = 5; span 3 ⇒ first buildable rung is the plank walk (3)
    // (the twin/rail logs can't span 3). Nothing stood before (no gen span) ⇒ `from` is honestly absent.
    const map = gridMap([9, 10], [roadEdge(0.9)]);
    const world = new World(map);
    const store = new CrossingTierStore();

    const first = stepCrossingTiers(edgeOpts(world, map, store, 1000));
    expect(first).toEqual([]);                              // streak apply — nothing built yet
    expect(store.byId(CID)).toMatchObject({ tier: 0, upStreak: 1 });
    expect(store.byId(CID)!.entityId).toBeUndefined();
    expect(world.registry.get(tierEntityIdFor(CID))).toBeUndefined();

    const second = stepCrossingTiers(edgeOpts(world, map, store, 2000));
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ crossingId: CID, to: 3, edgeId: 'e0' });
    expect(second[0].from).toBeUndefined();                 // nothing stood here before
    expect(world.registry.get(tierEntityIdFor(CID))).toBeDefined();
    expect(store.byId(CID)).toMatchObject({ tier: 3, entityId: tierEntityIdFor(CID), upgradedAtTick: 2000 });
  });

  it('replaces a GEN span on first deviation: from = the gen tier, gen span removed, replacedEntityId recorded', () => {
    // A gen-time plank-deck span (no stone, no arch → GEN_BRIDGE_CLASS_TIER['log-plank'] = 3) stands.
    // Earned 5 ⇒ the crossing climbs to the framed beam (4). The gen span is swapped out, not left.
    const map = gridMap([9, 10], [roadEdge(0.9)]);
    const world = new World(map);
    world.addEntity(genSpan(CID, { parts: [{ type: 'deck' }] }));
    const store = new CrossingTierStore();

    stepCrossingTiers(edgeOpts(world, map, store, 1000)); // streak (built = 3 from the gen span)
    const ups = stepCrossingTiers(edgeOpts(world, map, store, 2000));
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ crossingId: CID, from: 3, to: 4 }); // gen tier → framed beam
    expect(world.registry.get(`${CID}-bridge`)).toBeUndefined();       // gen span removed
    expect(world.registry.get(tierEntityIdFor(CID))).toBeDefined();    // store span raised
    expect(store.byId(CID)!.replacedEntityId).toBe(`${CID}-bridge`);
  });

  it('prunes a streak-only edge entry once the earned tier falls back (the store records deviations only)', () => {
    const edge = roadEdge(0.9);
    const map = gridMap([9, 10], [edge]);
    const world = new World(map);
    const store = new CrossingTierStore();

    stepCrossingTiers(edgeOpts(world, map, store, 1000));  // streak entry, upStreak 1
    expect(store.byId(CID)).toBeDefined();
    edge.use!.ema01 = 0;                                    // traffic collapses ⇒ earned 0, nothing buildable
    const ups = stepCrossingTiers(edgeOpts(world, map, store, 2000));
    expect(ups).toEqual([]);
    expect(store.byId(CID)).toBeUndefined();               // pruned — nothing was ever built
    expect(world.registry.get(tierEntityIdFor(CID))).toBeUndefined();
  });
});

// ── C · stepCrossingTiers — the CORRIDOR half (§9 decision 4: the trail gets its log) ──
describe('stepCrossingTiers — corridor sites (the promoted trail earns its tier-0 log)', () => {
  /** A corridor site literal (no trample needed — the stepper takes sites directly). Default span
   *  2 tiles ⇒ a log CAN carry it (MAX_SPAN[0] = 2). */
  function site(corridorId: string, spanTiles = 2): CorridorCrossingSite {
    return {
      corridorId, banks: [{ x: 3, y: 5 }, { x: 3 + spanTiles, y: 5 }], water: [], axis: [1, 0], spanTiles,
    };
  }
  /** Corridor-only opts: a map WITHOUT a road graph, so the edge half is skipped and the sites drive. */
  function corridorOpts(world: World, map: GameMap, store: CrossingTierStore, nowTick: number, sites: CorridorCrossingSite[]): StepCrossingTiersOpts {
    return { world, map, store, nowTick, wealthFor: () => 0, corridorSites: sites };
  }

  it('streaks for N_UP applies, then lays the tier-0 log; upgrade from is undefined, world gains the entity', () => {
    const map = gridMap([], null);
    const world = new World(map);
    const store = new CrossingTierStore();
    const sites = [site('corridor:3,5')];
    const eid = tierEntityIdFor('corridor:3,5');

    const first = stepCrossingTiers(corridorOpts(world, map, store, 1000, sites));
    expect(first).toEqual([]);                              // streak — no log yet
    expect(store.byId('corridor:3,5')).toMatchObject({ kind: 'corridor', tier: 0, upStreak: 1 });
    expect(store.byId('corridor:3,5')!.entityId).toBeUndefined();
    expect(world.registry.get(eid)).toBeUndefined();

    const second = stepCrossingTiers(corridorOpts(world, map, store, 2000, sites));
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ crossingId: 'corridor:3,5', to: 0 });
    expect(second[0].from).toBeUndefined();                 // the founding log — nothing precedes it
    expect(second[0].edgeId).toBeUndefined();               // not a graph crossing
    expect(world.registry.get(eid)).toBeDefined();
    expect(store.byId('corridor:3,5')).toMatchObject({ tier: 0, entityId: eid, upgradedAtTick: 2000 });
  });

  it('a site too wide for a log (span > MAX_SPAN[0]) is left alone — that is a ford, not a bridge', () => {
    const map = gridMap([], null);
    const world = new World(map);
    const store = new CrossingTierStore();
    const sites = [site('corridor:3,5', 3)];               // span 3 > log's 2-tile reach
    stepCrossingTiers(corridorOpts(world, map, store, 1000, sites));
    stepCrossingTiers(corridorOpts(world, map, store, 2000, sites));
    expect(store.byId('corridor:3,5')).toBeUndefined();    // never streaked — nothing to build
    expect(world.query({})).toHaveLength(0);
  });

  it('a standing log whose corridor vanished STAYS — rule 2, the log outlives the trail that earned it', () => {
    const map = gridMap([], null);
    const world = new World(map);
    const store = new CrossingTierStore();
    const sites = [site('corridor:3,5')];
    stepCrossingTiers(corridorOpts(world, map, store, 1000, sites));
    stepCrossingTiers(corridorOpts(world, map, store, 2000, sites)); // log laid
    const eid = tierEntityIdFor('corridor:3,5');
    expect(world.registry.get(eid)).toBeDefined();

    // The trail decays away entirely — no sites this pass.
    const ups = stepCrossingTiers(corridorOpts(world, map, store, 3000, []));
    expect(ups).toEqual([]);
    expect(store.byId('corridor:3,5')!.entityId).toBe(eid); // entry kept
    expect(world.registry.get(eid)).toBeDefined();          // log still stands
  });

  it('a streak-ONLY entry whose site vanished before the log was laid prunes', () => {
    const map = gridMap([], null);
    const world = new World(map);
    const store = new CrossingTierStore();
    stepCrossingTiers(corridorOpts(world, map, store, 1000, [site('corridor:3,5')])); // streak 1, no entity
    expect(store.byId('corridor:3,5')).toMatchObject({ upStreak: 1 });
    expect(store.byId('corridor:3,5')!.entityId).toBeUndefined();
    const ups = stepCrossingTiers(corridorOpts(world, map, store, 2000, [])); // trail gone before N_UP
    expect(ups).toEqual([]);
    expect(store.byId('corridor:3,5')).toBeUndefined();     // pruned
  });

  it('determinism: two identical fresh runs → identical store snapshots AND entity ids', () => {
    const build = (): { snap: unknown; ids: string[] } => {
      const map = gridMap([], null);
      const world = new World(map);
      const store = new CrossingTierStore();
      const sites = [site('corridor:3,5'), site('corridor:7,5')];
      stepCrossingTiers(corridorOpts(world, map, store, 1000, sites));
      stepCrossingTiers(corridorOpts(world, map, store, 2000, sites));
      return { snap: store.serialize(), ids: world.query({}).map((e) => e.id).sort() };
    };
    const a = build();
    const b = build();
    expect(a.snap).toEqual(b.snap);
    expect(a.ids).toEqual(b.ids);
    expect(a.ids).toEqual([tierEntityIdFor('corridor:3,5'), tierEntityIdFor('corridor:7,5')].sort());
  });
});

// ── D · standingSpanTier ──────────────────────────────────────────────────────
describe('standingSpanTier — the tier the CURRENT standing span represents', () => {
  it('a store entry reports its own built tier (authoritative — no probing)', () => {
    const world = new World(gridMap([], null));
    const entry = { tier: 4 } as CrossingTierEntry;
    expect(standingSpanTier(world, 'cx', entry)).toBe(4);
  });

  it('with no entry, probes the gen span: stone walls → 6, timber arch → 5, no arch → 3, no span → 0', () => {
    const world = new World(gridMap([], null));
    world.addEntity(genSpan('stone', { materials: { walls: 'stone' }, parts: [] }));
    world.addEntity(genSpan('arch', { parts: [{ type: 'arch_span' }] }));
    world.addEntity(genSpan('flat', { parts: [{ type: 'deck' }] }));
    expect(standingSpanTier(world, 'stone', undefined)).toBe(6); // dressed stone
    expect(standingSpanTier(world, 'arch', undefined)).toBe(5);  // timber arch
    expect(standingSpanTier(world, 'flat', undefined)).toBe(3);  // log-plank (flat deck, no arch)
    expect(standingSpanTier(world, 'nothing', undefined)).toBe(0); // no span at all → build up from the log
  });
});

// ── E · reconcileCrossingTiers ────────────────────────────────────────────────
describe('reconcileCrossingTiers — the idempotent store↔entity repair (RuntimePoiStore pattern)', () => {
  function entry(id: string, over: Partial<CrossingTierEntry> = {}): CrossingTierEntry {
    return {
      crossingId: id, kind: 'edge', edgeId: 'e0', tier: 3, upStreak: 0, upgradedAtTick: 100,
      entityId: tierEntityIdFor(id), banks: [{ x: 8, y: 5 }, { x: 11, y: 5 }], axis: [1, 0], spanTiles: 3,
      ...over,
    };
  }

  it('rebuilds a missing span (deterministically) and removes the gen span it superseded', () => {
    const map = gridMap([], null);
    const world = new World(map);
    // A stale save: the store says a stone-arch span stands + it replaced a gen span, but neither
    // matches the world (the store span is gone; the superseded gen span lingers).
    world.addEntity(genSpan('cx', { parts: [{ type: 'deck' }] })); // the lingering `cx-bridge`
    const store = new CrossingTierStore();
    store.upsert(entry('cx', { replacedEntityId: 'cx-bridge' }));

    reconcileCrossingTiers(world, map, store);
    expect(world.registry.get(tierEntityIdFor('cx'))).toBeDefined(); // store span rebuilt
    expect(world.registry.get('cx-bridge')).toBeUndefined();         // superseded gen span evicted
  });

  it('evicts an orphan `crossing-tier:` entity that no store entry owns', () => {
    const map = gridMap([], null);
    const world = new World(map);
    // An orphaned store span from a scrubbed-away upgrade, with no matching entry.
    world.addEntity({ id: 'crossing-tier:ghost', kind: 'bridge', x: 5, y: 5, tags: [], properties: {} } as unknown as Entity);
    const store = new CrossingTierStore();
    reconcileCrossingTiers(world, map, store);
    expect(world.registry.get('crossing-tier:ghost')).toBeUndefined();
  });

  it('is idempotent — a second reconcile from the agreed state changes nothing', () => {
    const map = gridMap([], null);
    const world = new World(map);
    const store = new CrossingTierStore();
    store.upsert(entry('cx'));
    reconcileCrossingTiers(world, map, store);          // builds the span
    const after1 = world.query({}).map((e) => e.id).sort();
    reconcileCrossingTiers(world, map, store);          // no divergence left
    const after2 = world.query({}).map((e) => e.id).sort();
    expect(after2).toEqual(after1);
    expect(after1).toEqual([tierEntityIdFor('cx')]);
  });
});

// ── F · buildTierSpanEntity ───────────────────────────────────────────────────
describe('buildTierSpanEntity — deterministic, oriented, seated span realization', () => {
  const site = { crossingId: 'cx', banks: [{ x: 8, y: 5 }, { x: 11, y: 5 }] as CrossingTierEntry['banks'], axis: [1, 0] as [number, number] };

  it('is deterministic: two builds of the same site + tier are deep-equal (variety seeded off the id)', () => {
    const map = gridMap([], null);
    const a = buildTierSpanEntity(map, site, 3);
    const b = buildTierSpanEntity(map, site, 3);
    expect(a).toBeDefined();
    expect(a).toEqual(b);
    expect(a!.id).toBe(tierEntityIdFor('cx'));
  });

  it('a vertical (0,1)-axis site quarter-turns the footprint vs the horizontal build', () => {
    const map = gridMap([], null);
    const horiz = buildTierSpanEntity(map, site, 3)!;
    const vert = buildTierSpanEntity(map, { ...site, axis: [0, 1] }, 3)!;
    const fpH = (horiz.properties as { footprint: { w: number; h: number } }).footprint;
    const fpV = (vert.properties as { footprint: { w: number; h: number } }).footprint;
    expect(fpV.w).toBe(fpH.h); // w/h swapped by the quarter-turn
    expect(fpV.h).toBe(fpH.w);
    expect(fpH.w).not.toBe(fpH.h); // (guard: the swap is observable — the deck is not square)
  });

  it('sets a finite liftElev (the higher bank grade in curved composed-heightfield space)', () => {
    const map = gridMap([], null);
    const e = buildTierSpanEntity(map, site, 3)!;
    const lift = (e.properties as { liftElev?: number }).liftElev;
    expect(typeof lift).toBe('number');
    expect(Number.isFinite(lift)).toBe(true);
  });
});

// ── G · skip parity — class promotes AND the crossing tier follows it up (LAG discipline) ──
describe('stepCrossingTiers under projectRoadClassesOverSkip — the netUpgrades collapse (time-skip.ts mirror)', () => {
  it('an era-long jump promotes the edge to highway and the crossing follows up, collapsed to ONE net upgrade', () => {
    // A fresh `path` edge with a gen plank-deck span (tier 3). Over a 30-year skip the INFERRED use
    // (busy endpoints + a funding lord) drives the class ladder path→track→road→highway, and — one
    // rung behind, LAG-gated by the earned class — the crossing climbs 3→4→5→6. The onSubStep hook
    // collapses every sub-step's upgrade to one net event per crossing (first `from`, last `to`),
    // exactly as `applySkip` does. That the two ladders interleave correctly across the era (not an
    // end-state shortcut) is the streak-wipe parity the S2 suite guards for the class ladder.
    const edge = roadEdge(0, 'path');
    delete (edge as { use?: unknown }).use;                 // a genuinely fresh edge — no folded use yet
    const map = gridMap([9, 10], [edge]);
    const world = new World(map);
    world.addEntity(genSpan('crossing@e0#0', { parts: [{ type: 'deck' }] })); // gen tier 3
    const store = new CrossingTierStore();

    const useInputs: RoadUseFoldInputs = { wealthFor: () => 0.9, trafficFloorFor: () => 0.9 };
    const classInputs: EdgeClassInputs = {
      wealthFor: () => 0.9, hasLordSeatFor: () => true, endpointPoiIds: () => ['A', 'B'],
    };

    const netUpgrades = new Map<string, { crossingId: string; from?: number; to: number }>();
    projectRoadClassesOverSkip(map.roadGraph!, 0, 30 * TICKS_PER_YEAR, useInputs, classInputs, (now) => {
      for (const u of stepCrossingTiers({ world, map, store, nowTick: now, wealthFor: useInputs.wealthFor })) {
        const prev = netUpgrades.get(u.crossingId);
        netUpgrades.set(u.crossingId, prev ? { ...u, from: prev.from } : u);
      }
    });

    expect(edge.class).toBe('highway');                    // the class earned the top rung
    expect(netUpgrades.size).toBe(1);                      // ONE net crossing upgrade for the era
    const net = netUpgrades.get('crossing@e0#0')!;
    expect(net.from).toBe(3);                              // FIRST from = the gen plank-deck tier
    expect(net.to).toBe(6);                                // LAST to = the grand stone arch
    // The physical span standing at the end agrees with the collapsed event.
    expect(standingSpanTier(world, 'crossing@e0#0', store.byId('crossing@e0#0'))).toBe(6);
  });
});
