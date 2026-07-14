// src/render/snow-mask.ts
//
// CPU mirror of the terrain shader's SNOW decision (terrain-wgsl.ts fsMain):
//
//   wSnowCold = smoothstep(0.30, 0.16, temp)                       — cold ground
//   wSnowAlt  = smoothstep(22.5, 28.0, metresAS)
//             * smoothstep(0.45, 0.33, temp)                       — altitude cap
//   wSnow     = max(wSnowCold, wSnowAlt) * smoothstep(0.42, 0.70, n.y)  — flat-ground gate
//
// so entities (trees, rocks, ground cover) can KNOW they stand on snow — the
// per-instance whiten + the deciduous bare-crown swap both read this. The
// shader's per-pixel jitter terms are deliberately dropped: an entity needs one
// value per tile, not pixel noise. Inputs are the SAME buffers the shader is
// fed (heightField = composed+curved elevation, getClimateFields = temperature,
// worldStyleOf = reliefM/zPxPerM), and the normal mirrors the vertex shader's
// fixed ±1-tile central difference with up-term ISO_TILE_H/2 — so the mask can't
// drift from the painted ground.
//
// Deterministic + cheap: fields are memoised per map (same memos the renderer
// hits) and per-tile results are cached in a lazy Float32Array keyed on the
// field identities, so per-draw-list-entity calls are a couple of array reads.

import type { GameMap } from '@/core/types';
import { heightField } from '@/render/gpu/terrain-field';
import { getClimateFields, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import { ISO_TILE_H } from '@/render/iso/iso-constants';

/** GLSL/WGSL-shaped smoothstep. Descending edges (e0 > e1) invert the ramp — the
 *  same clamp((x-e0)/(e1-e0)) arithmetic the GPU evaluates for the snow weights. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The per-cell field inputs of the snow kernel — the exact CPU-side quantities the
 *  terrain shader is fed. Exposed so the kernel is testable with synthetic fields. */
export interface SnowFields {
  /** Row-major normalised elevation [0,1] (the shader's height buffer). */
  heights: Float32Array;
  /** Row-major temperature [0,1] (the shader's climate buffer). */
  temperature: Float32Array;
  width: number;
  height: number;
  /** Metres for the elevation 0→1 span (uZParams.z = style.mountainRelief). */
  reliefM: number;
  /** Screen px per metre of lift (uZParams.x = style.terrainVerticalExaggeration). */
  zPxPerM: number;
}

/**
 * Pure snow kernel at an integer tile — the shader's decision minus its pixel
 * jitter. Edge tiles keep the shader's flat-normal fallback (n.y = 1).
 */
export function computeSnow01(f: SnowFields, tx: number, ty: number): number {
  const W = f.width, H = f.height;
  if (W <= 0 || H <= 0) return 0;
  const x = Math.min(W - 1, Math.max(0, Math.trunc(tx)));
  const y = Math.min(H - 1, Math.max(0, Math.trunc(ty)));
  const i = y * W + x;
  const temp = f.temperature[i];
  const aboveSea = f.heights[i] - ELEVATION_SEA_LEVEL;
  const metresAS = aboveSea * f.reliefM;

  // Normal.y from ±1-tile central differences of the SCREEN-px lift, up-term
  // ISO_TILE_H/2 — mirrors terrain-wgsl vsMain (which falls back to a flat
  // normal within half a tile of the border).
  let ny = 1;
  if (x >= 1 && x <= W - 2 && y >= 1 && y <= H - 2) {
    const zs = f.reliefM * f.zPxPerM;
    const gx = (f.heights[i + 1] - f.heights[i - 1]) * zs * 0.5;
    const gz = (f.heights[i + W] - f.heights[i - W]) * zs * 0.5;
    const up = ISO_TILE_H / 2;
    ny = up / Math.hypot(gx, up, gz);
  }

  const wSnowCold = smoothstep(0.30, 0.16, temp);
  const wSnowAlt = smoothstep(22.5, 28.0, metresAS) * smoothstep(0.45, 0.33, temp);
  const w = Math.max(wSnowCold, wSnowAlt) * smoothstep(0.42, 0.70, ny);
  return Number.isFinite(w) ? w : 0;
}

interface SnowCache {
  heights: Float32Array;
  temperature: Float32Array;
  /** Lazy per-tile results; NaN = not yet computed. */
  snow: Float32Array;
  fields: SnowFields;
  /** map.tilesRev at validation time — the cheap staleness signal. */
  tilesRev: number | undefined;
}

// Per-map cache. The field memos (heightField / getClimateFields) are stable per
// world, so identities are re-fetched only on first access and when `map.tilesRev`
// bumps (the runtime-mutation signal) — NOT per entity: a static draw-list rebuild
// calls snowAmount01 for every flora instance and the memo-key string building
// inside the field getters is not free at 20k calls. The mask is static per world
// by design, so this staleness window is exactly the tile-mutation one.
// `null` = the map can't produce fields (studio/test stubs) → always 0.
const cacheByMap = new WeakMap<GameMap, SnowCache | null>();

function cacheFor(map: GameMap): SnowCache | null {
  // Studio inspection ground: dead-flat, uniform temperate climate — the shader
  // paints no snow there and getComposedHeightfield returns a FRESH array per
  // call (an identity check would thrash), so short-circuit.
  if (map.flatHeight) return null;
  let c = cacheByMap.get(map);
  if (c !== undefined && (c === null || c.tilesRev === map.tilesRev)) return c;
  let heights: Float32Array, temperature: Float32Array;
  try {
    heights = heightField(map);
    temperature = getClimateFields(map).temperature;
  } catch {
    // A stub/partial map (tests, studio grounds without a seed) has no field
    // substrate — treat as snowless rather than throwing on the frame path.
    cacheByMap.set(map, null);
    return null;
  }
  if (c && c.heights === heights && c.temperature === temperature) {
    c.tilesRev = map.tilesRev;
    return c;
  }
  const style = worldStyleOf(map.worldSeed);
  c = {
    heights, temperature,
    snow: new Float32Array(map.width * map.height).fill(NaN),
    fields: {
      heights, temperature, width: map.width, height: map.height,
      reliefM: style.mountainRelief, zPxPerM: style.terrainVerticalExaggeration,
    },
    tilesRev: map.tilesRev,
  };
  cacheByMap.set(map, c);
  return c;
}

/**
 * Snow coverage [0,1] of the ground at a tile — the value the terrain shader
 * paints there (sans pixel jitter). Deterministic, memoised per tile; safe to
 * call per draw-list entity. Non-integer coords are floored to their tile.
 */
export function snowAmount01(map: GameMap, tx: number, ty: number): number {
  const c = cacheFor(map);
  if (!c) return 0;
  const W = map.width, H = map.height;
  const x = Math.min(W - 1, Math.max(0, Math.trunc(tx)));
  const y = Math.min(H - 1, Math.max(0, Math.trunc(ty)));
  const i = y * W + x;
  let v = c.snow[i];
  if (Number.isNaN(v)) {
    v = computeSnow01(c.fields, x, y);
    c.snow[i] = v;
  }
  return v;
}
