// tests/unit/desire-line-adoption.test.ts — road-wear economy S4: the COMMIT + PERSISTENCE half
// (src/world/desire-line-adoption.ts). Mirrors the S3 crossing-tier-store suite's discipline — a real
// hand-built GameMap + World + RoadGraph + TrampleGrid, the pure store/driver run through the SAME
// year-pass function the sim + time-skip call, and the scrub round-trip through the real
// capture/restore ordering. Covers:
//   • adoptDesireLine — the one-way commit (emergent edge, raster, host split, event, the §9.4 re-key);
//   • stepAdoptions — the streak driver (N_ADOPT gate, prune, release, no-re-adopt);
//   • reconcileAdoptions — the scrub replay + the orphan sweep;
//   • the full snapshot scrub round-trip (captureSnapshot → drive → restore both directions).
//
// GOTCHA (S3 sibling): anything reaching buildTierSpanEntity (the §9.4 re-key rebuilds a span) needs
// ensureBuildingTypesRegistered() or resolveBlueprint throws `unknown part type "deck"`. beforeAll it.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Render-water is the hydrology/connectome ribbon — persistent water knowledge that OUTLIVES a
// surface tile mutation (its whole reason to exist: a road carving 'bridge' over the channel does
// NOT make the channel dry). `adoptDesireLine` relies on exactly that: it stamps the deck cells to
// 'bridge', THEN calls getCrossingOpenings (`// recomputed post-surgery`) for the §9.4 log re-key,
// so the crossing must still read as wet after the stamp. A tile-only test stub can't reproduce the
// ribbon, so we model the production invariant directly: `RIVER` cells stay wet regardless of tile
// type. Empty by default ⇒ every other test keeps the real tile-water behaviour, byte-for-byte.
const { RIVER } = vi.hoisted(() => ({ RIVER: new Set<number>() }));
vi.mock('@/world/render-water', async () => {
  const { WATER_TYPES } = await import('@/core/constants');
  return {
    getRenderWaterMask: (map: { width: number; height: number; tiles?: Array<Array<{ type: string }>> }) =>
      (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
        if (RIVER.has(y * map.width + x)) return true; // hydrology ribbon — survives the deck stamp
        return WATER_TYPES.has(map.tiles?.[y]?.[x]?.type ?? '');
      },
  };
});

import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { clearRenderWaterTypeCache } from '@/render/gpu/render-water-mask';
import { World } from '@/world/world';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import {
  AdoptionLedger, adoptDesireLine, stepAdoptions, reconcileAdoptions, corridorLogSites,
} from '@/world/desire-line-adoption';
import {
  traceAdoptionCorridors, ADOPT_WEAR_MIN, N_ADOPT,
  type AdoptionCandidate, type CorridorLogSite,
} from '@/world/desire-line-corridors';
import { TrampleGrid } from '@/sim/trample';
import { CrossingTierStore, buildTierSpanEntity, tierEntityIdFor } from '@/world/crossing-tier-store';
import { getCrossingOpenings } from '@/world/connectome/crossing-openings';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { RoadGraph, RoadNode } from '@/world/road-graph';

const W = 24, H = 16;
const WEAR = 150;

beforeAll(() => ensureBuildingTypesRegistered());
beforeEach(() => { clearRenderWaterTypeCache(); RIVER.clear(); });

function baseTiles(): Tile[][] {
  return Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
}
function setTile(tiles: Tile[][], x: number, y: number, type: string, walkable: boolean, baseType?: string): void {
  const t = tiles[y][x];
  t.type = type; t.walkable = walkable;
  if (baseType !== undefined) t.baseType = baseType;
}
function mkMap(tiles: Tile[][], graph: RoadGraph | null): GameMap {
  return {
    tiles, width: W, height: H, villages: [], seed: 1, success: true, flatHeight: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    ...(graph ? { roadGraph: graph } : {}),
  } as unknown as GameMap;
}
function mkTrample(promoted: Array<[number, number]>, wear = WEAR): TrampleGrid {
  const g = new TrampleGrid(W, H);
  g.hydrate({
    width: W, height: H,
    cells: promoted.map(([x, y]) => [y * W + x, wear] as [number, number]),
    promoted: promoted.map(([x, y]) => [y * W + x, 'grass'] as [number, string]),
  });
  return g;
}
const isWaterFor = (map: GameMap) => (x: number, y: number): boolean => map.tiles[y]?.[x]?.type === 'water';

