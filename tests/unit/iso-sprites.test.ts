import { describe, it, expect, vi } from 'vitest';
import { drawIsoArtBillboard } from '@/render/iso/iso-sprites';

function fakeCtx() {
  const calls: any[] = [];
  return {
    calls,
    save: vi.fn(), restore: vi.fn(),
    translate: vi.fn((...a: any[]) => calls.push(['translate', ...a])),
    drawImage: vi.fn((...a: any[]) => calls.push(['drawImage', ...a])),
    set imageSmoothingEnabled(v: boolean) { calls.push(['smoothing', v]); },
    get imageSmoothingEnabled() { return false; },
  } as any;
}

describe('drawIsoArtBillboard (decoration / prop)', () => {
  it('blits at the art NATIVE size (no tile-fraction scaling) — true 1:1', () => {
    const ctx = fakeCtx();
    const dc = { ctx, originX: 0, originY: 0 } as any;
    const img = { naturalWidth: 96, naturalHeight: 128 } as any;
    drawIsoArtBillboard(dc, img, 0, 0);

    const draw = ctx.calls.find((c: any[]) => c[0] === 'drawImage');
    expect(draw).toBeTruthy();
    expect(ctx.calls.some((c: any[]) => c[0] === 'smoothing' && c[1] === false)).toBe(true);
    // drawImage(img, dx, dy, dw, dh): args [2]=dx [3]=dy [4]=dw [5]=dh
    expect(draw[4]).toBe(96);  // dest width === naturalWidth
    expect(draw[5]).toBe(128); // dest height === naturalHeight
    // base anchored at the translated tile centre: (-w/2, -h)
    expect(draw[2]).toBe(-48); // -round(96/2)
    expect(draw[3]).toBe(-128);
  });
});
