// tests/unit/corridor-crossings.test.ts — S3 corridor-crossing DETECTION (§9.4 "the trail gets its
// log"). Builds a small synthetic GameMap + a TrampleGrid whose promoted set is hand-authored via
// the public `hydrate(TrampleSnapshot)` seam (deposit/promoteDecay is cumbersome for a fixture),
// and pins that a promoted corridor crossing a narrow stream yields exactly one deterministic site.
import { describe, it, expect } from 'vitest';
import { detectCorridorCrossings, MAX_CORRIDOR_WATER_RUN } from '@/world/corridor-crossings';
import { TrampleGrid, type TrampleSnapshot } from '@/sim/trample';
import type { GameMap, Tile } from '@/core/types';

const W = 12, H = 12;

/** Grass map with a set of cells forced to `water` (walkable:false, as hydrology writes them). */
function mapWithWater(water: Array<[number, number]>): GameMap {
  const waterSet = new Set(water.map(([x, y]) => `${x},${y}`));
  const tiles: Tile[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => {
      const isW = waterSet.has(`${x},${y}`);
      return { type: isW ? 'water' : 'grass', x, y, walkable: !isW, state: 'realized' as const };
    }));
  return {
    tiles, width: W, height: H, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

const isWaterFor = (map: GameMap) => (x: number, y: number): boolean =>
  map.tiles[y]?.[x]?.type === 'water';

/** A TrampleGrid with exactly the given cells promoted (via the public snapshot seam). */
function gridWithPromoted(promoted: Array<[number, number]>): TrampleGrid {
  const snap: TrampleSnapshot = {
    width: W, height: H,
    // A promoted cell always retains wear (promoted keys ⊆ accum keys); mirror it so the
    // fixture matches the class invariant even though isPromoted only reads `promoted`.
    cells: promoted.map(([x, y]) => [y * W + x, 200] as [number, number]),
    promoted: promoted.map(([x, y]) => [y * W + x, 'grass'] as [number, string]),
  };
  const g = new TrampleGrid(W, H);
  g.hydrate(snap);
  return g;
}

function run(promoted: Array<[number, number]>, water: Array<[number, number]>) {
  const map = mapWithWater(water);
  const grid = gridWithPromoted(promoted);
  return detectCorridorCrossings(grid, map, isWaterFor(map));
}

describe('detectCorridorCrossings', () => {
  it('1) a promoted chain across a 2-wide stream → one site (banks/water/axis/spanTiles)', () => {
    // Horizontal crossing: banks at x=3,6 (y=5), water at x=4,5.
    const sites = run([[3, 5], [6, 5]], [[4, 5], [5, 5]]);
    expect(sites).toHaveLength(1);
    const s = sites[0];
    expect(s.corridorId).toBe('corridor:3,5');
    expect(s.banks).toEqual([{ x: 3, y: 5 }, { x: 6, y: 5 }]);
    expect(s.water).toEqual([{ x: 4, y: 5 }, { x: 5, y: 5 }]);
    expect(s.axis).toEqual([1, 0]);
    expect(s.spanTiles).toBe(3); // water run (2) + 1
  });

  it('2) a 4-wide run (> MAX) → no site', () => {
    expect(MAX_CORRIDOR_WATER_RUN).toBe(3);
    const sites = run([[2, 5], [7, 5]], [[3, 5], [4, 5], [5, 5], [6, 5]]);
    expect(sites).toHaveLength(0);
  });

  it('2b) a 3-wide run (== MAX) is still accepted', () => {
    const sites = run([[2, 5], [6, 5]], [[3, 5], [4, 5], [5, 5]]);
    expect(sites).toHaveLength(1);
    expect(sites[0].spanTiles).toBe(4);
  });

  it('3) far bank not promoted → no site', () => {
    // Near bank promoted, far bank (6,5) is plain walkable land, no promoted lateral neighbour.
    const sites = run([[3, 5]], [[4, 5], [5, 5]]);
    expect(sites).toHaveLength(0);
  });

  it('4) scan-direction dedupe: both banks promoted → exactly one, canonical id keyed on smaller bank', () => {
    const sites = run([[3, 5], [6, 5]], [[4, 5], [5, 5]]);
    expect(sites).toHaveLength(1);
    // Keyed on the (y,x)-smaller bank (3,5), NOT the far bank (6,5) — found once, not twice.
    expect(sites[0].corridorId).toBe('corridor:3,5');
  });

  it('5) lateral dedupe: two parallel promoted rows crossing side by side → one site', () => {
    // Rows y=5 and y=6 both cross the same x=4,5 water span; one log for the corridor.
    const sites = run(
      [[3, 5], [6, 5], [3, 6], [6, 6]],
      [[4, 5], [5, 5], [4, 6], [5, 6]],
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].corridorId).toBe('corridor:3,5'); // lexicographically-smallest kept
  });

  it('6) a vertical (0,1)-axis crossing is detected too', () => {
    // Banks at y=3,6 (x=5), water at y=4,5.
    const sites = run([[5, 3], [5, 6]], [[5, 4], [5, 5]]);
    expect(sites).toHaveLength(1);
    const s = sites[0];
    expect(s.axis).toEqual([0, 1]);
    expect(s.banks).toEqual([{ x: 5, y: 3 }, { x: 5, y: 6 }]);
    expect(s.water).toEqual([{ x: 5, y: 4 }, { x: 5, y: 5 }]);
    expect(s.spanTiles).toBe(3);
    expect(s.corridorId).toBe('corridor:5,3');
  });

  it('7) determinism: two identical inputs → deep-equal outputs', () => {
    const a = run([[3, 5], [6, 5], [5, 3], [5, 6]], [[4, 5], [5, 5], [5, 4]]);
    const b = run([[3, 5], [6, 5], [5, 3], [5, 6]], [[4, 5], [5, 5], [5, 4]]);
    expect(a).toEqual(b);
    // And the output is sorted by corridorId.
    const ids = a.map((s) => s.corridorId);
    expect(ids).toEqual([...ids].sort());
  });

  it('8) trail wobble: far bank promoted one cell off the axis is accepted (banks stay axis-aligned)', () => {
    // Far axis cell (6,5) is walkable land but NOT promoted; its lateral neighbour (6,6) IS.
    const sites = run([[3, 5], [6, 6]], [[4, 5], [5, 5]]);
    expect(sites).toHaveLength(1);
    const s = sites[0];
    expect(s.banks).toEqual([{ x: 3, y: 5 }, { x: 6, y: 5 }]); // axis-aligned banks reported
    expect(s.axis).toEqual([1, 0]);
  });

  it('9) bounds-safe: a promoted cell on the right/bottom edge (axis marches off-map) yields nothing', () => {
    // Promoted cells at the far edge; +x and +y both step out of bounds → no crash, no site.
    const sites = run([[W - 1, 5], [5, H - 1]], []);
    expect(sites).toHaveLength(0);
  });
});
