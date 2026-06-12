import { describe, it, expect, vi } from 'vitest';
import { isoStageTransform } from '@/render/iso/entity-draw-list';
import { executeDrawListCanvas, type DrawItem } from '@/render/iso/draw-list';
import { buildingSpriteItemFromPack } from '@/render/iso/iso-building';
import type { SpritePack } from '@/render/iso/sprite-canvas';

describe('buildingSpriteItemFromPack', () => {
  const o = { originX: 0, originY: 0 };
  const canvas = (w = 64, h = 48) => ({ width: w, height: h } as unknown as HTMLCanvasElement);

  it('attaches the companion maps to the image item (same placement as the albedo)', () => {
    const pack: SpritePack = { albedo: canvas(), normal: canvas(), material: canvas() };
    const item = buildingSpriteItemFromPack(o, pack, 3, 4, { w: 2, h: 2 });
    expect(item.t).toBe('image');
    if (item.t !== 'image') return;
    expect(item.src).toBe(pack.albedo);
    expect(item.maps?.normal).toBe(pack.normal);
    expect(item.maps?.material).toBe(pack.material);
  });

  it('omits maps entirely for an albedo-only pack (unlit path)', () => {
    const item = buildingSpriteItemFromPack(o, { albedo: canvas() }, 3, 4, { w: 2, h: 2 });
    expect(item.t === 'image' && item.maps).toBeUndefined();
  });
});

describe('isoStageTransform', () => {
  it('mirrors the Canvas2D world transform exactly (scale ∘ snapped translate)', () => {
    // Canvas2D path: ctx.scale(z) then ctx.translate(round(-cam·z)/z) — net
    // screen offset = round(-cam·z) CSS px. The stage must land on the SAME px.
    for (const [x, y, z] of [[10.3, 20.7, 2], [0, 0, 1], [-5.5, 3.25, 0.5], [100.49, 7.51, 4]] as const) {
      const t = isoStageTransform({ x, y, zoom: z });
      expect(t.scale).toBe(z);
      // a world point w maps to: ctx → z·(w + round(-x·z)/z) = z·w + round(-x·z)
      //                          stage → z·w + t.x
      expect(t.x).toBe(Math.round(-x * z));
      expect(t.y).toBe(Math.round(-y * z));
    }
  });
});

describe('executeDrawListCanvas', () => {
  function mockCtx() {
    return {
      drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      closePath: vi.fn(), fill: vi.fn(), arc: vi.fn(),
      imageSmoothingEnabled: true, fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
  }

  const img = {} as CanvasImageSource;

  it('draws framed images with the 9-arg form and whole images with the 5-arg form', () => {
    const ctx = mockCtx();
    const items: DrawItem[] = [
      { t: 'image', src: img, frame: { sx: 64, sy: 128, sw: 64, sh: 64 }, dx: 1, dy: 2, dw: 64, dh: 64 },
      { t: 'image', src: img, dx: 3, dy: 4, dw: 32, dh: 32 },
    ];
    executeDrawListCanvas(ctx, items);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, img, 64, 128, 64, 64, 1, 2, 64, 64);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, img, 3, 4, 32, 32);
    expect(ctx.imageSmoothingEnabled).toBe(false); // pixel-art 1:1 rule
  });

  it('fills polys as closed paths and circles as full arcs', () => {
    const ctx = mockCtx();
    executeDrawListCanvas(ctx, [
      { t: 'poly', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], color: '#abcdef' },
      { t: 'circle', cx: 7, cy: 8, r: 3, color: '#123456' },
    ]);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledWith(7, 8, 3, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });
});
