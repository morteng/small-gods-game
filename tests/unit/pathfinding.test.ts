import { describe, it, expect } from 'vitest';
import { findPath, isWalkable, tileCost, pickRandomDestination } from '@/sim/pathfinding';
import type { GameMap, Tile } from '@/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMap(w: number, h: number, overrides?: (x: number, y: number) => Partial<Tile>): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      const base: Tile = { type: 'grass', x, y, walkable: true, state: 'realized' };
      if (overrides) Object.assign(base, overrides(x, y));
      row.push(base);
    }
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

// ─── tileCost ───────────────────────────────────────────────────────────────

describe('tileCost', () => {
  it('returns 1.0 for grass', () => {
    expect(tileCost({ type: 'grass' } as Tile)).toBe(1.0);
  });

  it('returns 0.5 for road variants', () => {
    expect(tileCost({ type: 'road' } as Tile)).toBe(0.5);
    expect(tileCost({ type: 'road_ns' } as Tile)).toBe(0.5);
    expect(tileCost({ type: 'dirt_road' } as Tile)).toBe(0.5);
    expect(tileCost({ type: 'stone_road_ew' } as Tile)).toBe(0.5);
    expect(tileCost({ type: 'bridge' } as Tile)).toBe(0.5);
    expect(tileCost({ type: 'dirt' } as Tile)).toBe(0.5);
  });

  it('returns 2.0 for forest tiles', () => {
    expect(tileCost({ type: 'forest' } as Tile)).toBe(2.0);
    expect(tileCost({ type: 'dense_forest' } as Tile)).toBe(2.0);
    expect(tileCost({ type: 'pine_forest' } as Tile)).toBe(2.0);
    expect(tileCost({ type: 'dead_forest' } as Tile)).toBe(2.0);
  });

  it('returns 1.5 for hills', () => {
    expect(tileCost({ type: 'hill' } as Tile)).toBe(1.5);
    expect(tileCost({ type: 'hills' } as Tile)).toBe(1.5);
  });

  it('returns Infinity for impassable terrain', () => {
    for (const t of ['water', 'deep_water', 'shallow_water', 'river', 'mountain', 'peak', 'cliffs']) {
      expect(tileCost({ type: t } as Tile)).toBe(Infinity);
    }
  });
});

// ─── isWalkable ─────────────────────────────────────────────────────────────

describe('isWalkable', () => {
  const map = makeMap(5, 5, (x, y) => {
    if (x === 0 && y === 0) return { type: 'water', walkable: false };
    if (x === 1 && y === 0) return { type: 'mountain' };
    if (x === 2 && y === 0) return { state: 'void' };
    return {};
  });

  it('rejects water tiles', () => {
    expect(isWalkable(map, 0, 0)).toBe(false);
  });

  it('rejects mountain tiles', () => {
    expect(isWalkable(map, 1, 0)).toBe(false);
  });

  it('rejects void tiles', () => {
    expect(isWalkable(map, 2, 0)).toBe(false);
  });

  it('accepts grass tiles', () => {
    expect(isWalkable(map, 3, 0)).toBe(true);
  });

  it('rejects out-of-bounds', () => {
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, 5, 0)).toBe(false);
    expect(isWalkable(map, 0, -1)).toBe(false);
    expect(isWalkable(map, 0, 5)).toBe(false);
  });

  it('rejects non-walkable flag', () => {
    const m = makeMap(3, 3, (x, y) => {
      if (x === 1 && y === 1) return { walkable: false };
      return {};
    });
    expect(isWalkable(m, 1, 1)).toBe(false);
    expect(isWalkable(m, 0, 0)).toBe(true);
  });
});

// ─── findPath ───────────────────────────────────────────────────────────────

