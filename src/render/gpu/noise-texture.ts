// src/render/gpu/noise-texture.ts
//
// A small TILING value-noise atlas, baked once on the CPU at scene init and sampled
// by the water + ocean-backdrop shaders. This replaces the per-fragment `hash21+sin`
// lattice fbm (~8 sin/mix chains per call, 3-6 calls per water fragment) with ONE
// bilinear texture tap per call — the "bake fbm → texture fetch" item from the
// render-perf engine pass spec. On the fill-bound iGPU overview regime texture units
// are idle while ALU is the bottleneck, so this is close to a pure win.
//
// The atlas is SEAMLESS: every octave's value-noise lattice wraps at the tile
// period, so `repeat` addressing never shows a seam. All channels are normalised to
// [0,1] — note the old in-shader fbm topped out at 0.75 (Σ 0.5+0.25), which silently
// KILLED every `smoothstep(0.82, …)` glint threshold tuned against it; the shaders
// are re-tuned against the honest range.
//
// Channels:
//   R — single-octave value noise           (spare / future terrain jitter)
//   G — 2-octave fbm                        (the water shader's `fbm()`)
//   B — 3-octave fbm                        (the backdrop's richer variant)
//   A — 2-octave fbm, independent seed      (caustics/glitter, decorrelated from G)
//
// Deterministic: a fixed integer hash, no Math.random (render-only, but keeps the
// bake reproducible for golden tests).

export const NOISE_TEX_SIZE = 512;   // texels per side (rgba8 → 1 MiB)
/** World-units (tiles) one texture repeat spans. Shaders sample at p/NOISE_TILE_UNITS.
 *  Call sites pre-scale their coords (g*0.02 … g*1.4), so the visible repeat period is
 *  64/scale tiles — ≥ 46 tiles even at the finest use, unnoticeable under motion. */
export const NOISE_TILE_UNITS = 64;

/** Well-mixed 32-bit lattice hash → [0,1). Coordinates are wrapped by the caller. */
function latticeHash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth (Hermite-interpolated) value noise with a WRAPPING lattice of the given
 *  integer period — the periodicity is what makes the baked texture tile.
 *  Exported: `dust-mask.ts` mirrors the terrain shader's `vnoise` (the R channel of
 *  this atlas, seed 101) CPU-side, so placement can read the same bare-ground field
 *  the shader paints. */
export function periodicVnoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const wrap = (v: number) => ((v % period) + period) % period;
  const ix0 = wrap(x0), iy0 = wrap(y0);
  const ix1 = wrap(x0 + 1), iy1 = wrap(y0 + 1);
  const a = latticeHash(ix0, iy0, seed);
  const b = latticeHash(ix1, iy0, seed);
  const c = latticeHash(ix0, iy1, seed);
  const d = latticeHash(ix1, iy1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** N-octave fbm over the wrapping lattice (lacunarity exactly 2 so every octave
 *  shares the tile period), normalised to [0,1]. */
function periodicFbm(x: number, y: number, octaves: number, seed: number): number {
  let v = 0, amp = 0.5, norm = 0, fx = x, fy = y, period = NOISE_TILE_UNITS;
  for (let k = 0; k < octaves; k++) {
    v += amp * periodicVnoise(fx + k * 11.7, fy + k * 4.3, period, seed + k * 131);
    norm += amp;
    fx *= 2; fy *= 2; period *= 2;
    amp *= 0.5;
  }
  return v / norm;
}

/** Bake the rgba8 atlas (row-major, NOISE_TEX_SIZE²×4 bytes). */
export function bakeNoiseAtlas(size = NOISE_TEX_SIZE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(size * size * 4));
  const unitsPerTexel = NOISE_TILE_UNITS / size;
  for (let ty = 0; ty < size; ty++) {
    const py = (ty + 0.5) * unitsPerTexel;
    for (let tx = 0; tx < size; tx++) {
      const px = (tx + 0.5) * unitsPerTexel;
      const o = (ty * size + tx) * 4;
      out[o] = Math.round(periodicVnoise(px, py, NOISE_TILE_UNITS, 101) * 255);
      out[o + 1] = Math.round(periodicFbm(px, py, 2, 202) * 255);
      out[o + 2] = Math.round(periodicFbm(px, py, 3, 303) * 255);
      out[o + 3] = Math.round(periodicFbm(px, py, 2, 404) * 255);
    }
  }
  return out;
}

/** Create + upload the atlas and its repeat/bilinear sampler. */
export function createNoiseTexture(device: GPUDevice): { texture: GPUTexture; sampler: GPUSampler } {
  const size = NOISE_TEX_SIZE;
  const texture = device.createTexture({
    label: 'noise-atlas',
    size: { width: size, height: size },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    bakeNoiseAtlas(size),
    { bytesPerRow: size * 4, rowsPerImage: size },
    { width: size, height: size },
  );
  const sampler = device.createSampler({
    label: 'noise-atlas-sampler',
    addressModeU: 'repeat', addressModeV: 'repeat',
    magFilter: 'linear', minFilter: 'linear',
  });
  return { texture, sampler };
}
