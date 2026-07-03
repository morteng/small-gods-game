// tests/unit/fillet-raster-reconcile.test.ts
//
// WP-Q acceptance: the filleted RENDER centerline (`edgeRoadProfile`) and the raster tile mask
// NPCs walk must agree. `reconcileFilletRaster` re-derives the tile set along the smoothed
// centerline; this suite is the render/raster agreement check itself — sample the smoothed
// centerline at sub-tile steps and assert every sample lands on a road-class tile, or falls
// within a span the reconciliation deliberately left alone (a hard constraint failed).
import { describe, it, expect } from 'vitest';
import { edgeRoadProfile, reconcileFilletRaster } from '@/world/road-deformation';
import { ROAD_TILE_TYPES, applyRoadMask, type RoadEdge, type RoadGraph } from '@/world/road-graph';
import { gateApproachPlan } from '@/world/connectome/gate-approach';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun, PlacedBarrier } from '@/world/barrier';
import type { Anchor } from '@/world/anchors';
import type { AnchorLink } from '@/world/anchor-rules';

/** Square town ring with one real gate mid-way along its TOP edge (facing north) — same
 *  fixture as gate-approach-fillet.test.ts, reused here to drive the raster reconciliation. */
function townRing(): PlacedBarrier {
  const run: BarrierRun = {
    kind: 'wall',
    path: [[4, 4], [16, 4], [16, 16], [4, 16], [4, 4]],
    height: 3, thickness: 1, material: 'stone', crenellated: true,
    gates: [{ t: 6, width: 3, kind: 'gate' }],          // top edge, at (10,4)
    centroid: [10, 10],
  };
  return { id: 'town_ring', run };
}

function grassMap(w: number, h: number, opts: Partial<GameMap> = {}): GameMap {
  const tiles: Tile[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], barrierRuns: [],
    ...opts,
  } as unknown as GameMap;
}

/** A road that reaches the gate from the north-WEST — a skewed, kinked approach with the same
 *  overall shape as gate-approach-fillet.test.ts's fixture, but rasterized as a proper
 *  4-CONNECTED staircase (unit orthogonal steps) the way `buildRoadGraph`'s `orthogonalize`
 *  actually stores an edge's polyline — required here since these tests check literal tile
 *  coverage, not just the smoothed profile's geometry. */
function approachEdge(id = 'e1'): RoadEdge {
  return {
    id, a: 'n1', b: 'n2', feature: 'road', class: 'road', surface: 'dirt',
    bridgeCells: [],
    polyline: [
      { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 },
      { x: 6, y: 2 }, { x: 7, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 3 }, { x: 9, y: 3 }, { x: 10, y: 3 },
      { x: 10, y: 4 },
    ],
  } as unknown as RoadEdge;
}

function graphOf(...edges: RoadEdge[]): RoadGraph {
  return { nodes: [], edges };
}

/** Stamp an edge's RAW polyline onto the tile grid — what `buildRoadGraph` does at gen time,
 *  before `edgeRoadProfile`'s fillet ever runs. The reconciliation only touches cells the
 *  fillet DIVERGED onto, so fixtures must pre-carve the raw path first, same as real worldgen. */
function carveEdge(map: GameMap, ...edges: RoadEdge[]): void {
  for (const edge of edges) {
    applyRoadMask(map.tiles, {
      width: map.width, height: map.height,
      writes: edge.polyline.map((c) => ({ x: c.x, y: c.y, surface: edge.surface, bridge: false })),
    });
  }
}

/** Every road-class tile the samples along `centerline` land on (or don't). */
function sampleTileTypes(map: GameMap, centerline: { x: number; y: number }[], step: number): string[] {
  const out: string[] = [];
  for (let i = 1; i < centerline.length; i++) {
    const a = centerline[i - 1], b = centerline[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (t <= len) {
      const s = t / (len || 1);
      const x = Math.round(a.x + (b.x - a.x) * s), y = Math.round(a.y + (b.y - a.y) * s);
      out.push(map.tiles[y]?.[x]?.type ?? '<oob>');
      t += step;
    }
  }
  return out;
}

describe('reconcileFilletRaster — render/raster agreement (WP-Q #1)', () => {
  it('is a no-op when no fillet touched the edge (no ring)', () => {
    const map = grassMap(24, 24, { barrierRuns: [] });
    map.roadGraph = graphOf(approachEdge());
    const spans = reconcileFilletRaster(map);
    expect(spans).toHaveLength(0);
  });

  it('writes new road tiles under the smoothed gate-approach tail', () => {
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);

    const spans = reconcileFilletRaster(map);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.written && s.cellsWritten > 0)).toBe(true);

    // The profile is what the renderer draws; every dense sample along it must land on a
    // road-class tile (dirt_road/stone_road/bridge) — the raster now matches the ribbon.
    const profile = edgeRoadProfile(map, edge, new Map(), new Map());
    expect(profile).not.toBeNull();
    const types = sampleTileTypes(map, profile!.centerline, 0.3);
    for (const t of types) expect(ROAD_TILE_TYPES.has(t)).toBe(true);
  });

  it('is idempotent — a second pass mutates nothing further', () => {
    // Divergence is measured against the RAW polyline (never rewritten — purely additive), so
    // a second pass still recognises the same span; the invariant that matters is that
    // re-applying it is a no-op at the TILE level (writing the same road type twice).
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);
    reconcileFilletRaster(map);
    const snapshot = map.tiles.map((row) => row.map((t) => ({ type: t.type, walkable: t.walkable })));
    reconcileFilletRaster(map);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(map.tiles[y][x].type).toBe(snapshot[y][x].type);
        expect(map.tiles[y][x].walkable).toBe(snapshot[y][x].walkable);
      }
    }
  });

  it('falls back (leaves original tiles) when the fillet would cross a blocked cell', () => {
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);

    // Block every cell in a band just south of the gate — anywhere the reconciled tail would
    // need to land — with an unwalkable, non-road tile (stands in for a building footprint).
    for (let y = 3; y <= 6; y++) {
      for (let x = 6; x <= 12; x++) {
        const t = map.tiles[y][x];
        t.type = 'rock';
        t.walkable = false;
      }
    }
    const before = map.tiles.map((row) => row.map((t) => ({ type: t.type, walkable: t.walkable })));

    const spans = reconcileFilletRaster(map);
    // Every span in this fully-blocked corridor must have fallen back.
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) expect(s.written).toBe(false);

    // Falling back means NO tiles changed at all (purely additive — nothing to undo).
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(map.tiles[y][x].type).toBe(before[y][x].type);
        expect(map.tiles[y][x].walkable).toBe(before[y][x].walkable);
      }
    }
  });

  it('never claims a curtain-blocking wall cell even where a fillet arc could swing near one', () => {
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);
    reconcileFilletRaster(map);

    const wallObstacles = gateApproachPlan(map.barrierRuns ?? [], [], []).wallObstacles;
    for (const key of wallObstacles) {
      const [x, y] = key.split(',').map(Number);
      expect(ROAD_TILE_TYPES.has(map.tiles[y][x].type)).toBe(false);
    }
  });
});