describe('findPath', () => {
  it('returns a path between two open tiles', () => {
    const map = makeMap(10, 10);
    const result = findPath(map, 0, 0, 5, 5);
    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThanOrEqual(2);
    expect(result!.path[0]).toEqual({ x: 0, y: 0 });
    expect(result!.path[result!.path.length - 1]).toEqual({ x: 5, y: 5 });
  });

  it('returns null when start is impassable', () => {
    const map = makeMap(5, 5, (x, y) => x === 0 && y === 0 ? { type: 'water' } : {});
    expect(findPath(map, 0, 0, 3, 3)).toBeNull();
  });

  it('returns null when end is impassable', () => {
    const map = makeMap(5, 5, (x, y) => x === 3 && y === 3 ? { type: 'mountain' } : {});
    expect(findPath(map, 0, 0, 3, 3)).toBeNull();
  });

  it('returns null when tiles are separated by water', () => {
    const map = makeMap(5, 5, (x, y) => {
      // Water wall at x=2
      if (x === 2 && y >= 0 && y < 5) return { type: 'water' };
      return {};
    });
    const result = findPath(map, 0, 0, 4, 0);
    expect(result).toBeNull();
  });

  it('returns single-tile path when start equals end', () => {
    const map = makeMap(10, 10);
    const result = findPath(map, 3, 3, 3, 3);
    expect(result).not.toBeNull();
    expect(result!.path).toEqual([{ x: 3, y: 3 }]);
    expect(result!.cost).toBe(0);
  });

  it('floors fractional coordinates', () => {
    const map = makeMap(10, 10);
    const result = findPath(map, 3.7, 4.2, 5.1, 6.9);
    expect(result).not.toBeNull();
    expect(result!.path[0]).toEqual({ x: 3, y: 4 });
  });

  it('prefers roads over grass (lower cost path)', () => {
    const map = makeMap(10, 10, (x, y) => {
      // Road at y=5 spanning x 0..7
      if (y === 5 && x >= 0 && x <= 7) return { type: 'road' };
      return {};
    });
    const result = findPath(map, 0, 0, 7, 7);
    expect(result).not.toBeNull();
    // The path should route through the road at y=5
    const roadTiles = result!.path.filter(p => p.y === 5);
    expect(roadTiles.length).toBeGreaterThanOrEqual(2);
    // Cost should be cheaper than a full-grass diagonal
    expect(result!.cost).toBeLessThan(12);
  });

  it('avoids forests when roads are available', () => {
    const map = makeMap(10, 10, (x, y) => {
      if (y === 4 && x >= 0 && x <= 7) return { type: 'road' };
      if (x >= 1 && x <= 6 && y >= 1 && y <= 6) return { type: 'forest' };
      return { type: 'grass' };
    });
    const result = findPath(map, 0, 7, 7, 7);
    expect(result).not.toBeNull();
    // The path should avoid the forest
    for (const p of result!.path) {
      // Forest tiles at positions 1-6, 1-6 should not appear
      if (p.x >= 1 && p.x <= 6 && p.y >= 1 && p.y <= 6) {
        expect.fail(`Path went through forest at ${p.x},${p.y}`);
      }
    }
  });

  it('navigates around a 1-tile obstacle', () => {
    const map = makeMap(5, 3, (x, y) => {
      if (x === 2 && y === 1) return { type: 'water' };
      return {};
    });
    const result = findPath(map, 1, 1, 3, 1);
    expect(result).not.toBeNull();
    // Must go around: either (2,0)→(3,0)→(3,1) or (2,2)→(3,2)→(3,1)
    expect(result!.path.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── pickRandomDestination ──────────────────────────────────────────────────

describe('pickRandomDestination', () => {
  it('returns a walkable tile within radius', () => {
    const map = makeMap(20, 20);
    const rng = { next: () => 0.3 };
    const dest = pickRandomDestination(map, 10, 10, 5, rng);
    expect(dest).not.toBeNull();
    expect(isWalkable(map, dest!.x, dest!.y)).toBe(true);
    expect(Math.abs(dest!.x - 10)).toBeLessThanOrEqual(5);
    expect(Math.abs(dest!.y - 10)).toBeLessThanOrEqual(5);
  });

  it('returns null when map is all water', () => {
    const map = makeMap(10, 10, () => ({ type: 'water' }));
    const rng = { next: () => 0.5 };
    expect(pickRandomDestination(map, 5, 5, 5, rng)).toBeNull();
  });
});