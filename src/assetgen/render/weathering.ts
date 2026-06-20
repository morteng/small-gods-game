// src/assetgen/render/weathering.ts
//
// Procedural weathering — a deterministic, geometry-aware pass that ages a freshly
// composed building/prop G-buffer: dirt pooling low, grime in the AO crevices,
// vertical rain-streaks, and rust blooming on metal. It runs AFTER rasterise + AO
// and mutates the maps IN PLACE.
//
// WHY bake into ALBEDO (not just roughness): the banded-PBR shader
// (`src/render/gpu/banded-pbr.ts`) samples only AO + metallic and IGNORES the
// roughness channel, so a roughness-only weathering would be invisible. We therefore
// darken/tint the albedo for the visible result and ALSO nudge the material channels
// (rust de-metals + roughens) so the data is right if the lighting model later grows
// to read roughness.
//
// Determinism: a pure function of (pixel coords, opaque mask, AO, metallic, seed).
// Same inputs → same bytes — golden-hash stable (`tests/unit/assetgen-golden.test.ts`),
// no `Math.random`. `seed` gives per-asset variation so two cottages don't streak
// identically.
import type { RasterMaps } from '@/assetgen/render/rasterize';
import type { BBox } from '@/assetgen/render/fit';

export interface WeatherOpts {
  /** Per-asset variation seed (e.g. a hash of the blueprint id). Default 0. */
  seed?: number;
  /** Grime that pools low + settles in crevices. 0..1, default 0.35. */
  dirt?: number;
  /** Vertical rain-streak darkening. 0..1, default 0.30. */
  streak?: number;
  /** Rust bloom on metal surfaces. 0..1, default 0.70. */
  rust?: number;
}

const DEFAULTS: Required<Omit<WeatherOpts, 'seed'>> = { dirt: 0.35, streak: 0.30, rust: 0.70 };

// Grime is a cool dark earth; rust a warm oxide orange-brown. Albedo is lerped toward
// these — never a flat overwrite, so the underlying material colour reads through.
const GRIME: readonly [number, number, number] = [54, 50, 42];
const RUST: readonly [number, number, number] = [120, 58, 32];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Integer hash → [0,1). Math.imul keeps it 32-bit + platform-stable (IEEE754 out). */
function hash(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise at integer cell size `cell`, bilinearly interpolated. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell, fy = y / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);   // smoothstep
  const n00 = hash(x0, y0, seed), n10 = hash(x0 + 1, y0, seed);
  const n01 = hash(x0, y0 + 1, seed), n11 = hash(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

/**
 * Age a composed G-buffer in place. Only call for building/prop geometry — pure
 * flora/rock should be left pristine (the caller gates this).
 *
 * @param maps   rasterised + AO'd maps (material.G must already hold AO)
 * @param bbox   the opaque bounding box (drives the vertical dirt gradient)
 */
export function applyWeathering(maps: RasterMaps, bbox: BBox, opts?: WeatherOpts): void {
  const seed = (opts?.seed ?? 0) | 0;
  const dirt = opts?.dirt ?? DEFAULTS.dirt;
  const streak = opts?.streak ?? DEFAULTS.streak;
  const rust = opts?.rust ?? DEFAULTS.rust;
  const { albedo, material, size } = maps;
  const top = bbox.y, invH = 1 / Math.max(1, bbox.h);

  for (let y = 0; y < size; y++) {
    const v = clamp01((y - top) * invH);                 // 0 at the eaves, 1 at the ground
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (albedo[o + 3] !== 255) continue;               // opaque body pixels only

      const aoN = material[o + 1] / 255;                 // 1 = open, low = crevice
      const crev = 1 - aoN;
      const nLow = valueNoise(x, y, 7, seed);            // fine break-up
      const nMid = valueNoise(x, y, 23, seed + 17);      // broad blotches

      // Grime: pools toward the ground (v²) and gathers in crevices, broken by noise.
      const grime = dirt * (0.40 * v * v + 0.60 * crev) * (0.55 + 0.45 * nMid);

      // Rain-streaks: thin vertical columns that strengthen downward. A 1-D column
      // noise picks which columns streak; the run develops with v (none at the eave).
      const col = valueNoise(x, top, 3, seed + 101);     // per-column, stable down the run
      const streakCol = clamp01((col - 0.55) / 0.45);    // only the upper ~45% of columns streak
      const streakAmt = streak * streakCol * (v * v) * (0.5 + 0.5 * nLow);

      const dark = clamp01(grime + streakAmt);
      if (dark > 0) {
        // Darken toward GRIME (multiplicative dim + tint pull) — keeps material hue.
        const dim = 1 - 0.45 * dark;
        albedo[o]     = lerp(albedo[o] * dim,     GRIME[0], 0.35 * dark);
        albedo[o + 1] = lerp(albedo[o + 1] * dim, GRIME[1], 0.35 * dark);
        albedo[o + 2] = lerp(albedo[o + 2] * dim, GRIME[2], 0.35 * dark);
      }

      // Rust: metal only. Blooms low + along streaks; tints albedo toward oxide,
      // roughens, and DE-METALS the surface (oxide is dielectric).
      const metal = material[o + 3] / 255;
      if (metal > 0.4 && rust > 0) {
        const nRust = valueNoise(x, y, 11, seed + 53);
        const rustMask = clamp01(rust * (0.25 + 0.75 * v) * (nRust * nRust) * (0.6 + 0.8 * streakCol));
        if (rustMask > 0.02) {
          albedo[o]     = lerp(albedo[o],     RUST[0], 0.75 * rustMask);
          albedo[o + 1] = lerp(albedo[o + 1], RUST[1], 0.75 * rustMask);
          albedo[o + 2] = lerp(albedo[o + 2], RUST[2], 0.75 * rustMask);
          material[o + 2] = Math.max(material[o + 2], Math.round(255 * (0.6 + 0.35 * rustMask))); // rougher
          material[o + 3] = Math.round(material[o + 3] * (1 - 0.85 * rustMask));                  // de-metal
        }
      }
    }
  }
}

/** Cheap stable seed from a structure id (or any string). */
export function weatherSeed(id: string | undefined): number {
  let h = 2166136261;
  const s = id ?? '';
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000003;
}
