// tests/unit/repair-connection-splits.test.ts — the end-to-end road invariant: every
// seed-declared connection is ONE 4-connected component after all carving. The repair is
// the degenerate-case pass behind carve-connections.test.ts (a settlement-interior
// re-route can silently split the inter-POI network — see WCV 93).
import { describe, it, expect } from 'vitest';
import { repairConnectionSplits } from '@/world/road-graph';
import type { Connection, POI, Tile } from '@/core/types';

const W = 16, H = 7;

function grid(roadCells: Array<[number, number]>, waterCols: number[] = []): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < W; x++) {
      const type = waterCols.includes(x) ? 'water' : 'grass';
      row.push({ x, y, type, walkable: type !== 'water' } as unknown as Tile);
    }
    tiles.push(row);
  }
  for (const [x, y] of roadCells) { tiles[y][x].type = 'dirt_road'; tiles[y][x].walkable = true; }
  return tiles;
}

const pois: POI[] = [
  { id: 'a', type: 'village', name: 'A', position: { x: 1, y: 3 } } as POI,
  { id: 'b', type: 'village', name: 'B', position: { x: 14, y: 3 } } as POI,
];
const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road', style: 'dirt' } as Connection];

const flood = (tiles: Tile[][], sx: number, sy: number): Set<string> => {
  const seen = new Set<string>();
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop()!;
    const k = `${x},${y}`;
    if (seen.has(k) || !['dirt_road', 'stone_road', 'bridge'].includes(tiles[y]?.[x]?.type ?? '')) continue;
    seen.add(k);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
};

describe('repairConnectionSplits', () => {
  it('bridges a split connection with a minimal dirt_road connector', () => {
    // Two road islands: x1..5 and x10..14 on row 3 — a 4-tile gap.
    const tiles = grid([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3]]);
    const carved = repairConnectionSplits(tiles, W, H, conns, pois);
    expect(carved).toBe(4);
    expect(flood(tiles, 1, 3).has('14,3')).toBe(true);
  });

  it('is a no-op when the connection is already one component', () => {
    const tiles = grid(Array.from({ length: 14 }, (_, i) => [i + 1, 3] as [number, number]));
    expect(repairConnectionSplits(tiles, W, H, conns, pois)).toBe(0);
  });

  it('routes the connector around blocked cells', () => {
    // Straight-line gap cells are blocked (a building parcel) — repair must detour.
    const tiles = grid([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3]]);
    const blocked = (x: number, y: number): boolean => y === 3 && x >= 6 && x <= 9;
    const carved = repairConnectionSplits(tiles, W, H, conns, pois, blocked);
    expect(carved).toBeGreaterThan(4);   // detour is longer than the straight gap
    expect(flood(tiles, 1, 3).has('14,3')).toBe(true);
    for (let x = 6; x <= 9; x++) expect(tiles[3][x].type).not.toBe('dirt_road');
  });

  it('gives up (without carving over water) when no legal land path exists', () => {
    // A full-height water column between the islands and everything else blocked.
    const tiles = grid([[1, 3], [2, 3], [12, 3], [13, 3], [14, 3]], [7]);
    const blocked = (x: number, _y: number): boolean => x >= 4 && x <= 10 && x !== 7;
    const carved = repairConnectionSplits(tiles, W, H, conns, pois, blocked);
    expect(carved).toBe(0);
    for (let y = 0; y < H; y++) expect(tiles[y][7].type).toBe('water');
  });
});
