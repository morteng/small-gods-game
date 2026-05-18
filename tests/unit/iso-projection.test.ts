import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToTile, visibleTileBounds } from '@/render/iso/iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';

describe('iso-projection: worldToScreen', () => {
  it('origin tile (0,0,0) maps to (originX, originY)', () => {
    const { sx, sy } = worldToScreen(0, 0, 0, 1000, 500);
    expect(sx).toBe(1000);
    expect(sy).toBe(500);
  });

  it('east tile (1,0,0) shifts +W/2 right and +H/2 down', () => {
    const { sx, sy } = worldToScreen(1, 0, 0, 0, 0);
    expect(sx).toBe(ISO_TILE_W / 2);
    expect(sy).toBe(ISO_TILE_H / 2);
  });

  it('south tile (0,1,0) shifts -W/2 left and +H/2 down', () => {
    const { sx, sy } = worldToScreen(0, 1, 0, 0, 0);
    expect(sx).toBe(-ISO_TILE_W / 2);
    expect(sy).toBe(ISO_TILE_H / 2);
  });

  it('z subtracts from sy (height lifts sprite up)', () => {
    const { sy } = worldToScreen(0, 0, 32, 0, 0);
    expect(sy).toBe(-32);
  });
});

describe('iso-projection: screenToTile (inverse)', () => {
  it('inverts worldToScreen on the foot of the tile', () => {
    for (const [tx, ty] of [[0, 0], [3, 7], [15, 2], [9, 9]]) {
      const { sx, sy } = worldToScreen(tx, ty, 0, 1000, 500);
      const tile = screenToTile(sx, sy, 1000, 500);
      expect(tile).toEqual({ tx, ty });
    }
  });

  it('picks the same tile for any point inside its diamond footprint', () => {
    const { sx: cx, sy: cy } = worldToScreen(5, 5, 0, 0, 0);
    expect(screenToTile(cx, cy, 0, 0)).toEqual({ tx: 5, ty: 5 });
    expect(screenToTile(cx + 10, cy, 0, 0)).toEqual({ tx: 5, ty: 5 });
    expect(screenToTile(cx - 10, cy, 0, 0)).toEqual({ tx: 5, ty: 5 });
  });
});

describe('iso-projection: visibleTileBounds', () => {
  it('returns a bounding tile range covering the viewport corners', () => {
    const b = visibleTileBounds({ originX: 400, originY: 300 }, 800, 600);
    expect(b.minTx).toBeLessThan(0);
    expect(b.maxTx).toBeGreaterThan(0);
    expect(b.minTy).toBeLessThan(0);
    expect(b.maxTy).toBeGreaterThan(0);
  });

  it('clamps to provided map bounds when given', () => {
    const b = visibleTileBounds({ originX: 400, originY: 300 }, 800, 600, { mapW: 128, mapH: 96 });
    expect(b.minTx).toBeGreaterThanOrEqual(0);
    expect(b.minTy).toBeGreaterThanOrEqual(0);
    expect(b.maxTx).toBeLessThan(128);
    expect(b.maxTy).toBeLessThan(96);
  });
});
