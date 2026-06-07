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
  it('blits at NATIVE size (no rescale to the footprint diamond) — true 1:1', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    // 2x2 footprint → diamond width (2+2)*64 = 256; sprite authored 256x240.
    const img = { naturalWidth: 256, naturalHeight: 240 } as any;
    drawIsoBuildingSprite(dc, img, 0, 0, { w: 2, h: 2 });

    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw).toBeTruthy();
    expect(ctx.calls.some((c: any[]) => c[0] === 'smoothing' && c[1] === false)).toBe(true);
    // dest size === native size exactly (one source px == one screen px at zoom 1)
    expect(draw[4]).toBe(256); // dest width === naturalWidth
    expect(draw[5]).toBe(240); // dest height === naturalHeight
  });

  it('anchors the bottom at the south tip, centred on the footprint', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    const img = { naturalWidth: 256, naturalHeight: 240 } as any;
    drawIsoBuildingSprite(dc, img, 0, 0, { w: 2, h: 2 });
    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    // front tile (1,1) centre = worldToScreen(1,1,0) = (0,64); south tip = +32 = 96; cx = 0
    expect(draw[2]).toBe(-128); // x = cx - natW/2 = 0 - 128
    expect(draw[3]).toBe(96 - 240); // y = footprint south tip - natH
  });

  it('does NOT stretch an undersized sprite to span the footprint', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    // 3x3 footprint → diamond width 384; an undersized 200x180 sprite stays 200x180.
    const img = { naturalWidth: 200, naturalHeight: 180 } as any;
    drawIsoBuildingSprite(dc, img, 0, 0, { w: 3, h: 3 });
    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw[4]).toBe(200); // native width — NOT stretched to 384
    expect(draw[5]).toBe(180); // native height
    // front tile (2,2) centre = worldToScreen(2,2,0) = (0,128); south tip = +32 = 160; cx = 0
    expect(draw[2]).toBe(-100); // cx - natW/2
    expect(draw[3]).toBe(160 - 180);
  });
});
