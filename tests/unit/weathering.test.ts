// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { applyWeathering, weatherSeed, type WeatherOpts } from '@/assetgen/render/weathering';
import type { RasterMaps } from '@/assetgen/render/rasterize';
import type { BBox } from '@/assetgen/render/fit';

// A flat opaque test G-buffer of one material: albedo mid-grey, AO open (255),
// roughness 0.9, metallic `metal`. `bbox` spans the whole canvas.
function makeMaps(size: number, metal: number): RasterMaps {
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const material = new Uint8ClampedArray(n * 4);
  const emissive = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    albedo[o] = 160; albedo[o + 1] = 160; albedo[o + 2] = 160; albedo[o + 3] = 255;
    material[o + 1] = 255;                       // AO open
    material[o + 2] = Math.round(0.9 * 255);     // roughness
    material[o + 3] = Math.round(metal * 255);   // metallic
  }
  return { albedo, normal, material, emissive, depthRaw: new Float32Array(n), size };
}

const FULL = (size: number): BBox => ({ x: 0, y: 0, w: size, h: size });

function meanLum(albedo: Uint8ClampedArray, y0: number, y1: number, size: number): number {
  let s = 0, c = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    s += (albedo[o] + albedo[o + 1] + albedo[o + 2]) / 3; c++;
  }
  return s / c;
}

describe('procedural weathering', () => {
  it('is deterministic for the same seed + inputs', () => {
    const a = makeMaps(48, 0); const b = makeMaps(48, 0);
    const opts: WeatherOpts = { seed: 7 };
    applyWeathering(a, FULL(48), opts);
    applyWeathering(b, FULL(48), opts);
    expect(Array.from(a.albedo)).toEqual(Array.from(b.albedo));
  });

  it('varies with the seed', () => {
    const a = makeMaps(48, 0); const b = makeMaps(48, 0);
    applyWeathering(a, FULL(48), { seed: 1 });
    applyWeathering(b, FULL(48), { seed: 2 });
    expect(Array.from(a.albedo)).not.toEqual(Array.from(b.albedo));
  });

  it('darkens overall and pools dirt lower (bottom darker than top)', () => {
    const m = makeMaps(64, 0);
    const before = meanLum(m.albedo, 0, 64, 64);
    applyWeathering(m, FULL(64), { seed: 3 });
    const after = meanLum(m.albedo, 0, 64, 64);
    expect(after).toBeLessThan(before);                          // grime+streaks darken
    const topQ = meanLum(m.albedo, 0, 16, 64);
    const botQ = meanLum(m.albedo, 48, 64, 64);
    expect(botQ).toBeLessThan(topQ);                             // dirt accumulates low
  });

  it('rusts metal: warm hue shift (R>B) and de-metals, but leaves non-metal neutral', () => {
    const metal = makeMaps(64, 1); applyWeathering(metal, FULL(64), { seed: 4, dirt: 0, streak: 0 });
    // somewhere a rusted pixel should be warm (R noticeably > B) and metallic reduced
    let warm = 0, demetaled = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const o = i * 4;
      if (metal.albedo[o] - metal.albedo[o + 2] > 20) warm++;
      if (metal.material[o + 3] < 255) demetaled++;
    }
    expect(warm).toBeGreaterThan(0);
    expect(demetaled).toBeGreaterThan(0);

    const stone = makeMaps(64, 0); applyWeathering(stone, FULL(64), { seed: 4, dirt: 0, streak: 0 });
    // no metal ⇒ no rust ⇒ no warm shift and metallic untouched
    let warmStone = 0;
    for (let i = 0; i < 64 * 64; i++) { const o = i * 4; if (stone.albedo[o] - stone.albedo[o + 2] > 20) warmStone++; }
    expect(warmStone).toBe(0);
    expect(Array.from(stone.material)).toEqual(Array.from(makeMaps(64, 0).material));
  });

  it('never touches transparent pixels', () => {
    const m = makeMaps(32, 1);
    for (let i = 0; i < 32 * 32; i++) m.albedo[i * 4 + 3] = 0;   // all transparent
    const snapshot = Array.from(m.albedo);
    applyWeathering(m, FULL(32), { seed: 9 });
    expect(Array.from(m.albedo)).toEqual(snapshot);
  });

  it('weatherSeed is stable and string-derived', () => {
    expect(weatherSeed('cottage')).toBe(weatherSeed('cottage'));
    expect(weatherSeed('cottage')).not.toBe(weatherSeed('tower'));
    expect(weatherSeed(undefined)).toBe(weatherSeed(''));
  });
});