/**
 * The DRY adoption fixture: a promoted trail at y=8 (x 2..15, actual `dirt` tiles) between a POI node
 * `nA` at (2,8) and a mid-edge landing on the vertical host road `reH` (x=17, y=2..14, `dirt_road`
 * tiles). The far end binds `reH` at interior index 4 (cell (17,6)) — a genuine host split. No water.
 */
function dryFixture(): { map: GameMap; trample: TrampleGrid; promotedCells: Array<[number, number]> } {
  const tiles = baseTiles();
  for (let y = 2; y <= 14; y++) setTile(tiles, 17, y, 'dirt_road', true, 'grass'); // host reH cells
  const promotedCells: Array<[number, number]> = [];
  for (let x = 2; x <= 15; x++) { setTile(tiles, x, 8, 'dirt', true); promotedCells.push([x, 8]); }
  const graph: RoadGraph = {
    nodes: [
      { id: 'rnH0', x: 17, y: 2, kind: 'end' },
      { id: 'rnH1', x: 17, y: 14, kind: 'end' },
      { id: 'nA', x: 2, y: 8, kind: 'poi', poiRef: 'pA' } as RoadNode,
    ],
    edges: [{
      id: 'reH', a: 'rnH0', b: 'rnH1',
      polyline: Array.from({ length: 13 }, (_, i) => ({ x: 17, y: 2 + i })),
      feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [],
    }],
    rev: 0,
  };
  return { map: mkMap(tiles, graph), trample: mkTrample(promotedCells), promotedCells };
}

function dryCandidate(map: GameMap, trample: TrampleGrid): AdoptionCandidate {
  const out = traceAdoptionCorridors(trample, map, map.roadGraph!, { isWater: isWaterFor(map) });
  expect(out).toHaveLength(1);
  return out[0];
}

// ── the commit ─────────────────────────────────────────────────────────────────
describe('adoptDesireLine — the one-way commit', () => {
  it('lays the emergent edge: class path / surface dirt / emergent / pins every index / polyline === the traced path', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const candidate = dryCandidate(map, trample);
    expect(candidate.key).toBe('adopt:nA~reH');

    const res = adoptDesireLine({ world, map, candidate, nowTick: 1000 })!;
    expect(res).toBeTruthy();
    const edgeId = `re-adopt:${candidate.key}`;
    expect(res.record.edgeId).toBe(edgeId);
    const edge = map.roadGraph!.edges.find((e) => e.id === edgeId)!;
    expect(edge).toBeTruthy();
    expect(edge).toMatchObject({ feature: 'road', class: 'path', surface: 'dirt', emergent: true });
    expect(edge.polyline).toEqual(candidate.path);
    // Every polyline point is pinned (the walked geometry is forced, no runtime bow-reconcile).
    expect(edge.pins).toEqual(candidate.path.map((_, i) => i));
    expect(edge.bridgeCells).toEqual([]); // dry adoption
  });

  it('rasters the trail dirt→dirt_road (baseType "dirt" recorded); a pre-existing ROAD cell is untouched and NOT recorded', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const candidate = dryCandidate(map, trample);
    const res = adoptDesireLine({ world, map, candidate, nowTick: 1000 })!;

    // A promoted trail cell (5,8) is now dirt_road, its dirt ground preserved as baseType.
    expect(map.tiles[8][5].type).toBe('dirt_road');
    expect(map.tiles[8][5].baseType).toBe('dirt');
    const prior = res.record.priorTiles.find((p) => p.x === 5 && p.y === 8)!;
    expect(prior).toMatchObject({ type: 'dirt', walkable: true });
    expect(prior.baseType).toBeUndefined(); // the trail had no baseType before the raster

    // The landing cell (17,6) is a pre-existing road tile — untouched by the raster, never recorded.
    expect(map.tiles[6][17].type).toBe('dirt_road');
    expect(res.record.priorTiles.some((p) => p.x === 17 && p.y === 6)).toBe(false);
  });

  it('splits the host at the mid-edge landing (both halves + the junction node present)', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const candidate = dryCandidate(map, trample);
    const res = adoptDesireLine({ world, map, candidate, nowTick: 1000 })!;

    const g = map.roadGraph!;
    expect(g.edges.some((e) => e.id === 'reH')).toBe(false);
    expect(g.edges.some((e) => e.id === 'reHa')).toBe(true);
    expect(g.edges.some((e) => e.id === 'reHb')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'rn-split:reH@4')).toBe(true);
    // The commit recorded that one split for the reverse replay.
    expect(res.record.splits).toHaveLength(1);
    expect(res.record.splits[0]).toMatchObject({ hostEdgeId: 'reH', atIndex: 4, nodeId: 'rn-split:reH@4' });
  });

  it('returns the event payload (edgeId / mid x,y / lengthT / poi ids)', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const candidate = dryCandidate(map, trample);
    const res = adoptDesireLine({ world, map, candidate, nowTick: 1000 })!;

    const mid = candidate.path[Math.floor(candidate.path.length / 2)];
    expect(res.event).toMatchObject({
      edgeId: `re-adopt:${candidate.key}`, x: mid.x, y: mid.y, lengthT: candidate.path.length, toPoiId: 'pA',
    });
    // The edge-anchor end carries no POI, so `from` is honestly absent.
    expect(res.event.fromPoiId).toBeUndefined();
  });

  it('returns null (nothing to commit) for a degenerate path or a graph-less map', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const candidate = dryCandidate(map, trample);
    const short = { ...candidate, path: [candidate.path[0]] };
    expect(adoptDesireLine({ world, map, candidate: short, nowTick: 1 })).toBeNull();
    const noGraph = mkMap(baseTiles(), null);
    expect(adoptDesireLine({ world, map: noGraph, candidate, nowTick: 1 })).toBeNull();
  });
});

