import { describe, it, expect } from 'vitest';
import { computeHomeParcel } from '@/world/settlement-parcels';
import type { Tile } from '@/core/types';

// Build a tile grid from an ASCII map: '.' land, '~' river/water.
function grid(rows: string[]): Tile[][] {
  return rows.map((row, y) => [...row].map((ch, x): Tile => ({
    type: ch === '~' ? 'river' : 'grass', x, y, walkable: ch !== '~', state: 'realized',
  })));
}

describe('computeHomeParcel — home-bank flood fill', () => {
  it('excludes the far bank across a vertical river', () => {
    // centre at (1,2) on the west bank; a river column at x=4 splits the map.
    const tiles = grid([
      '....~....',
      '....~....',
      '....~....',
      '....~....',
      '....~....',
    ]);
    const mask = computeHomeParcel(1, 2, tiles, 8)!;
    expect(mask).not.toBeNull();
    expect(mask.has('1,2')).toBe(true);   // centre
    expect(mask.has('3,2')).toBe(true);   // same (west) bank, up to the river
    expect(mask.has('4,2')).toBe(false);  // the river itself
    expect(mask.has('5,2')).toBe(false);  // FAR bank — excluded
    expect(mask.has('8,0')).toBe(false);  // far-bank corner — excluded
  });

  it('does not leak diagonally across a 1-tile diagonal river (4-connectivity)', () => {
    // a diagonal water seam; a west-bank centre must not reach the east cells.
    const tiles = grid([
      '..~....',
      '...~...',
      '....~..',
      '.....~.',
    ]);
    const mask = computeHomeParcel(0, 0, tiles, 8)!;
    expect(mask.has('0,0')).toBe(true);
    expect(mask.has('1,0')).toBe(true);
    expect(mask.has('3,0')).toBe(false); // east of the seam at row 0
    expect(mask.has('6,3')).toBe(false); // far side
  });

  it('returns null when there is no water in reach (nothing to confine)', () => {
    const tiles = grid(['....', '....', '....']);
    expect(computeHomeParcel(1, 1, tiles, 8)).toBeNull();
  });

  it('returns null when the centre itself is on water', () => {
    const tiles = grid(['..~..', '..~..', '..~..']);
    expect(computeHomeParcel(2, 1, tiles, 8)).toBeNull();
  });

  it('is bounded by reach — same-bank cells outside the box are excluded', () => {
    const tiles = grid([
      '.~.........',
      '.~.........',
      '.~.........',
    ]);
    // river at x=1 sits within reach 3 of centre (4,1) → non-degenerate; box is x∈[1,7].
    const mask = computeHomeParcel(4, 1, tiles, 3)!;
    expect(mask.has('4,1')).toBe(true);
    expect(mask.has('7,1')).toBe(true);   // within reach
    expect(mask.has('8,1')).toBe(false);  // outside the reach box
    expect(mask.has('0,1')).toBe(false);  // far (west) bank, across the river
  });
});
