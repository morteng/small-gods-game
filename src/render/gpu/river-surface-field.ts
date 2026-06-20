// src/render/gpu/river-surface-field.ts
//
// The river WATER-SURFACE field — the missing "fill" half of the river system.
//
// The river ribbon used to lift its vertices to the COMPOSED (carved) terrain
// height, i.e. the bottom of the channel it cuts — so the water sat at the bed,
// not at a fill line, and a deep carve dropped the river into a dry-looking
// trench. The hydrology model DOES carry a `surfaceW` fill height, but it lives in
// a different elevation space (raw pre-erosion noise: a river cell reads
// surfaceW≈0.62 where the render height is ≈0.45), so it can't be used to lift the
// render mesh directly.
//
// This module computes the water surface in the SAME render-elevation space the
// terrain/ribbon shaders read. For each river cell it looks across the flow to the
// two banks, sets the surface just below the LOWER bank (so the river is contained,
// never floating), but never below a minimum depth over the bed (so a weakly-carved
// reach still shows water). The level is smoothed downstream for a continuous
// gradient, then dilated a few tiles past the channel so the swept ribbon's full
// width samples a valid water level — the per-pixel terrain clip in the shader then
// cuts the plateau back to the real bank contour (pixel-perfect waterline).
//
// Off-channel cells default to the terrain height itself: where the ribbon strays
// onto dry ground the surface equals the terrain, so `surface − terrain ≤ 0` and
// the fragment discards — the waterline falls out for free. Pure + memoised.

import type { GameMap, HydrologyResult } from '@/core/types';
import { WaterType } from '@/core/types';
import { worldStyleOf } from '@/core/world-style';
import { heightField, curveHeightBuffer } from '@/render/gpu/terrain-field';
import { getHydrologyResult } from '@/world/hydrology-store';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';

/** Metres the water surface sits below the lower bank (a contained channel). */
const SURFACE_INSET_M = 0.5;
/** Minimum water depth kept over the bed, so a barely-carved reach never vanishes. */
const MIN_DEPTH_M = 0.35;
/** How far (tiles) the water plateau is dilated past the channel so the ribbon's
 *  full swept width samples a valid level (the shader clips it back per-pixel). */
const DILATE_TILES = 3;
/** How many banks to probe outward (tiles) before falling back to the bed height. */
const BANK_PROBE_TILES = 6;
/** Downstream smoothing passes (denoise + a gentle, monotone-ish flow gradient). */
const SMOOTH_PASSES = 2;

/**
 * Build the river water-surface field (render-elevation space, row-major `W*H`).
 * Off-channel cells equal the terrain height; river cells (and a small dilation
 * band) carry the bank-referenced fill level. `heights`/`hydro` are injectable for
 * tests; by default they come from the memoised render heightfield + hydrology.
 */
export function buildRiverSurfaceField(
  map: GameMap, heights?: Float32Array, hydro?: HydrologyResult, baseHeights?: Float32Array,
): Float32Array {
  const W = map.width, H = map.height;
  const h = heights ?? heightField(map);
  const hy = hydro ?? getHydrologyResult(map);
  const style = worldStyleOf(map.worldSeed);
  const relief = style.mountainRelief;
  const insetN = SURFACE_INSET_M / relief;
  const minDepthN = MIN_DEPTH_M / relief;

  // The BASE (pre-incision) render grade. The river fills its carved channel back
  // UP toward the surrounding ground, so the bank reference must read the natural
  // terrain — NOT the composed height `h`, whose graded valley walls are themselves
  // carved and would drag the fill line down into a dry gorge as the carve deepens.
  // Injectable for tests; by default the curved base seed field.
  const base = baseHeights ?? curveHeightBuffer(
    getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null),
    ELEVATION_SEA_LEVEL, style.terrainHeightGamma,
  );

  const wt = hy.waterType, drain = hy.drainTo;
  const isRiver = (i: number): boolean => wt[i] === WaterType.River;

  // Default surface = terrain (so a sample off the channel discards in-shader).
  const surf = h.slice();
  const level = new Float32Array(W * H);   // fill level, only meaningful at river cells

  // 1) Bank-referenced fill level per river cell.
  for (let i = 0; i < W * H; i++) {
    if (!isRiver(i)) continue;
    const x = i % W, y = (i / W) | 0;
    const t = drain[i];
    const fx = t >= 0 ? (t % W) - x : 0;
    const fy = t >= 0 ? ((t / W) | 0) - y : 0;
    // Perpendicular (bank) direction, unit.
    let px = -fy, py = fx;
    const plen = Math.hypot(px, py) || 1;
    px /= plen; py /= plen;
    const probeBank = (sign: number): number => {
      for (let d = 1; d <= BANK_PROBE_TILES; d++) {
        const bx = Math.round(x + px * d * sign);
        const by = Math.round(y + py * d * sign);
        if (bx < 0 || by < 0 || bx >= W || by >= H) return base[i];
        const bi = by * W + bx;
        if (!isRiver(bi)) return base[bi];   // first dry cell — its NATURAL grade is the bank top
      }
      return base[i];
    };
    const bankMin = Math.min(probeBank(1), probeBank(-1));
    level[i] = Math.max(bankMin - insetN, h[i] + minDepthN);
  }

  // 2) Downstream smoothing for a continuous (gently monotone) gradient.
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let i = 0; i < W * H; i++) {
      if (!isRiver(i)) continue;
      const t = drain[i];
      if (t >= 0 && isRiver(t)) level[i] = level[i] * 0.5 + level[t] * 0.5;
    }
  }

  // 3) Write river cells, then BFS-dilate the plateau outward DILATE_TILES rings,
  //    each dry cell taking the level of the nearest river cell. A high bank then
  //    has surface < terrain (discarded); a low floodplain has surface > terrain
  //    (the river widens into it) — both correct, resolved per-pixel in the shader.
  const owner = new Int32Array(W * H).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (isRiver(i)) { surf[i] = level[i]; owner[i] = i; frontier.push(i); }
  }
  for (let d = 0; d < DILATE_TILES; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W, y = (i / W) | 0;
      const src = owner[i];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (owner[ni] !== -1) continue;
        owner[ni] = src;
        surf[ni] = level[src];
        next.push(ni);
      }
    }
    frontier = next;
  }
  return surf;
}

// Memoise by (seed, dims) like the other per-world river/road stores — the field is
// static for a world, so the GPU upload's identity guard keeps hitting.
const cache = new Map<string, Float32Array>();
const CACHE_CAP = 4;

/** The memoised river water-surface field, or null when the world has no rivers. */
export function buildRiverSurfaceFieldMemo(map: GameMap): Float32Array | null {
  const hy = getHydrologyResult(map);
  let hasRiver = false;
  for (let i = 0; i < hy.waterType.length; i++) {
    if (hy.waterType[i] === WaterType.River) { hasRiver = true; break; }
  }
  if (!hasRiver) return null;
  const k = `${map.seed}:${map.width}x${map.height}`;
  let f = cache.get(k);
  if (f) return f;
  f = buildRiverSurfaceField(map, heightField(map), hy);
  cache.set(k, f);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return f;
}

/** Drop the memoised fields (tests; harmless in prod). */
export function clearRiverSurfaceFieldCache(): void {
  cache.clear();
}
