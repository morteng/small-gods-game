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
  it('blits 1:1 at native size when the sprite was authored to the footprint', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    // 2x2 footprint → diamond width (2+2)*64 = 256; sprite authored 256x240.
    const img = { naturalWidth: 256, naturalHeight: 240 } as any;
    drawIsoBuildingSprite(dc, img, 0, 0, { w: 2, h: 2 });

    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw).toBeTruthy();
    expect(ctx.calls.some((c: any[]) => c[0] === 'smoothing' && c[1] === false)).toBe(true);
    // dest width === native width (no fractional scale at zoom 1)
    expect(draw[4]).toBe(256); // dest width
    expect(draw[5]).toBe(240); // dest height === native height (aspect preserved)
  });

  it('anchors the bottom at the south tip, centred on the footprint', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    const img = { naturalWidth: 256, naturalHeight: 240 } as any;
    drawIsoBuildingSprite(dc, img, 0, 0, { w: 2, h: 2 });
    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    // south corner = worldToScreen(2,2,0) = (0,128); cx = 0
    expect(draw[2]).toBe(-128); // x = cx - drawW/2 = 0 - 128
    expect(draw[3]).toBe(128 - 240); // y = south.sy - drawH
  });

  it('scales to span the footprint when the sprite is undersized (clamped gen)', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    // 5x2 longhouse → diamond width (5+2)*64 = 448; sprite clamped to 256 wide.
    const img = { naturalWidth: 256, naturalHeight: 256 } as any;
    drawIsoBuildingSprite(dc, img, 0, 0, { w: 5, h: 2 });
    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw[4]).toBe(448); // dest width spans the full footprint diamond
    expect(draw[5]).toBe(448); // aspect (256/256=1) preserved
  });
});