// ── the year-pass driver ─────────────────────────────────────────────────────────
describe('stepAdoptions — the streak driver', () => {
  const KEY = 'adopt:nA~reH';

  it('accrues 1 streak per qualifying pass and adopts EXACTLY at N_ADOPT', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const ledger = new AdoptionLedger();
    for (let p = 1; p < N_ADOPT; p++) {
      const ev = stepAdoptions({ world, map, ledger, trample, nowTick: p * 100 });
      expect(ev).toHaveLength(0);
      expect(ledger.byKey(KEY)).toMatchObject({ streak: p });
      expect(ledger.byKey(KEY)?.adopted).toBeUndefined();
    }
    const ev = stepAdoptions({ world, map, ledger, trample, nowTick: N_ADOPT * 100 });
    expect(ev).toHaveLength(1);
    expect(ev[0].edgeId).toBe(`re-adopt:${KEY}`);
    expect(ledger.byKey(KEY)?.adopted).toBeDefined();
    expect(ledger.byKey(KEY)?.streak).toBe(0);
  });

  it('a non-qualifying pass (grid wear dropped below ADOPT_WEAR_MIN) breaks the streak', () => {
    const { map, trample, promotedCells } = dryFixture();
    const world = new World(map);
    const ledger = new AdoptionLedger();
    stepAdoptions({ world, map, ledger, trample, nowTick: 100 });
    stepAdoptions({ world, map, ledger, trample, nowTick: 200 });
    expect(ledger.byKey(KEY)).toMatchObject({ streak: 2 });
    // Edit the grid: same promoted cells, wear now just under the gate.
    trample.hydrate({
      width: W, height: H,
      cells: promotedCells.map(([x, y]) => [y * W + x, ADOPT_WEAR_MIN - 1] as [number, number]),
      promoted: promotedCells.map(([x, y]) => [y * W + x, 'grass'] as [number, string]),
    });
    const ev = stepAdoptions({ world, map, ledger, trample, nowTick: 300 });
    expect(ev).toHaveLength(0);
    expect(ledger.byKey(KEY)).toBeUndefined(); // pruned — the streak is consecutive, not lifetime
  });

  it('a vanished corridor (no candidate this pass) prunes the un-adopted streak', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const ledger = new AdoptionLedger();
    stepAdoptions({ world, map, ledger, trample, nowTick: 100 });
    stepAdoptions({ world, map, ledger, trample, nowTick: 200 });
    expect(ledger.byKey(KEY)).toMatchObject({ streak: 2 });
    const ev = stepAdoptions({ world, map, ledger, trample, nowTick: 300, candidates: [] });
    expect(ev).toHaveLength(0);
    expect(ledger.byKey(KEY)).toBeUndefined();
  });

  it('an adopted key never re-adopts (the road outlives the trail; record is permanent)', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const ledger = new AdoptionLedger();
    for (let p = 1; p <= N_ADOPT; p++) stepAdoptions({ world, map, ledger, trample, nowTick: p * 100 });
    const ev = stepAdoptions({ world, map, ledger, trample, nowTick: (N_ADOPT + 1) * 100 });
    expect(ev).toHaveLength(0);
    expect(ledger.all().filter((e) => e.adopted)).toHaveLength(1);
  });

  it('RELEASES the trample cells on adoption (promoted set + accum cleared) while the tile stays dirt_road', () => {
    const { map, trample } = dryFixture();
    const world = new World(map);
    const ledger = new AdoptionLedger();
    for (let p = 1; p <= N_ADOPT; p++) stepAdoptions({ world, map, ledger, trample, nowTick: p * 100 });
    // (5,8) was a promoted trail cell — the graph owns it now.
    expect(trample.isPromoted(5, 8)).toBe(false);
    expect(trample.wearAt(5, 8)).toBe(0);
    expect(trample.promotedCellList().some((c) => c.x === 5 && c.y === 8)).toBe(false);
    expect(map.tiles[8][5].type).toBe('dirt_road'); // released WITHOUT reverting the tile
  });

  it('is deterministic: two identical fixture runs produce deeply-equal ledgers + graphs', () => {
    const run = () => {
      const { map, trample } = dryFixture();
      const world = new World(map);
      const ledger = new AdoptionLedger();
      for (let p = 1; p <= N_ADOPT; p++) stepAdoptions({ world, map, ledger, trample, nowTick: p * 100 });
      return {
        ledger: ledger.serialize(),
        edges: structuredClone(map.roadGraph!.edges),
        nodes: structuredClone(map.roadGraph!.nodes),
      };
    };
    const a = run(), b = run();
    expect(a.ledger).toEqual(b.ledger);
    expect(a.edges).toEqual(b.edges);
    expect(a.nodes).toEqual(b.nodes);
  });
});

