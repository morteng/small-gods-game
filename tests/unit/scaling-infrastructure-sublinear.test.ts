// tests/unit/scaling-infrastructure-sublinear.test.ts — the `scaling.infrastructure-sublinear`
// contract (interaction-scaling plan, Phase 4 S4.1).
//
// Fits INTRA-SETTLEMENT paved road area (the same analytic pavedness the renderer paints,
// `getRoadFeatureGeometry`/`roadPavednessAt` — reused from `buildings.off-roads-ribbon`'s own
// fixture pattern in `road-building-ribbon-clearance.test.ts`) against a housing-capacity
// population proxy, across every settlement with a measurable footprint. Settlement-scaling
// theory predicts SUBLINEAR growth (~5/6); this contract warns when the fitted log-log slope
// is materially ≥ 1 instead.
import { describe, it, expect } from 'vitest';
import { infrastructureSublinear } from '@/world/connectome/scaling-contracts';
import { contractRegistry } from '@/world/connectome-contracts';
import { clearRoadFeatureGeometryCache } from '@/render/gpu/feature-geometry';
import type { DiagnosticContext } from '@/world/connectome-diagnostics';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';
import type { GameMap, Tile, POI, BuildingInstance } from '@/core/types';

function grassMap(w: number, h: number, seed: number, pois: POI[]): GameMap {
  const tiles: Tile[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  return {
    tiles, width: w, height: h, villages: [], seed, success: true,
    worldSeed: { pois, size: { width: w, height: h } },
    stats: { iterations: 0, backtracks: 0 }, buildings: [], barrierRuns: [],
  } as unknown as GameMap;
}

/** `count` dwellings (`cottage`, DWELLING_CAPACITY 5) in a small grid centred on the POI —
 *  the farthest one from (cx,cy) sets the contract's measured settlement extent. */
function clusterBuildings(poiId: string, cx: number, cy: number, count: number): BuildingInstance[] {
  const side = Math.ceil(Math.sqrt(count));
  const half = Math.floor(side / 2);
  const out: BuildingInstance[] = [];
  let i = 0;
  for (let gy = 0; gy < side && i < count; gy++) {
    for (let gx = 0; gx < side && i < count; gx++, i++) {
      out.push({
        id: `${poiId}_b${i}`, templateId: 'cottage',
        tileX: cx + (gx - half), tileY: cy + (gy - half),
        poiId, state: 'intact',
      });
    }
  }
  return out;
}

/** A single non-dwelling building (templateId absent from `DWELLING_CAPACITY`) far from the
 *  POI anchor — sets the contract's measured settlement EXTENT (a market cross or shrine sits
 *  well beyond the last house) without adding to the housing-capacity population proxy, so a
 *  test can size a settlement's measurement radius independently of its population. */
function farMarker(poiId: string, x: number, y: number): BuildingInstance {
  return { id: `${poiId}_marker`, templateId: 'well', tileX: x, tileY: y, poiId, state: 'intact' };
}

/** A straight class-'road' edge centred on (cx,cy) spanning `±halfLen` tiles along x — the
 *  same minimal edge shape `road-building-ribbon-clearance.test.ts`'s `highwayEdge()` uses. */
function straightEdge(id: string, cx: number, cy: number, halfLen: number): RoadEdge {
  const polyline = Array.from({ length: halfLen * 2 + 1 }, (_, i) => ({ x: cx - halfLen + i, y: cy }));
  return {
    id, a: `${id}_a`, b: `${id}_b`, feature: 'road', class: 'road', surface: 'dirt',
    bridgeCells: [], polyline,
  } as unknown as RoadEdge;
}

function graphOf(...edges: RoadEdge[]): RoadGraph {
  return { nodes: [], edges };
}

const ctxOf = (map: GameMap): DiagnosticContext => ({ map, world: undefined } as unknown as DiagnosticContext);

const poi = (id: string, x: number, y: number): POI => ({ id, type: 'settlement', position: { x, y } });

describe('scaling.infrastructure-sublinear — registration', () => {
  it('is registered as a world-level warn invariant', () => {
    const c = contractRegistry()['scaling.infrastructure-sublinear'];
    expect(c).toBeDefined();
    expect(c.level).toBe('world');
    expect(c.kind).toBe('invariant');
    expect(c.severity).toBe('warn');
  });
});

describe('scaling.infrastructure-sublinear — degenerate cases (never throw, no diagnostic)', () => {
  it('is a no-op on a map with no road graph', () => {
    const map = grassMap(40, 40, 1, [poi('a', 10, 10)]);
    expect(infrastructureSublinear.evaluate(ctxOf(map), {})).toHaveLength(0);
  });

  it('is a no-op on a map whose road graph has no edges', () => {
    const map = grassMap(40, 40, 2, [poi('a', 10, 10)]);
    map.roadGraph = graphOf();
    expect(infrastructureSublinear.evaluate(ctxOf(map), {})).toHaveLength(0);
  });

  it('is a no-op with fewer than 3 placed settlements', () => {
    const map = grassMap(280, 60, 3, [poi('a', 30, 30), poi('b', 130, 30)]);
    map.buildings = [...clusterBuildings('a', 30, 30, 1), ...clusterBuildings('b', 130, 30, 4)];
    map.roadGraph = graphOf(straightEdge('ea', 30, 30, 1), straightEdge('eb', 130, 30, 2));
    clearRoadFeatureGeometryCache();
    expect(infrastructureSublinear.evaluate(ctxOf(map), {})).toHaveLength(0);
  });

  it('is a no-op when population has zero variance (every settlement the same size)', () => {
    const pois = [poi('a', 30, 30), poi('b', 130, 30), poi('c', 230, 30)];
    const map = grassMap(280, 60, 4, pois);
    map.buildings = [
      ...clusterBuildings('a', 30, 30, 4),
      ...clusterBuildings('b', 130, 30, 4),
      ...clusterBuildings('c', 230, 30, 4),
    ];
    map.roadGraph = graphOf(
      straightEdge('ea', 30, 30, 1), straightEdge('eb', 130, 30, 3), straightEdge('ec', 230, 30, 5),
    );
    clearRoadFeatureGeometryCache();
    expect(infrastructureSublinear.evaluate(ctxOf(map), {})).toHaveLength(0);
  });

  it('is a no-op when fewer than 3 settlements have a measurable footprint', () => {
    // Three placed POIs, but only two have any buildings — the third can't have its extent
    // measured and is excluded (not zero-filled), leaving 2 points: not enough to fit.
    const pois = [poi('a', 30, 30), poi('b', 130, 30), poi('c', 230, 30)];
    const map = grassMap(280, 60, 5, pois);
    map.buildings = [...clusterBuildings('a', 30, 30, 1), ...clusterBuildings('b', 130, 30, 4)];
    map.roadGraph = graphOf(straightEdge('ea', 30, 30, 1), straightEdge('eb', 130, 30, 2));
    clearRoadFeatureGeometryCache();
    expect(infrastructureSublinear.evaluate(ctxOf(map), {})).toHaveLength(0);
  });
});

describe('scaling.infrastructure-sublinear — fitted slope', () => {
  it('passes silently when road surface grows CLEARLY sublinearly with population', () => {
    // Population (housing capacity) ratio 1 : 4 : 16 (1, 4, 16 cottages × capacity 5).
    // Road length ratio only 1 : 2 : 3 — the surface grows far slower than population,
    // a strongly sublinear log-log slope well under the 1.0 threshold.
    const pois = [poi('small', 30, 30), poi('mid', 130, 30), poi('big', 230, 30)];
    const map = grassMap(280, 60, 6, pois);
    map.buildings = [
      ...clusterBuildings('small', 30, 30, 1),
      ...clusterBuildings('mid', 130, 30, 4),
      ...clusterBuildings('big', 230, 30, 16),
    ];
    map.roadGraph = graphOf(
      straightEdge('e_small', 30, 30, 1),
      straightEdge('e_mid', 130, 30, 2),
      straightEdge('e_big', 230, 30, 3),
    );
    clearRoadFeatureGeometryCache();
    expect(infrastructureSublinear.evaluate(ctxOf(map), {})).toHaveLength(0);
  });

  it('warns when road surface grows CLEARLY superlinearly with population', () => {
    // Population ratio 1 : 2 : 4 (1, 2, 4 cottages — modest growth). `farMarker` sets each
    // settlement's measured extent independently of its population (a real settlement's
    // built footprint isn't just its houses), so the road length can grow MUCH faster than
    // population: 1 : 5 : 13 (in tile-samples-along-the-road terms) — a clearly superlinear
    // fit. (Small edges are measured in whole road-width TILES, so a short edge's point
    // count is dominated by a "+1" endpoint effect relative to its span — this test uses a
    // wide enough spread that the effect can't mask the direction of the fit.)
    const pois = [poi('small', 30, 30), poi('mid', 130, 30), poi('big', 230, 30)];
    const map = grassMap(280, 60, 7, pois);
    map.buildings = [
      ...clusterBuildings('small', 30, 30, 1), farMarker('small', 33, 30),
      ...clusterBuildings('mid', 130, 30, 2), farMarker('mid', 145, 30),
      ...clusterBuildings('big', 230, 30, 4), farMarker('big', 270, 30),
    ];
    map.roadGraph = graphOf(
      straightEdge('e_small', 30, 30, 3),
      straightEdge('e_mid', 130, 30, 15),
      straightEdge('e_big', 230, 30, 40),
    );
    clearRoadFeatureGeometryCache();
    const findings = infrastructureSublinear.evaluate(ctxOf(map), {});
    expect(findings).toHaveLength(1);
    const d = findings[0];
    expect(d.rule).toBe('scaling.infrastructure-sublinear');
    expect(d.severity).toBe('warn');
    expect(d.metrics?.slope).toBeGreaterThanOrEqual(1);
    expect(d.metrics?.r2).toBeGreaterThan(0);
    expect(d.metrics?.n).toBe(3);
    expect(d.locus.pois).toEqual(['big', 'mid', 'small']);
  });
});
