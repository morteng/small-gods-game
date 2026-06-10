// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  type Raster, opaqueBBox, cropRaster, boxDownscale, nearestScale,
  dilateColor, clipToMask, alphaIoU, borderKeyedFraction, quantizePalette,
  registerAlbedo,
} from '@/render/sprite-postprocess';

function raster(w: number, h: number, fill?: [number, number, number, number]): Raster {
  const r: Raster = { data: new Uint8ClampedArray(w * h * 4), w, h };
  if (fill) for (let i = 0; i < w * h; i++) r.data.set(fill, i * 4);
  return r;
}
function setPx(r: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  r.data.set(rgba, (y * r.w + x) * 4);
}
function getPx(r: Raster, x: number, y: number): number[] {
  const o = (y * r.w + x) * 4;
  return [r.data[o], r.data[o + 1], r.data[o + 2], r.data[o + 3]];
}

describe('opaqueBBox / cropRaster', () => {
  it('finds the opaque bounds and crops to them', () => {
    const r = raster(5, 5);
    setPx(r, 1, 2, [255, 0, 0, 255]);
    setPx(r, 3, 3, [0, 255, 0, 255]);
    const bb = opaqueBBox(r)!;
    expect(bb).toEqual({ x: 1, y: 2, w: 3, h: 2 });
    const c = cropRaster(r, bb);
    expect([c.w, c.h]).toEqual([3, 2]);
    expect(getPx(c, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('returns null for a fully transparent raster', () => {
    expect(opaqueBBox(raster(3, 3))).toBeNull();
  });
});

describe('boxDownscale', () => {
  it('averages areas (4x4 solid → 2x2 solid)', () => {
    const r = raster(4, 4, [100, 150, 200, 255]);
    const out = boxDownscale(r, 2, 2);
    expect([out.w, out.h]).toEqual([2, 2]);
    expect(getPx(out, 0, 0)).toEqual([100, 150, 200, 255]);
  });

  it('uses premultiplied alpha (transparent pixels do not darken colour)', () => {
    // 2x1: opaque red + fully transparent black → 1x1 should stay pure red at half alpha.
    const r = raster(2, 1);
    setPx(r, 0, 0, [255, 0, 0, 255]);
    const out = boxDownscale(r, 1, 1);
    const [pr, , , pa] = getPx(out, 0, 0);
    expect(pa).toBeGreaterThan(120); expect(pa).toBeLessThan(135);
    expect(pr).toBeGreaterThan(250); // not dragged toward black
  });

  it('supports non-uniform scaling', () => {
    const r = raster(4, 2, [10, 20, 30, 255]);
    const out = boxDownscale(r, 2, 2);
    expect([out.w, out.h]).toEqual([2, 2]);
    expect(getPx(out, 1, 1)).toEqual([10, 20, 30, 255]);
  });
});

describe('nearestScale', () => {
  it('upscales blocky without blending', () => {
    const r = raster(2, 1);
    setPx(r, 0, 0, [255, 0, 0, 255]);
    setPx(r, 1, 0, [0, 0, 255, 255]);
    const out = nearestScale(r, 4, 2);
    expect(getPx(out, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPx(out, 2, 0)).toEqual([0, 0, 255, 255]);
  });
});

describe('dilateColor', () => {
  it('bleeds colour into adjacent transparent pixels without changing alpha', () => {
    const r = raster(3, 1);
    setPx(r, 0, 0, [200, 50, 25, 255]);
    const out = dilateColor(r, 1);
    expect(getPx(out, 1, 0)).toEqual([200, 50, 25, 0]); // colour copied, alpha stays 0
    expect(getPx(out, 2, 0)).toEqual([0, 0, 0, 0]);     // out of reach for one pass
  });

  it('reaches further with more passes', () => {
    const r = raster(3, 1);
    setPx(r, 0, 0, [200, 50, 25, 255]);
    const out = dilateColor(r, 2);
    expect(getPx(out, 2, 0).slice(0, 3)).toEqual([200, 50, 25]);
  });
});

describe('clipToMask', () => {
  it('takes alpha from the mask and colour from the albedo', () => {
    const albedo = raster(2, 1, [9, 8, 7, 255]);
    const mask = raster(2, 1);
    setPx(mask, 0, 0, [0, 0, 0, 255]);
    const out = clipToMask(albedo, mask);
    expect(getPx(out, 0, 0)).toEqual([9, 8, 7, 255]);
    expect(getPx(out, 1, 0)[3]).toBe(0);
  });
});

describe('alphaIoU', () => {
  it('is 1 for identical masks, 0 for disjoint, fractional otherwise', () => {
    const a = raster(3, 1); setPx(a, 0, 0, [0, 0, 0, 255]); setPx(a, 1, 0, [0, 0, 0, 255]);
    const same = raster(3, 1); setPx(same, 0, 0, [0, 0, 0, 255]); setPx(same, 1, 0, [0, 0, 0, 255]);
    const shifted = raster(3, 1); setPx(shifted, 1, 0, [0, 0, 0, 255]); setPx(shifted, 2, 0, [0, 0, 0, 255]);
    const off = raster(3, 1); setPx(off, 2, 0, [0, 0, 0, 255]);
    expect(alphaIoU(a, same)).toBe(1);
    expect(alphaIoU(a, off)).toBe(0);
    expect(alphaIoU(a, shifted)).toBeCloseTo(1 / 3);
  });
});

describe('borderKeyedFraction', () => {
  it('is 1 when the whole border ring keyed out, 0 when it stayed opaque', () => {
    const keyed = raster(3, 3);
    setPx(keyed, 1, 1, [255, 0, 0, 255]); // only the centre survives
    expect(borderKeyedFraction(keyed)).toBe(1);
    expect(borderKeyedFraction(raster(3, 3, [1, 2, 3, 255]))).toBe(0);
  });
});

describe('quantizePalette', () => {
  it('collapses near-identical shades when the palette is tight', () => {
    const r = raster(2, 1);
    setPx(r, 0, 0, [100, 100, 100, 255]);
    setPx(r, 1, 0, [102, 101, 99, 255]); // same 16-level bucket
    const out = quantizePalette(r, 1);
    expect(getPx(out, 0, 0)).toEqual(getPx(out, 1, 0));
  });

  it('keeps distinct colours when the palette allows', () => {
    const r = raster(2, 1);
    setPx(r, 0, 0, [255, 0, 0, 255]);
    setPx(r, 1, 0, [0, 0, 255, 255]);
    const out = quantizePalette(r, 8);
    expect(getPx(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPx(out, 1, 0)).toEqual([0, 0, 255, 255]);
  });

  it('never touches transparent pixels', () => {
    const r = raster(2, 1);
    setPx(r, 0, 0, [255, 0, 0, 255]);
    const out = quantizePalette(r, 1);
    expect(getPx(out, 1, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('registerAlbedo', () => {
  it('registers a larger LLM raster onto the geometry mask grid: mask alpha, LLM colour', () => {
    // Geometry mask: 4x4 fully opaque. LLM: 8x8 fully red (perfect silhouette, 2x res).
    const mask = raster(4, 4, [0, 0, 0, 255]);
    const llm = raster(8, 8, [200, 40, 30, 255]);
    const res = registerAlbedo(llm, mask)!;
    expect([res.sprite.w, res.sprite.h]).toEqual([4, 4]);
    expect(res.iou).toBeCloseTo(1);
    expect(getPx(res.sprite, 2, 2)).toEqual([200, 40, 30, 255]);
  });

  it('fills mask pixels the LLM missed via dilation (no transparent holes)', () => {
    // Mask is a full 4x4 square; the LLM drew an L (top-right quadrant missing).
    // Crop-to-content can't normalize that away — it's a real shape disagreement.
    const mask = raster(4, 4, [0, 0, 0, 255]);
    const llm = raster(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (y < 4 && x >= 4) continue; // missing corner
      setPx(llm, x, y, [10, 200, 10, 255]);
    }
    const res = registerAlbedo(llm, mask, { dilatePasses: 8 })!;
    expect(res.iou).toBeLessThan(1);
    const corner = getPx(res.sprite, 3, 0);  // in the mask, missing from the LLM
    expect(corner[3]).toBe(255);             // mask alpha wins
    expect(corner.slice(0, 3)).toEqual([10, 200, 10]); // colour bled across
  });

  it('returns null when the LLM raster is fully transparent', () => {
    expect(registerAlbedo(raster(4, 4), raster(2, 2, [0, 0, 0, 255]))).toBeNull();
  });
});