// ── reconcileAdoptions — the orphan sweep ─────────────────────────────────────────
describe('reconcileAdoptions — orphan sweep', () => {
  it('evicts an emergent edge with NO ledger record and reverts its tiles to baseType', () => {
    const tiles = baseTiles();
    // An orphan emergent edge over cells the raster left as dirt_road with a grass ground under.
    for (let x = 3; x <= 6; x++) setTile(tiles, x, 4, 'dirt_road', true, 'grass');
    const graph: RoadGraph = {
      nodes: [{ id: 'x', x: 3, y: 4, kind: 'junction' }, { id: 'y', x: 6, y: 4, kind: 'junction' }],
      edges: [{
        id: 're-adopt:orphan', a: 'x', b: 'y',
        polyline: Array.from({ length: 4 }, (_, i) => ({ x: 3 + i, y: 4 })),
        feature: 'road', class: 'path', surface: 'dirt', bridgeCells: [], emergent: true,
        pins: [0, 1, 2, 3],
      }],
      rev: 5,
    };
    const map = mkMap(tiles, graph);
    reconcileAdoptions(map, new AdoptionLedger(), null); // empty ledger explains nothing

    expect(map.roadGraph!.edges.some((e) => e.id === 're-adopt:orphan')).toBe(false);
    for (let x = 3; x <= 6; x++) expect(map.tiles[4][x].type).toBe('grass'); // fell back to baseType
  });
});

