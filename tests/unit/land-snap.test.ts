import { describe, it, expect } from 'vitest';
import { snapToLand, isWaterTile } from '@/world/land-snap';
import type { GameMap, Tile } from '@/core/types';

// Minimal map factory: a `type` grid → tiles. 'g' = grass (land), '~' = deep_water.
function mapFrom(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) =>
    [...row].map((ch, x): Tile => ({
      type: ch === '~' ? 'deep_water' : 'grass',
      walkable: ch !== '~',
      state: 'realized',
      x, y,
    } as unknown as Tile)),
  );
  return { width: w, height: h, tiles } as unknown as GameMap;
}

describe('snapToLand', () => {
  it('returns the tile unchanged when it is already land', () => {
    const map = mapFrom(['ggg', 'ggg', 'ggg']);
    expect(snapToLand(map, 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it('snaps a water tile to the nearest land tile', () => {
    // centre is water, ring is land → nearest ring tile chosen
    const map = mapFrom(['ggg', 'g~g', 'ggg']);
    const r = snapToLand(map, 1, 1);
    expect(isWaterTile(map, r.x, r.y)).toBe(false);
    // nearest land is one ring out (orthogonal neighbour)
    expect(Math.max(Math.abs(r.x - 1), Math.abs(r.y - 1))).toBe(1);
  });

  it('clamps out-of-bounds input into the map first', () => {
    const map = mapFrom(['gg', 'gg']);
    expect(snapToLand(map, 99, -5)).toEqual({ x: 1, y: 0 });
  });

  it('returns the clamped origin when everything within range is water', () => {
    const map = mapFrom(['~~~', '~~~', '~~~']);
    expect(snapToLand(map, 1, 1, 3)).toEqual({ x: 1, y: 1 });
  });

  it('reaches land across a multi-tile water margin', () => {
    // a 5-wide lake row with land only at the far ends
    const map = mapFrom(['g~~~g']);
    const r = snapToLand(map, 2, 0);
    expect(isWaterTile(map, r.x, r.y)).toBe(false);
  });
});
