// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { type Raster, quantizePaletteOklab } from '@/render/sprite-postprocess';

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

/** 16x16, fully opaque, smooth gradient — plenty of distinct RGB triples. */
function gradient(): Raster {
  const r = raster(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    setPx(r, x, y, [x * 16, y * 16, ((x + y) * 8) % 256, 255]);
  }
  return r;
}

function uniqueOpaqueColors(r: Raster): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < r.w * r.h; i++) {
    if (r.data[i * 4 + 3] === 0) continue;
    s.add(`${r.data[i * 4]},${r.data[i * 4 + 1]},${r.data[i * 4 + 2]}`);
  }
  return s;
}

describe('quantizePaletteOklab — determinism', () => {
  it('produces byte-identical output across repeated runs on the same input', () => {
    const r = gradient();
    const a = quantizePaletteOklab(r, 6);
    const b = quantizePaletteOklab(r, 6);
    expect(a.data).toEqual(b.data);
  });

  it('is deterministic with dither too', () => {
    const r = gradient();
    const a = quantizePaletteOklab(r, 6, { dither: 'bayer4' });
    const b = quantizePaletteOklab(r, 6, { dither: 'bayer4' });
    expect(a.data).toEqual(b.data);
  });
});

describe('quantizePaletteOklab — palette size', () => {
  it('never uses more than `colors` distinct RGB values over opaque pixels', () => {
    const r = gradient();
    expect(uniqueOpaqueColors(r).size).toBeGreaterThan(8); // sanity: input is rich
    const out = quantizePaletteOklab(r, 6);
    expect(uniqueOpaqueColors(out).size).toBeLessThanOrEqual(6);
  });

  it('respects the budget with dithering on too', () => {
    const out = quantizePaletteOklab(gradient(), 6, { dither: 'bayer4' });
    expect(uniqueOpaqueColors(out).size).toBeLessThanOrEqual(6);
  });
});

describe('quantizePaletteOklab — alpha', () => {
  it('preserves alpha byte-exact, including semi-transparent and fully transparent pixels', () => {
    const r = raster(4, 1);
    setPx(r, 0, 0, [255, 0, 0, 255]);
    setPx(r, 1, 0, [0, 255, 0, 4]);   // below ALPHA_MIN — should be left alone entirely
    setPx(r, 2, 0, [0, 0, 255, 0]);   // fully transparent
    setPx(r, 3, 0, [10, 20, 30, 200]); // opaque-enough, gets quantized colour-wise
    const out = quantizePaletteOklab(r, 2);
    const alphaOf = (raster: Raster) => Array.from({ length: raster.w }, (_, x) => getPx(raster, x, 0)[3]);
    expect(alphaOf(out)).toEqual(alphaOf(r));
    // sub-threshold and fully-transparent pixels are untouched byte-for-byte (colour too).
    expect(getPx(out, 1, 0)).toEqual(getPx(r, 1, 0));
    expect(getPx(out, 2, 0)).toEqual(getPx(r, 2, 0));
  });

  it('never mutates the input raster', () => {
    const r = gradient();
    const before = new Uint8ClampedArray(r.data);
    quantizePaletteOklab(r, 4, { dither: 'bayer4' });
    expect(r.data).toEqual(before);
  });
});

describe('quantizePaletteOklab — dithering', () => {
  it('bayer4 differs from none pixel-for-pixel but draws from the SAME palette', () => {
    const r = gradient();
    const none = quantizePaletteOklab(r, 6, { dither: 'none' });
    const dith = quantizePaletteOklab(r, 6, { dither: 'bayer4' });
    expect(none.data).not.toEqual(dith.data);
    const palNone = uniqueOpaqueColors(none);
    const palDith = uniqueOpaqueColors(dith);
    expect([...palDith].every((c) => palNone.has(c))).toBe(true);
    expect(palNone.size).toBeGreaterThan(1); // sanity — not a degenerate single-colour case
  });
});

describe('quantizePaletteOklab — degenerate inputs', () => {
  it('leaves a fully transparent raster untouched', () => {
    const r = raster(5, 5);
    const out = quantizePaletteOklab(r, 8);
    expect(out.data).toEqual(r.data);
    expect([out.w, out.h]).toEqual([5, 5]);
  });

  it('when there are fewer distinct colours than the budget, every colour survives exactly', () => {
    const r = raster(3, 1);
    setPx(r, 0, 0, [255, 0, 0, 255]);
    setPx(r, 1, 0, [0, 255, 0, 255]);
    setPx(r, 2, 0, [255, 0, 0, 255]); // repeats colour 0 — 2 distinct colours total
    const out = quantizePaletteOklab(r, 8);
    expect(getPx(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPx(out, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(getPx(out, 2, 0)).toEqual([255, 0, 0, 255]);
  });

  it('colors <= 0 is a no-op copy', () => {
    const r = gradient();
    const out = quantizePaletteOklab(r, 0);
    expect(out.data).toEqual(r.data);
  });
});