describe('edgeRoadProfile — building-anchor fillet (WP-Q #2)', () => {
  function arrivalHeading(line: { x: number; y: number }[]): [number, number] {
    const a = line[line.length - 2], b = line[line.length - 1];
    const m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return [(b.x - a.x) / m, (b.y - a.y) / m];
  }

  it('fillets a road arriving at a matched building door', () => {
    // A door at (10, 4.2) facing NORTH (outward, [0,-1]) — a building sitting just south of
    // the road's raw terminus. The road approaches from the north-west, same skewed polyline
    // shape as the gate fixture, so the arrival should be reshaped identically: it must end
    // at the door and arrive heading south (into the door) instead of at the raw skew.
    const doorAnchor: Anchor = { kind: 'door', x: 10, y: 4.2, facing: [0, -1], id: 'bldg1:a0', ownerId: 'bldg1' };
    const edge = approachEdge();
    const link: AnchorLink = {
      a: { kind: 'door', x: 10, y: 4.2, id: 'bldg1:a0', ownerId: 'bldg1' },
      b: { kind: 'road', x: 10, y: 4, ownerId: edge.id },
      relation: 'connects',
      gap: 0.2,
    };
    const map = grassMap(24, 24, { barrierRuns: [], anchors: [doorAnchor], anchorLinks: [link] });
    map.roadGraph = graphOf(edge);

    const profile = edgeRoadProfile(map, edge, new Map(), new Map());
    expect(profile).not.toBeNull();
    const line = profile!.centerline;
    expect(line[line.length - 1].x).toBeCloseTo(10, 0);
    expect(line[line.length - 1].y).toBeCloseTo(4, 0);
    const [hx, hy] = arrivalHeading(line);
    expect(hy).toBeGreaterThan(0.9); // heading south, into the door
    expect(Math.abs(hx)).toBeLessThan(0.4);
  });

  it('leaves a midpoint door-road match (not this edge\'s own terminus) untouched', () => {
    // A door snapped to a point in the MIDDLE of an unrelated edge must not fillet that
    // edge's tail — the edge-scoped filter should reject it as "not an arrival."
    const edge = approachEdge('e-mid');
    const link: AnchorLink = {
      a: { kind: 'door', x: 5, y: 1.4, id: 'bldg2:a0', ownerId: 'bldg2' },
      b: { kind: 'road', x: 5, y: 1.5, ownerId: edge.id }, // a midpoint of the polyline, not an end
      relation: 'connects',
      gap: 0.15,
    };
    const doorAnchor: Anchor = { kind: 'door', x: 5, y: 1.4, facing: [0, -1], id: 'bldg2:a0', ownerId: 'bldg2' };
    const map = grassMap(24, 24, { barrierRuns: [], anchors: [doorAnchor], anchorLinks: [link] });
    map.roadGraph = graphOf(edge);

    const withAnchor = edgeRoadProfile(map, edge, new Map(), new Map());
    const withoutAnchor = edgeRoadProfile(grassMap(24, 24, { barrierRuns: [] }), edge, new Map(), new Map());
    expect(withAnchor!.centerline.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toEqual(
      withoutAnchor!.centerline.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`),
    );
  });

  it('reconciles tiles under a building-anchor arrival too', () => {
    const doorAnchor: Anchor = { kind: 'door', x: 10, y: 4.2, facing: [0, -1], id: 'bldg1:a0', ownerId: 'bldg1' };
    const edge = approachEdge();
    const link: AnchorLink = {
      a: { kind: 'door', x: 10, y: 4.2, id: 'bldg1:a0', ownerId: 'bldg1' },
      b: { kind: 'road', x: 10, y: 4, ownerId: edge.id },
      relation: 'connects',
      gap: 0.2,
    };
    const map = grassMap(24, 24, { barrierRuns: [], anchors: [doorAnchor], anchorLinks: [link] });
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);

    const spans = reconcileFilletRaster(map);
    expect(spans.some((s) => s.written && s.cellsWritten > 0)).toBe(true);
    const profile = edgeRoadProfile(map, edge, new Map(), new Map());
    const types = sampleTileTypes(map, profile!.centerline, 0.3);
    for (const t of types) expect(ROAD_TILE_TYPES.has(t)).toBe(true);
  });
});
