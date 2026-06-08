import { describe, it, expect } from 'vitest';
import { drawIsoBuildingSpriteGenerated } from '@/render/iso/iso-building';
import type { IsoDrawCtx } from '@/render/iso/iso-sprites';

function fakeCtx() {
  const calls: Array<{ w: number; h: number; dx: number; dy: number }> = [];
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage: (_img: unknown, dx: number, dy: number, w: number, h: number) => calls.push({ dx, dy, w, h }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawIsoBuildingSpriteGenerated', () => {
  it('blits the canvas at its native size once', () => {
    const { ctx, calls } = fakeCtx();
    const dc = { ctx, atlas: {}, originX: 0, originY: 0 } as unknown as IsoDrawCtx;
    const sprite = { width: 40, height: 30 } as unknown as HTMLCanvasElement;
    drawIsoBuildingSpriteGenerated(dc, sprite, 2, 2, { w: 3, h: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].w).toBe(40);
    expect(calls[0].h).toBe(30);
  });
});
