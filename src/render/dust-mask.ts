// src/render/dust-mask.ts
//
// CPU mirror of the terrain shader's BARE-GROUND (dust/pebble) splat weight — the
// `wDust` term of the ground-patch splat in `terrain-wgsl.ts` (T2 retethering):
//
//   dry       = 1 − moisture
//   slopeDry  = smoothstep(0.06, 0.26, slope)        // render-space slope (1 − n.y)
//   elevDry   = smoothstep(9.0, 27.0, elevM)         // metres above sea
//   aridity   = clamp(dry·0.62 + slopeDry·0.22 + elevDry·0.22, 0, 1)
//   bareField = vnoise(grid·0.06 + (17,4))           // low-freq patchiness modulator
//   jit       = vnoise(grid·0.35) − 0.5              // threshold wander
//   patchy    = bareField · (0.20 + 0.60·aridity)
//   wDust     = smoothstep(0.48, 0.82, aridity·0.62 + patchy + jit·0.14)
//
// The shader's `vnoise` is a bilinear tap of the R channel of the CPU-baked noise
// atlas (`noise-texture.ts`, `periodicVnoise(…, NOISE_TILE_UNITS, 101)`), so this
// mirror evaluates the SAME lattice directly — the continuous field the texture
// discretises (≤ 1 texel of divergence, far below the smoothstep band). `slope`/
// `elevM` are OPTIONAL (default 0 = flat, sea level) so every existing 2-arg call
// keeps its exact prior behaviour (aridity collapses to the old moisture-only
// dryness term); callers that also know the local landform (`dustAt`, below) feed
// the richer signal so vegetation culls itself off dry SHOULDERS and UPLANDS too,
// not just climate-dry ground.
//
// Why: vegetation placement gated on slope/altitude only, while the shader paints
// dust/pebbles from moisture + its own noise — so flowers and lush tufts sprouted
// from ground painted as bare pebbly dust (user report). This is the missing
// terrain-awareness seam, the exact analogue of `snow-mask.ts` for snow.
//
// Pure + deterministic (fixed lattice, no world seed — the shader's field is
// world-independent too; moisture/slope/elevation carry the per-world variation).

import type { GameMap } from '@/core/types';
import { getClimateFields, getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import { ISO_TILE_H } from '@/render/iso/iso-constants';
import { periodicVnoise, NOISE_TILE_UNITS } from '@/render/gpu/noise-texture';

const vn = (x: number, y: number): number => periodicVnoise(x, y, NOISE_TILE_UNITS, 101);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The shader's bare-ground weight from an explicit moisture sample + grid point (pure).
 * `slope01` is the shader's own render-space slope measure (`1 − n.y`, 0 flat → 1
 * vertical — NOT the physical metres-per-tile `slopeM` the vegetation SlopeBands use);
 * `elevM` is metres above sea (matches the shader's `metresAS`). Both default to 0
 * (flat, sea level) so a bare 2-arg call reproduces the pre-T2 moisture-only behaviour
 * exactly (aridity = dry·0.62, well under the old dry·0.65 scale but calibrated
 * against the new threshold band below — see `_tmp_calibration` history in the T2
 * report for the pinned-test derivation).
 */
export function dust01(moist: number, gx: number, gy: number, slope01 = 0, elevM = 0): number {
  const dry = 1 - clamp01(moist);
  const bareField = vn(gx * 0.06 + 17, gy * 0.06 + 4);
  const jit = vn(gx * 0.35, gy * 0.35) - 0.5;
  const slopeDry = smoothstep(0.06, 0.26, slope01);
  const elevDry = smoothstep(9.0, 27.0, elevM);
  const aridity = clamp01(dry * 0.62 + slopeDry * 0.22 + elevDry * 0.22);
  const patchy = bareField * (0.20 + 0.60 * aridity);
  return smoothstep(0.48, 0.82, aridity * 0.62 + patchy + jit * 0.14);
}

/** Render-space slope (`1 − n.y`) + metres-above-sea at an INTEGER tile, computed
 *  EXACTLY the way the terrain vertex shader derives its normal (central differences
 *  on heightPx, ±1 tile, the same `G.uHalf.y`/relief/vertical-exaggeration scale) —
 *  so `dustAt` reads the identical landform signal the shader's `slope`/`metresAS`
 *  do, not an approximation in different units. */
function renderSlopeAndElevAt(map: GameMap, x: number, y: number): { slope01: number; elevM: number } {
  const w = map.width, h = map.height;
  const heights = getHeightfield(
    map.seed, w, h, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed),
  );
  const style = worldStyleOf(map.worldSeed);
  const relief = style.mountainRelief, zPx = style.terrainVerticalExaggeration;
  const halfH = ISO_TILE_H / 2;
  const ix = Math.min(w - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(h - 1, Math.max(0, Math.round(y)));
  const idx = iy * w + ix;
  const heightPx = (v: number): number => (v - ELEVATION_SEA_LEVEL) * relief * zPx;
  const hl = heightPx(ix > 0 ? heights[idx - 1] : heights[idx]);
  const hr = heightPx(ix < w - 1 ? heights[idx + 1] : heights[idx]);
  const hu = heightPx(iy > 0 ? heights[idx - w] : heights[idx]);
  const hd = heightPx(iy < h - 1 ? heights[idx + w] : heights[idx]);
  const dx = (hr - hl) * 0.5, dz = (hd - hu) * 0.5;
  const normY = halfH / Math.sqrt(dx * dx + halfH * halfH + dz * dz);
  return { slope01: clamp01(1 - normY), elevM: (heights[idx] - ELEVATION_SEA_LEVEL) * relief };
}

/** Bare-ground weight at a TILE of the map — moisture from the shared climate fields,
 *  slope + elevation from the SAME seed-deterministic heightfield the vegetation
 *  SlopeBands/treeline already read, noise at the tile centre (where the shader
 *  evaluates the splat for that cell). Flat studio ground (`map.flatHeight`) skips
 *  the heightfield lookup — no real relief to read, so slope/elevation stay 0. */
export function dustAt(map: GameMap, x: number, y: number): number {
  const { moisture } = getClimateFields(map);
  const ix = Math.min(map.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(map.height - 1, Math.max(0, Math.round(y)));
  const moist = moisture[iy * map.width + ix] ?? 0.5;
  if (map.flatHeight) return dust01(moist, x + 0.5, y + 0.5);
  const { slope01, elevM } = renderSlopeAndElevAt(map, x, y);
  return dust01(moist, x + 0.5, y + 0.5, slope01, elevM);
}
