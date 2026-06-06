import { describe, it, expect, vi } from 'vitest';
import { drawIsoBuildingSprite } from '@/render/iso/iso-building';

function fakeCtx() {
  const calls: any[] = [];
  return {
    calls,
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
    beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(),
    drawImage: vi.fn((...a: any[]) => calls.push(['drawImage', ...a])),
    set imageSmoothingEnabled(v: boolean) { calls.push(['smoothing', v]); },
    get imageSmoothingEnabled() { return false; },
    fillStyle: '',
  } as any;
}

describe('drawIsoBuildingSprite', () => {
  it('draws the image once with smoothing disabled, width scaled to footprint', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    const img = { width: 128, height: 128 } as any;
    drawIsoBuildingSprite(dc, img, 4, 4, { w: 2, h: 2 });
    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw).toBeTruthy();
    expect(ctx.calls.some((c: any[]) => c[0] === 'smoothing' && c[1] === false)).toBe(true);
    // displayW = (2+2) * (ISO_TILE_W/2=64) * 0.55 = 140.8
    const displayW = draw[4];
    expect(displayW).toBeCloseTo(140.8, 1);
    expect(draw[5]).toBeCloseTo(140.8, 1); // square source → square display
  });
});
