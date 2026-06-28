// tests/unit/riverside-levee.test.ts — the #24 riverside levee.
// A road running alongside open water rides up on an embankment berm; a road far from
// water does not; and the berm never raises a water tile (the river keeps its bed).
import { describe, it, expect } from 'vitest';
import { buildLeveeDeformations } from '@/world/road-deformation';
import type { GameMap, Tile } from '@/core/types';

/** A W×H map whose left column (x=0) is river water; everything else grass. */
function makeMap(edges: GameMap['roadGraph'] extends infer _ ? any : never): GameMap {
  const W = 12, H = 8;
  const tiles: Tile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < W; x++) {
      row.push({ type: x === 0 ? 'water' : 'grass', walkable: x !== 0 } as Tile);
    }
    tiles.push(row);
  }
  return { width: W, height: H, seed: 1, tiles, roadGraph: edges, worldSeed: { pois: [] } } as unknown as GameMap;
}

const roadEdge = (id: string, poly: { x: number; y: number }[]) => ({
  id, a: 'n0', b: 'n1', polyline: poly, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [],
});

describe('buildLeveeDeformations (#24)', () => {
  it('berms a road running alongside open water', () => {
    // a vertical road at x=2, one tile from the x=0 river — every vertex is "riverside"
    const map = makeMap({ nodes: [], edges: [roadEdge('r', Array.from({ length: 8 }, (_, y) => ({ x: 2, y })))] });
    const defs = buildLeveeDeformations(map);
    expect(defs.length).toBe(1);
    const d = defs[0];
    expect(d.op).toBe('add');
    expect(d.amount).toBeCloseTo(1.5, 3);
    expect(d.priority).toBe(80);                 // composes above road (30) + river-carve (40)
    expect(d.source).toBe('road:levee');
    // full berm height across the crown (centerline + half-width)...
    expect(d.mask(2, 4)).toBeCloseTo(1, 3);
    expect(d.mask(2.6, 4)).toBeCloseTo(1, 3);    // within the 1.2-tile crown
    // ...feathering down through the embankment slope, to 0 past the bank toe
    expect(d.mask(4, 4)).toBeGreaterThan(0);     // d=2.0 → mid-feather
    expect(d.mask(4, 4)).toBeLessThan(1);
    expect(d.mask(5, 4)).toBe(0);                // d=3.0 ≥ crown+feather (2.8)
  });

  it('never raises a water tile — the river keeps its bed', () => {
    const map = makeMap({ nodes: [], edges: [roadEdge('r', Array.from({ length: 8 }, (_, y) => ({ x: 1, y })))] });
    const defs = buildLeveeDeformations(map);
    expect(defs.length).toBe(1);
    expect(defs[0].mask(0, 4)).toBe(0);          // x=0 is water → masked out
  });

  it('emits nothing for a road far from any water', () => {
    const map = makeMap({ nodes: [], edges: [roadEdge('r', Array.from({ length: 8 }, (_, y) => ({ x: 9, y })))] });
    expect(buildLeveeDeformations(map)).toHaveLength(0);
  });

  it('emits nothing when the map has no road graph', () => {
    const map = makeMap(undefined);
    expect(buildLeveeDeformations(map)).toHaveLength(0);
  });

  it('splits a road into contiguous riverside sub-runs (no berm across a dry gap)', () => {
    // riverside near both ends (x=2) but veering far inland (x=10) in the middle:
    // two separate riverside runs, not one berm bridging the dry midsection.
    const poly = [
      { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
      { x: 10, y: 3 }, { x: 10, y: 4 },
      { x: 2, y: 5 }, { x: 2, y: 6 }, { x: 2, y: 7 },
    ];
    const map = makeMap({ nodes: [], edges: [roadEdge('r', poly)] });
    const defs = buildLeveeDeformations(map);
    expect(defs.length).toBe(2);                 // two runs, not one
    // neither berm covers the inland midsection
    for (const d of defs) expect(d.mask(10, 3.5)).toBe(0);
  });
});
