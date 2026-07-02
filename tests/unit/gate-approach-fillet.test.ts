import { describe, it, expect } from 'vitest';
import { edgeRoadProfile } from '@/world/road-deformation';
import { realGateProfiles } from '@/world/connectome/gate-approach';
import type { RoadEdge } from '@/world/road-graph';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun, PlacedBarrier } from '@/world/barrier';

/** Square town ring with one real gate mid-way along its TOP edge (facing north). */
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

function grassMap(w: number, h: number, barrierRuns: PlacedBarrier[]): GameMap {
  const tiles: Tile[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], barrierRuns,
  } as unknown as GameMap;
}

/** A road that reaches the gate from the north-WEST — a skewed, kinked approach. */
function approachEdge(): RoadEdge {
  return {
    id: 'e1', a: 'n1', b: 'n2', feature: 'road', class: 'road', surface: 'dirt',
    bridgeCells: [],
    polyline: [{ x: 2, y: 0 }, { x: 4, y: 1 }, { x: 6, y: 2 }, { x: 8, y: 3 }, { x: 10, y: 4 }],
  } as unknown as RoadEdge;
}

/** Unit tangent of the last centerline segment. */
function arrivalHeading(line: { x: number; y: number }[]): [number, number] {
  const a = line[line.length - 2], b = line[line.length - 1];
  const m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return [(b.x - a.x) / m, (b.y - a.y) / m];
}

describe('gate-approach fillet (roads arrive square through town gates)', () => {
  it('realGateProfiles reports the gate position + outward facing', () => {
    const gates = realGateProfiles([townRing()]);
    expect(gates).toHaveLength(1);
    expect(gates[0].x).toBeCloseTo(10);
    expect(gates[0].y).toBeCloseTo(4);
    // Top edge of the ring — outward is north.
    expect(gates[0].facing[0]).toBeCloseTo(0, 5);
    expect(gates[0].facing[1]).toBeCloseTo(-1, 5);
  });

  it('an edge ending at a gate is filleted to arrive along the gate axis', () => {
    const profile = edgeRoadProfile(grassMap(24, 24, [townRing()]), approachEdge(), new Map(), new Map());
    expect(profile).not.toBeNull();
    const line = profile!.centerline;
    // Still ends at the gate point…
    expect(line[line.length - 1].x).toBeCloseTo(10, 1);
    expect(line[line.length - 1].y).toBeCloseTo(4, 1);
    // …but now heading INTO the town (south, = −facing): the skew is absorbed upstream.
    const [hx, hy] = arrivalHeading(line);
    expect(hy).toBeGreaterThan(0.95);
    expect(Math.abs(hx)).toBeLessThan(0.3);
  });

  it('without a ring the same edge keeps its skewed arrival (fillet is gate-gated)', () => {
    const profile = edgeRoadProfile(grassMap(24, 24, []), approachEdge(), new Map(), new Map());
    const [, hy] = arrivalHeading(profile!.centerline);
    expect(hy).toBeLessThan(0.95);                       // still arriving at a slant
  });
});
