import { describe, it, expect } from 'vitest';
import { getTerrainSpriteCoords, LPC_TILE_SIZE } from '@/render/terrain-atlas';

describe('getTerrainSpriteCoords', () => {
  it('maps blobIndex 0 to col 0, row 0', () => {
    expect(getTerrainSpriteCoords(0)).toEqual({ col: 0, row: 0 });
  });

  it('maps blobIndex 5 to col 5, row 0 (last in first row)', () => {
    expect(getTerrainSpriteCoords(5)).toEqual({ col: 5, row: 0 });
  });

  it('maps blobIndex 6 to col 0, row 1 (wraps to next row)', () => {
    expect(getTerrainSpriteCoords(6)).toEqual({ col: 0, row: 1 });
  });

  it('maps blobIndex 46 to col 4, row 7 (last valid blob index)', () => {
    expect(getTerrainSpriteCoords(46)).toEqual({ col: 4, row: 7 });
  });

  it('exports LPC_TILE_SIZE as 32', () => {
    expect(LPC_TILE_SIZE).toBe(32);
  });
});
