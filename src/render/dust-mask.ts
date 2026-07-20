// src/render/dust-mask.ts
//
// CPU mirror of the terrain shader's BARE-GROUND (dust/pebble) splat weight — the
// `wDust` term of the ground-patch splat in `terrain-wgsl.ts` (≈ line 682):
//
//   dry       = 1 − moisture
//   bareField = vnoise(grid·0.06 + (17,4))       // low-freq bare-earth field
//   jit       = vnoise(grid·0.35) − 0.5          // threshold wander
//   wDust     = smoothstep(0.58, 0.86, dry·0.65 + bareField·0.55 + jit·0.10)
//
// The shader's `vnoise` is a bilinear tap of the R channel of the CPU-baked noise
// atlas (`noise-texture.ts`, `periodicVnoise(…, NOISE_TILE_UNITS, 101)`), so this
// mirror evaluates the SAME lattice directly — the continuous field the texture
// discretises (≤ 1 texel of divergence, far below the smoothstep band).
//
// Why: vegetation placement gated on slope/altitude only, while the shader paints
// dust/pebbles from moisture + its own noise — so flowers and lush tufts sprouted
// from ground painted as bare pebbly dust (user report). This is the missing
// terrain-awareness seam, the exact analogue of `snow-mask.ts` for snow.
//
// Pure + deterministic (fixed lattice, no world seed — the shader's field is
// world-independent too; moisture carries the per-world variation).

import type { GameMap } from '@/core/types';
import { getClimateFields } from '@/world/heightfield';
import { periodicVnoise, NOISE_TILE_UNITS } from '@/render/gpu/noise-texture';

const vn = (x: number, y: number): number => periodicVnoise(x, y, NOISE_TILE_UNITS, 101);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The shader's bare-ground weight from an explicit moisture sample + grid point (pure). */
export function dust01(moist: number, gx: number, gy: number): number {
  const dry = 1 - Math.min(1, Math.max(0, moist));
  const bareField = vn(gx * 0.06 + 17, gy * 0.06 + 4);
  const jit = vn(gx * 0.35, gy * 0.35) - 0.5;
  return smoothstep(0.58, 0.86, dry * 0.65 + bareField * 0.55 + jit * 0.10);
}

/** Bare-ground weight at a TILE of the map (moisture from the shared climate fields,
 *  noise at the tile centre — where the shader evaluates the splat for that cell). */
export function dustAt(map: GameMap, x: number, y: number): number {
  const { moisture } = getClimateFields(map);
  const ix = Math.min(map.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(map.height - 1, Math.max(0, Math.round(y)));
  return dust01(moisture[iy * map.width + ix] ?? 0.5, x + 0.5, y + 0.5);
}
