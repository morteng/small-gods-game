import { describe, it, expect } from 'vitest';
import { isoStageTransform } from '@/render/iso/entity-draw-list';
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
