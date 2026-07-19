// Raw-upload sprite path (sprite-prebake S2): the cache-rehydration packs carry
// all four maps as typed arrays (no canvas round-trip). These pin the premultiply
// correctness, the RawMap discriminator + size helpers, and the batch flow that
// routes raw maps to the writeTexture path.
import { describe, it, expect } from 'vitest';
import {
  premultiplyRgba, isRawMap, mapSize, packAlbedoSource,
  type RawMap, type SpritePack,
} from '@/render/iso/sprite-canvas';
import { buildInstanceBatches, srcSize } from '@/render/gpu/instance-batch';
import type { DrawItem } from '@/render/iso/draw-list';

/** The reference a premultiplied 2D-canvas backing produces: round(x·a/255), with
 *  RGB zeroed at a=0. This is exactly what putImageData→copyExternalImageToTexture
 *  (premultiply:true) lands on the GPU, so the raw path must match it within ±1. */
function refPremul(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    out[i] = a === 0 ? 0 : Math.round(src[i] * a / 255);
    out[i + 1] = a === 0 ? 0 : Math.round(src[i + 1] * a / 255);
    out[i + 2] = a === 0 ? 0 : Math.round(src[i + 2] * a / 255);
    out[i + 3] = a;
  }
  return out;
}

describe('premultiplyRgba', () => {
  it('is identity at a=255 and zeroes RGB at a=0', () => {
    const src = new Uint8ClampedArray([
      200, 150, 90, 255,   // opaque → verbatim
      200, 150, 90, 0,     // transparent with live RGB → zeroed
    ]);
    const r = premultiplyRgba(src, 2, 1);
    expect(Array.from(r.data.slice(0, 4))).toEqual([200, 150, 90, 255]);
    expect(Array.from(r.data.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(r.w).toBe(2); expect(r.h).toBe(1);
  });

  it('matches a reference canvas premultiply within ±1 across the alpha range', () => {
    // Deterministic spread of RGB × alpha (incl. the partial alphas where the
    // double-rounding canvas path drifts by ≤1 from a clean single premultiply).
    const n = 64 * 4;
    const src = new Uint8ClampedArray(n);
    let h = 12345 | 0;
    for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) | 0; src[i] = (h >>> 16) & 0xff; }
    const got = premultiplyRgba(src, 64, 1).data;
    const ref = refPremul(src);
    for (let i = 0; i < n; i++) expect(Math.abs(got[i] - ref[i])).toBeLessThanOrEqual(1);
  });

  it('does not mutate the source buffer', () => {
    const src = new Uint8ClampedArray([10, 20, 30, 128]);
    const copy = src.slice();
    premultiplyRgba(src, 1, 1);
    expect(Array.from(src)).toEqual(Array.from(copy));
  });
});

describe('RawMap helpers', () => {
  const raw: RawMap = { data: new Uint8ClampedArray(4), w: 3, h: 5 };

  it('isRawMap discriminates a RawMap from a canvas-like source', () => {
    expect(isRawMap(raw)).toBe(true);
    expect(isRawMap({ width: 3, height: 5 } as unknown as CanvasImageSource)).toBe(false);
  });

  it('mapSize + srcSize read dims off a RawMap and off a canvas-like source', () => {
    expect(mapSize(raw)).toEqual({ w: 3, h: 5 });
    expect(srcSize(raw)).toEqual({ w: 3, h: 5 });
    const canvasLike = { width: 7, height: 9 } as unknown as CanvasImageSource;
    expect(mapSize(canvasLike)).toEqual({ w: 7, h: 9 });
    expect(srcSize(canvasLike)).toEqual({ w: 7, h: 9 });
  });

  it('packAlbedoSource prefers albedoData (raw) over albedo (canvas)', () => {
    const canvas = { width: 1, height: 1 } as unknown as import('@/render/iso/sprite-canvas').SpriteCanvas;
    expect(packAlbedoSource({ albedoData: raw } as SpritePack)).toBe(raw);
    expect(packAlbedoSource({ albedo: canvas } as SpritePack)).toBe(canvas);
  });
});

describe('buildInstanceBatches — raw-backed maps', () => {
  it('routes a RawMap albedo + raw companion maps into one lit batch, keyed by object identity', () => {
    const albedo: RawMap = { data: new Uint8ClampedArray(4 * 4), w: 2, h: 2 };
    const normalData: RawMap = { data: new Uint8ClampedArray(4 * 4), w: 2, h: 2 };
    const materialData: RawMap = { data: new Uint8ClampedArray(4 * 4), w: 2, h: 2 };
    const emissiveData: RawMap = { data: new Uint8ClampedArray(4 * 4), w: 2, h: 2 };
    const item: DrawItem = {
      t: 'image', src: albedo, dx: 0, dy: 0, dw: 2, dh: 2,
      maps: { normalData, materialData, emissiveData },
    };
    // Two items sharing the SAME raw albedo object bucket into ONE batch.
    const { batches } = buildInstanceBatches([item, { ...item, dx: 5 }]);
    expect(batches).toHaveLength(1);
    const b = batches[0];
    expect(b.texture).toBe(albedo);
    expect(b.normalData).toBe(normalData);
    expect(b.materialData).toBe(materialData);
    expect(b.emissiveData).toBe(emissiveData);
    expect(b.lit).toBe(true);           // normalData + materialData ⇒ lit path
    expect(b.instances).toHaveLength(2);
  });
});
