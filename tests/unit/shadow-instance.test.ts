import { describe, it, expect } from 'vitest';
import {
  buildShadowBatches, packShadowInstances, shadowDrawCalls,
  SHADOW_ALPHA, SHADOW_INSTANCE_FLOATS, SHADOW_INSTANCE_STRIDE,
} from '@/render/gpu/shadow-instance';
import type { DrawItem } from '@/render/iso/draw-list';
import type { LightingState } from '@/render/lighting-state';

// A fake CanvasImageSource — only width/height are read by srcSize.
const tex = (w = 64, h = 64): CanvasImageSource =>
  ({ width: w, height: h } as unknown as CanvasImageSource);

type ImageItem = Extract<DrawItem, { t: 'image' }>;
const img = (over: Partial<ImageItem> = {}): ImageItem => ({
  t: 'image', src: tex(), dx: 100, dy: 50, dw: 32, dh: 48, ...over,
});

const lighting = (over: Partial<LightingState> = {}): LightingState => ({
  enabled: true, shadowMode: 'silhouette',
  ambient: [0.7, 0.7, 0.7], sunDir: [-0.5, 0.65, 0.58], sunColor: [0.4, 0.4, 0.4], bands: 4,
  ...over,
});

describe('shadow-instance — cast-shadow parallelograms', () => {
  it('constants: 12 floats / 48 bytes / 0.32 alpha', () => {
    expect(SHADOW_INSTANCE_FLOATS).toBe(12);
    expect(SHADOW_INSTANCE_STRIDE).toBe(48);
    expect(SHADOW_ALPHA).toBeCloseTo(0.32);
  });

  it('returns [] when lighting disabled or shadows off', () => {
    expect(buildShadowBatches([img()], lighting({ enabled: false }))).toEqual([]);
    expect(buildShadowBatches([img()], lighting({ shadowMode: 'off' }))).toEqual([]);
  });

  it('ignores non-image items', () => {
    const poly: DrawItem = { t: 'poly', points: [{ x: 0, y: 0 }], color: '#000' };
    expect(buildShadowBatches([poly], lighting())).toEqual([]);
  });

  it('silhouette: bottom corners sit at the foot, top sheared up the sun ray', () => {
    // foot for a map-less item = bottom edge (no lift). sun = (-0.5,0.65,0.58).
    const it = img({ dx: 100, dy: 50, dw: 32, dh: 48 });
    const [batch] = buildShadowBatches([it], lighting());
    expect(batch.instances).toHaveLength(1);
    const { cTop, cBot } = batch.instances[0];

    const fy = 50 + 48; // dy + dh, lift 0 (no maps)
    expect(cBot).toEqual([100, fy, 132, fy]);

    // leanX = (-(-0.5)/0.65)*0.8 > 0 (east), dropY = (-0.58/0.65)*0.5*0.8 < 0 (up).
    const up = 0.65, damp = 0.8;
    const leanX = (0.5 / up) * damp;
    const dropY = (-0.58 / up) * 0.5 * damp;
    expect(cTop[0]).toBeCloseTo(100 + 48 * leanX);
    expect(cTop[1]).toBeCloseTo(fy + 48 * dropY);
    expect(cTop[3]).toBeCloseTo(fy + 48 * dropY); // top edge is level
  });

  it('map-carrying sprite lifts the foot by dw/4', () => {
    const it = img({ maps: { normal: tex() }, dx: 0, dy: 0, dw: 40, dh: 60 });
    const [batch] = buildShadowBatches([it], lighting());
    const fy = 0 + 60 - 40 / 4; // dy + dh - dw/4
    expect(batch.instances[0].cBot[1]).toBe(fy);
  });

  it('geometry mode prefers the baked ground shadow as an axis-aligned rect', () => {
    const shadowSrc = tex(50, 20);
    const it = img({
      dx: 100, dy: 50, dw: 32, dh: 48,
      shadowSprite: { src: shadowSrc, dx: -4, dy: 2 },
    });
    const [batch] = buildShadowBatches([it], lighting({ shadowMode: 'geometry' }));
    expect(batch.texture).toBe(shadowSrc);
    const { cTop, cBot } = batch.instances[0];
    const x0 = 100 + 32 / 2 + (-4); // dx + dw/2 + shadowSprite.dx
    const y0 = 50 + 48 + 2;          // dy + dh + shadowSprite.dy
    expect(cTop).toEqual([x0, y0, x0 + 50, y0]);     // rect top edge
    expect(cBot).toEqual([x0, y0 + 20, x0 + 50, y0 + 20]); // rect bottom edge
  });

  it('geometry mode falls back to silhouette when no baked shadow exists', () => {
    const it = img();
    const [batch] = buildShadowBatches([it], lighting({ shadowMode: 'geometry' }));
    expect(batch.texture).toBe(it.src); // silhouette uses the sprite itself
    // sheared (top edge != bottom edge x)
    expect(batch.instances[0].cTop[0]).not.toBe(batch.instances[0].cBot[0]);
  });

  it('batches by source texture', () => {
    const shared = tex();
    const a = img({ src: shared, dx: 0 });
    const b = img({ src: shared, dx: 200 });
    const c = img({ src: tex(), dx: 400 });
    const batches = buildShadowBatches([a, b, c], lighting());
    expect(shadowDrawCalls(batches)).toBe(2);
    expect(batches[0].instances).toHaveLength(2);
    expect(batches[1].instances).toHaveLength(1);
  });

  it('applies the world→device xform uniformly to every corner', () => {
    const it = img({ dx: 10, dy: 10, dw: 20, dh: 20 });
    const xf = { sx: 2, sy: 2, ox: 5, oy: 7 };
    const [plain] = buildShadowBatches([it], lighting());
    const [xfd] = buildShadowBatches([it], lighting(), xf);
    const p = plain.instances[0], q = xfd.instances[0];
    expect(q.cBot[0]).toBeCloseTo(p.cBot[0] * 2 + 5);
    expect(q.cBot[1]).toBeCloseTo(p.cBot[1] * 2 + 7);
    expect(q.cTop[0]).toBeCloseTo(p.cTop[0] * 2 + 5);
    expect(q.cTop[1]).toBeCloseTo(p.cTop[1] * 2 + 7);
  });

  it('packs instances interleaved: cTop(4) cBot(4) uv(4)', () => {
    const it = img();
    const [batch] = buildShadowBatches([it], lighting());
    const buf = packShadowInstances(batch.instances);
    expect(buf).toHaveLength(12);
    const { cTop, cBot, uv } = batch.instances[0];
    const expected = [...cTop, ...cBot, ...uv];
    // buf is Float32Array; compare with float32 tolerance.
    expected.forEach((v, i) => expect(buf[i]).toBeCloseTo(v, 3));
  });

  it('frame UVs are derived from the sub-rect', () => {
    const it = img({ src: tex(128, 128), frame: { sx: 32, sy: 0, sw: 64, sh: 128 } });
    const [batch] = buildShadowBatches([it], lighting());
    expect(batch.instances[0].uv).toEqual([0.25, 0, 0.75, 1]);
  });
});
