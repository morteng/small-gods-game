import { describe, it, expect } from 'vitest';
import { worldToScreen } from '@/render/iso/iso-projection';
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
