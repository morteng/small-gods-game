// tests/unit/road-building-ribbon-clearance.test.ts
//
// Regression fixture for the "buildings sometimes get placed partially on top of
// the rendered road" investigation: placement historically tested only the bare
// centerline tile-grid (`tile.type ∈ ROAD_TYPES`, 1-cell occupancy) while the
// renderer paints an analytic ribbon with real width — carriageHalf 0.35–1.1 tiles
// by class × up to 1.15 construction + a 0.18 shoulder lip (`road-state.ts`
// `maxCarriageHalfWidth`, `feature-geometry.ts`). A building could sit one full
// tile off the walked centerline — never flagged by the bare tile-type test — and
// still visibly overlap the rendered pavement.
//
// This asserts the width-aware fix end to end:
//   1. `maxCarriageHalfWidth` is the single authoritative worst-case half-width.
//   2. `buildRoadOccupancyMask` (the analytic ribbon, sampled at tile resolution)
//      flags a tile the bare centerline test would miss, and clears a tile safely
//      beyond the ribbon.
//   3. The `buildings.off-roads-ribbon` world contract fires ERROR for a building
//      whose wall cells sit inside the rendered ribbon at that "off centerline but
//      still under the road" distance (the exact bug this investigation found), and
//      is clean once the building sits beyond the ribbon's reach.
import { describe, it, expect } from 'vitest';
import { maxCarriageHalfWidth } from '@/world/road-state';
import { buildRoadOccupancyMask } from '@/world/road-occupancy-mask';
import { clearRoadFeatureGeometryCache } from '@/render/gpu/feature-geometry';
import { buildingsOffRoadsRibbon } from '@/world/connectome/road-contracts';
import { contractRegistry } from '@/world/connectome-contracts';
import type { DiagnosticContext } from '@/world/connectome-diagnostics';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';
import type { GameMap, Tile } from '@/core/types';
import { World } from '@/world/world';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';

function grassMap(w: number, h: number, seed: number): GameMap {
  const tiles: Tile[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  return {
    tiles, width: w, height: h, villages: [], seed, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], barrierRuns: [],
  } as unknown as GameMap;
}

/** A straight, class-'highway' road along y=10 — construction pinned high (stone
 *  surface, highway = max endpoint-rank importance) so its rendered ribbon reaches
 *  a full tile beyond the walked centerline (well past the bare 1-cell test). */
function highwayEdge(): RoadEdge {
  const polyline = Array.from({ length: 19 }, (_, i) => ({ x: 2 + i, y: 10 }));
  return {
    id: 'e1', a: 'n1', b: 'n2', feature: 'road', class: 'highway', surface: 'stone',
    bridgeCells: [], polyline,
  } as unknown as RoadEdge;
}

function graphOf(...edges: RoadEdge[]): RoadGraph {
  return { nodes: [], edges };
}

const ctxOf = (map: GameMap, world: World): DiagnosticContext => ({ map, world });

describe('maxCarriageHalfWidth (single authoritative worst-case width)', () => {
  it('is monotonic by class and matches CLASS_HALF_WIDTH × the construction ceiling', () => {
    expect(maxCarriageHalfWidth('path')).toBeCloseTo(0.35 * 1.15, 6);
    expect(maxCarriageHalfWidth('track')).toBeCloseTo(0.5 * 1.15, 6);
    expect(maxCarriageHalfWidth('road')).toBeCloseTo(0.8 * 1.15, 6);
    expect(maxCarriageHalfWidth('highway')).toBeCloseTo(1.1 * 1.15, 6);
    expect(maxCarriageHalfWidth('path')).toBeLessThan(maxCarriageHalfWidth('track'));
    expect(maxCarriageHalfWidth('track')).toBeLessThan(maxCarriageHalfWidth('road'));
    expect(maxCarriageHalfWidth('road')).toBeLessThan(maxCarriageHalfWidth('highway'));
  });
});

describe('buildRoadOccupancyMask (the analytic ribbon at tile resolution)', () => {
  it('flags a tile one full tile off centerline (the bare tile-grid test misses this) and clears far ground', () => {
    const map = grassMap(24, 24, 101);
    const edge = highwayEdge();
    map.roadGraph = graphOf(edge);
    clearRoadFeatureGeometryCache();
    const mask = buildRoadOccupancyMask(map);
    // On the walked centerline: obviously occupied.
    expect(mask.has(10, 10)).toBe(true);
    // One tile off centerline — NOT a road-typed tile (the old bare test would pass this
    // through clean), but still inside the rendered ribbon.
    expect(mask.has(10, 11)).toBe(true);
    // Well beyond the ribbon's worst-case reach.
    expect(mask.has(10, 16)).toBe(false);
  });
});

describe('buildings.off-roads-ribbon contract', () => {
  it('is registered as a world-level invariant', () => {
    const c = contractRegistry()['buildings.off-roads-ribbon'];
    expect(c).toBeDefined();
    expect(c.level).toBe('world');
    expect(c.kind).toBe('invariant');
    expect(c.severity).toBe('error');
  });

  it('ERRORs on pre-fix geometry: a building one tile off centerline the bare tile-grid test would have missed', () => {
    const map = grassMap(24, 24, 102);
    const edge = highwayEdge();
    map.roadGraph = graphOf(edge);
    clearRoadFeatureGeometryCache();
    const w = new World(map);
    const rb = synthesizeBlueprint('cottage', [], 1)!;
    // One tile south of the centerline: no road-typed tile sits under the building, so the
    // OLD bare `ROAD_TYPES.has(tile.type)` placement test would have let this through.
    w.addEntity(blueprintEntity('near_bld', rb, 10, 11));
    const findings = buildingsOffRoadsRibbon.evaluate(ctxOf(map, w), {});
    const errors = findings.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].locus.entities).toEqual(['near_bld']);
    expect(errors[0].locus.tiles?.length).toBeGreaterThan(0);
  });

  it('is clean once the building sits beyond the ribbon (width-aware placement)', () => {
    const map = grassMap(24, 24, 103);
    const edge = highwayEdge();
    map.roadGraph = graphOf(edge);
    clearRoadFeatureGeometryCache();
    const w = new World(map);
    const rb = synthesizeBlueprint('cottage', [], 1)!;
    // Four tiles south — well clear of the highway's worst-case ribbon reach (~1.5 tiles).
    w.addEntity(blueprintEntity('far_bld', rb, 10, 14));
    const findings = buildingsOffRoadsRibbon.evaluate(ctxOf(map, w), {});
    expect(findings.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('is a no-op on a map with no road graph', () => {
    const map = grassMap(8, 8, 104);
    const w = new World(map);
    expect(buildingsOffRoadsRibbon.evaluate(ctxOf(map, w), {})).toHaveLength(0);
  });
});