// ── §9.4 log re-key ──────────────────────────────────────────────────────────────
describe('adoptDesireLine — the §9.4 corridor-log re-key', () => {
  it('a standing corridor log the adopted edge crosses becomes an EDGE crossing of the new edge', () => {
    // Left trail x=2..7, water column x=8,9 (all rows — the render-water mask sees a real river),
    // right trail x=10..15 (all y=8); banks (7,8)-(10,8).
    const tiles = baseTiles();
    for (const x of [8, 9]) for (let y = 0; y < H; y++) setTile(tiles, x, y, 'water', false);
    // The channel is render-water at the crossing row — it stays wet after the deck is stamped
    // 'bridge' (the production hydrology-ribbon invariant the §9.4 re-key detection depends on).
    RIVER.add(8 * W + 8); RIVER.add(8 * W + 9);
    const promoted: Array<[number, number]> = [];
    for (const x of [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15]) { setTile(tiles, x, 8, 'dirt', true); promoted.push([x, 8]); }
    const graph: RoadGraph = {
      nodes: [
        { id: 'nA', x: 2, y: 8, kind: 'poi', poiRef: 'pA' } as RoadNode,
        { id: 'nB', x: 15, y: 8, kind: 'poi', poiRef: 'pB' } as RoadNode,
      ],
      edges: [], rev: 0,
    };
    const map = mkMap(tiles, graph);
    const world = new World(map);
    const trample = mkTrample(promoted);

    // A standing corridor log at the crossing (the store entry + its span entity in the world).
    const store = new CrossingTierStore();
    const banks: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 7, y: 8 }, { x: 10, y: 8 }];
    const logEntity = buildTierSpanEntity(map, { crossingId: 'corr0', banks, axis: [1, 0] }, 0)!;
    expect(logEntity).toBeTruthy();
    world.addEntity(logEntity);
    store.upsert({
      crossingId: 'corr0', kind: 'corridor', tier: 0, upStreak: 0, upgradedAtTick: 1000,
      entityId: logEntity.id, banks, axis: [1, 0], spanTiles: 3,
    });

    const logSites: CorridorLogSite[] = [{ corridorId: 'corr0', banks, water: [{ x: 8, y: 8 }, { x: 9, y: 8 }] }];
    const candidate = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map), logSites })[0];
    expect(candidate.key).toBe('adopt:nA~nB');
    expect(candidate.logCorridorIds).toEqual(['corr0']);

    const res = adoptDesireLine({ world, map, candidate, nowTick: 2000, crossingTiers: store })!;
    expect(res).toBeTruthy();
    const edgeId = res.record.edgeId;

    // Deck cells rasterized to bridge; bridgeCells recorded.
    expect(map.tiles[8][8].type).toBe('bridge');
    expect(map.tiles[8][9].type).toBe('bridge');
    expect(res.record.bridgeCells).toEqual([8 * W + 8, 8 * W + 9]);

    // The opening on the new edge — the identity the log re-keys onto.
    const op = getCrossingOpenings(map).find((o) => o.edgeId === edgeId)!;
    expect(op).toBeTruthy();
    expect(op.id).toContain(`crossing@${edgeId}#`);

    // Old corridor entry + its span are gone; the store now holds an EDGE-kind entry under the new id.
    expect(store.byId('corr0')).toBeUndefined();
    expect(world.registry.get(tierEntityIdFor('corr0'))).toBeUndefined();
    const moved = store.byId(op.id)!;
    expect(moved).toBeTruthy();
    expect(moved).toMatchObject({ kind: 'edge', edgeId, tier: 0 });

    // Exactly ONE crossing-tier span stands — the rebuilt one, keyed on the new crossing id.
    const spans = (world.query({}) as Entity[]).filter((e) => String(e.id).startsWith('crossing-tier:'));
    expect(spans).toHaveLength(1);
    expect(spans[0].id).toBe(tierEntityIdFor(op.id));
    expect(moved.entityId).toBe(tierEntityIdFor(op.id));
  });
});

