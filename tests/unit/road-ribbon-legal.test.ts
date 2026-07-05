// tests/unit/road-ribbon-legal.test.ts — the `roads.ribbon-legal` lint contract (synthesis 2.2)
//
// Galin 2010's named pitfall: after smoothing, "the curve may lie slightly inside or above the
// terrain" — a pipeline that smooths after routing must RE-VALIDATE. The contract asserts every
// divergent span of every road edge's FILLETED centerline reconciled onto legal cells; a span
// that fell back (its candidate cells violate a hard constraint) is an error — the visible
// ribbon departs the walkable carve.
import { describe, it, expect } from 'vitest';
import { roadsRibbonLegal } from '@/world/connectome/road-contracts';
import { contractRegistry } from '@/world/connectome-contracts';
import type { DiagnosticContext } from '@/world/connectome-diagnostics';
import { planFilletReconcile, reconcileFilletRaster, edgeRoadProfile } from '@/world/road-deformation';
import { applyRoadMask, type RoadEdge, type RoadGraph } from '@/world/road-graph';
import { gatePoint, type BarrierRun, type PlacedBarrier } from '@/world/barrier';
import type { GameMap, Tile } from '@/core/types';

/** Square town ring with one real gate mid-way along its TOP edge — the WP-Q fixture. */
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

/** Kinked 4-connected staircase approach arriving at the gate (10,4) from the north-west. */
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

const graphOf = (...edges: RoadEdge[]): RoadGraph => ({ nodes: [], edges });

function carveEdge(map: GameMap, ...edges: RoadEdge[]): void {
  for (const edge of edges) {
    applyRoadMask(map.tiles, {
      width: map.width, height: map.height,
      writes: edge.polyline.map((c) => ({ x: c.x, y: c.y, surface: edge.surface, bridge: false })),
    });
  }
}

const ctxOf = (map: GameMap): DiagnosticContext => ({ map, world: undefined } as unknown as DiagnosticContext);

describe('roads.ribbon-legal', () => {
  it('is registered as a world-level invariant (auto-run by evaluateContracts)', () => {
    const c = contractRegistry()['roads.ribbon-legal'];
    expect(c).toBeDefined();
    expect(c.level).toBe('world');
    expect(c.kind).toBe('invariant');
    expect(c.severity).toBe('error');
  });

  it('passes on a reconciled gate approach (spans written, all cells legal)', () => {
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);
    const spans = reconcileFilletRaster(map);
    expect(spans.some((s) => s.written)).toBe(true);
    expect(roadsRibbonLegal.evaluate(ctxOf(map), {})).toHaveLength(0);
  });

  it('errors when a divergent span falls back onto illegal ground (water under the ribbon)', () => {
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);
    // Find where the fillet actually diverges, then flood one of its candidate cells that is
    // NOT on the raw carve — the reconciliation must fall back and the contract must fire.
    const plans = planFilletReconcile(map);
    expect(plans.length).toBeGreaterThan(0);
    const raw = new Set(edge.polyline.map((c) => `${c.x},${c.y}`));
    const target = plans.flatMap((p) => p.cells).find((c) => !raw.has(`${c.x},${c.y}`));
    expect(target).toBeDefined();
    map.tiles[target!.y][target!.x] = {
      ...map.tiles[target!.y][target!.x], type: 'river', walkable: false,
    };
    const spans = reconcileFilletRaster(map);
    expect(spans.some((s) => !s.written)).toBe(true);
    const findings = roadsRibbonLegal.evaluate(ctxOf(map), {});
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].locus.tiles?.length).toBeGreaterThan(0);
  });

  it('smoothing endpoints stay pinned to the gate — the ribbon can never detach from it', () => {
    const map = grassMap(24, 24, { barrierRuns: [townRing()] });
    const edge = approachEdge();
    map.roadGraph = graphOf(edge);
    carveEdge(map, edge);
    const profile = edgeRoadProfile(map, edge, new Map(), new Map());
    expect(profile).not.toBeNull();
    const end = profile!.centerline[profile!.centerline.length - 1];
    const [gx, gy] = gatePoint(townRing().run, { t: 6, width: 3 });
    expect(Math.hypot(end.x - gx, end.y - gy)).toBeLessThan(1e-6);
  });

  it('is a no-op on a map with no road graph', () => {
    expect(roadsRibbonLegal.evaluate(ctxOf(grassMap(8, 8)), {})).toHaveLength(0);
  });
});