// ── corridorLogSites (the driver's log-jump input, derived from the S3 store) ──────
describe('corridorLogSites', () => {
  it('derives one log-jump site per STANDING corridor entry (streak-only + null → nothing)', () => {
    const store = new CrossingTierStore();
    store.upsert({
      crossingId: 'corr0', kind: 'corridor', tier: 0, upStreak: 0, upgradedAtTick: 1,
      entityId: 'crossing-tier:corr0', banks: [{ x: 7, y: 8 }, { x: 10, y: 8 }], axis: [1, 0], spanTiles: 3,
    });
    store.upsert({ // streak-only (no entityId) → excluded
      crossingId: 'streak', kind: 'corridor', tier: 0, upStreak: 2, upgradedAtTick: 0,
      banks: [{ x: 1, y: 1 }, { x: 3, y: 1 }], axis: [1, 0], spanTiles: 2,
    });
    const sites = corridorLogSites(store);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ corridorId: 'corr0', banks: [{ x: 7, y: 8 }, { x: 10, y: 8 }] });
    expect(sites[0].water).toEqual([{ x: 8, y: 8 }, { x: 9, y: 8 }]); // interior cells between the banks
    expect(corridorLogSites(null)).toEqual([]);
  });
});

// ── the scrub round-trip (the centerpiece) ────────────────────────────────────────
describe('adoption scrub round-trip (captureSnapshot → drive → restore both directions)', () => {
  it('scrub-back un-adopts (edge out, host un-split, tiles reverted, trail re-promoted); scrub-forward re-adopts byte-identically', () => {
    const { map, trample } = dryFixture();
    const state = createState();
    state.map = map;
    state.world = new World(map);
    state.trample = trample;
    state.clock.advance(1000);

    // PRE: before any adoption.
    const pre = captureSnapshot(state);

    // Drive the ladder to adoption (fires on the N_ADOPT-th pass).
    for (let p = 1; p <= N_ADOPT; p++) {
      state.clock.advance(1000);
      stepAdoptions({ world: state.world, map, ledger: state.adoptions, trample: state.trample, nowTick: state.clock.now() });
    }
    const adopted = state.adoptions.all().filter((e) => e.adopted);
    expect(adopted).toHaveLength(1);
    const key = adopted[0].key;
    const edgeId = `re-adopt:${key}`;
    const emergentPre = structuredClone(map.roadGraph!.edges.find((e) => e.id === edgeId));
    expect(emergentPre).toBeTruthy();
    expect(map.roadGraph!.edges.some((e) => e.id === 'reHa')).toBe(true); // host split
    expect(map.tiles[8][5].type).toBe('dirt_road');

    // POST: after the adoption.
    const post = captureSnapshot(state);

    // ── scrub-back to PRE ──
    restoreSnapshot(state, pre);
    const m = state.map!;
    expect(m.roadGraph!.edges.some((e) => e.id === edgeId)).toBe(false);              // emergent gone
    expect(m.roadGraph!.edges.some((e) => e.id === 'reH')).toBe(true);                // host un-split
    expect(m.roadGraph!.edges.some((e) => e.id === 'reHa' || e.id === 'reHb')).toBe(false);
    expect(m.roadGraph!.nodes.some((n) => n.id.startsWith('rn-split:'))).toBe(false); // junction gone
    expect(m.tiles[8][5].type).toBe('dirt');                                          // tile reverted
    expect(m.tiles[8][5].walkable).toBe(true);
    expect(m.tiles[8][5].baseType).toBeUndefined();                                   // baseType restored (absent)
    expect(state.trample!.isPromoted(5, 8)).toBe(true);                               // trail owned by the grid again
    expect(state.adoptions.all()).toHaveLength(0);

    // ── scrub-forward to POST ──
    restoreSnapshot(state, post);
    const m2 = state.map!;
    const emergentPost = m2.roadGraph!.edges.find((e) => e.id === edgeId);
    expect(emergentPost).toBeTruthy();
    expect(m2.roadGraph!.edges.some((e) => e.id === 'reHa')).toBe(true);              // re-split
    expect(m2.roadGraph!.nodes.some((n) => n.id === 'rn-split:reH@4')).toBe(true);
    expect(m2.tiles[8][5].type).toBe('dirt_road');                                    // re-rasterized
    expect(state.adoptions.all().filter((e) => e.adopted)).toHaveLength(1);
    // The re-adopted edge is byte-identical to the pre-scrub edge (id/polyline/pins/bridgeCells/nodes).
    expect(structuredClone(emergentPost)).toEqual(emergentPre);
  });
});
