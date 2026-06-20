/**
 * Island mask (connectome-driven world layout epic, slice W1).
 *
 * Noise terrain runs land all the way to the map border with no guarantee of a
 * water frame. The island mask shapes the landmass: it sinks the map edges below
 * sea level so every world reads as an island ("all lands are islands"), with a
 * tapered coast between the untouched interior and the deep-ocean border.
 *
 * Pure + deterministic: the falloff depends only on `(x, y, width, height, spec)`,
 * so the SAME mask is reproduced everywhere the elevation field is rebuilt — both
 * the biome/tile generation path (`generateTerrainFields` in terrain-generator)
 * and the render heightfield path (`computeHeightfield` in world/heightfield).
 * That shared determinism is what keeps water biomes and rendered terrain height
 * in agreement; both import {@link DEFAULT_ISLAND} so they cannot drift.
 */

import { worldStyleOf, type WorldStyleConfig } from '@/core/world-style';
import { fbm } from '@/core/noise';

export interface IslandSpec {
  /**
   * Distance metric over the normalised [-1,1]² grid:
   * - `euclidean` → an elliptical island inscribed in the (possibly rectangular) map.
   * - `square`    → max-axis distance; fills the rectangle, sinking only a border band.
   */
  shape: 'euclidean' | 'square';
  /** Normalised distance where the mask begins to bite. Below this: no reduction. */
  start: number;
  /** Normalised distance at/after which elevation is fully sunk to ocean. */
  end: number;
  /**
   * Inland-relief **plateau** height `[0,1]` (C1). The land swells from ~0 at the
   * shore up to this value over the interior, keyed to *distance from the coast*
   * (see {@link coastReliefAt}) — so an island reads as land rising from the
   * beach to a broad upland, NOT a flat disc with the ocean cut around it, and
   * NOT the old centre-spiking dome that mountain-ified the middle. The base fbm
   * noise + POI peaks ride on top. `0` = no relief (edge-sink-only).
   *
   * (Field name kept `dome` for back-compat with seeds + the `coastDrama` style
   * knob, which scales it; the *shape* it drives changed from a radial dome to a
   * coast-distance ramp in C1.)
   */
  dome?: number;
  /**
   * Coastline-warp amplitude in normalised-distance units (C2). When `> 0` the
   * outline contour wobbles inward (bays/coves) and outward (capes/peninsulas)
   * by up to ±this, driven by seeded multi-octave fbm — turning the round
   * euclidean/square disc into an organic, irregular shore. The warp is TAPERED
   * to 0 before the map border (see {@link COAST_WARP_TAPER_HI}) so the closed
   * ocean frame is preserved regardless of amplitude. Because the relief's
   * coast-distance field measures from this same (warped) land/sea mask, inland
   * relief follows the warped shore for free. `0` (or unset) = a round coast.
   */
  coastWarp?: number;
  /**
   * Spatial frequency of the coastline-warp fbm (tile⁻¹). Lower = broader bays
   * and headlands; higher = finer crenellation. Unset → {@link COAST_WARP_FREQ}.
   */
  coastWarpFreq?: number;
}

/** Default spatial frequency of the coastline-warp fbm (tile⁻¹) — broad bays a
 *  few dozen tiles across, with finer detail from the higher fbm octaves. */
export const COAST_WARP_FREQ = 0.03;
/** fbm octaves for the coastline warp (big bays + fine crenellation). */
const COAST_WARP_OCTAVES = 4;
/** Seed offset so the coast warp is decorrelated from the terrain noise fields. */
const COAST_WARP_SEED = 8181;
/**
 * The coastline warp is multiplied by a taper that fades from full to 0 across
 * `[LO, HI]` of normalised distance, and is 0 beyond `HI`. `HI < 1.0` is the
 * load-bearing invariant: every border tile sits at `d ≥ 1.0` (edge midpoints =
 * 1, corners ≈ 1.41), so the border is NEVER warped and the closed ocean frame
 * survives any amplitude. The coast band (`start..end`) sits below `LO`, so the
 * shoreline itself gets the full warp.
 */
const COAST_WARP_TAPER_LO = 0.86;
const COAST_WARP_TAPER_HI = 0.95;

/**
 * Default island shape. `end <= 1.0` guarantees the edge midpoints (d = 1) and
 * the corners (d ≈ 1.41 euclidean) are fully sunk → a closed ocean frame; the
 * interior (d < start) is untouched, with a tapered coast between. The `dome`
 * lifts the interior (coast-distance relief, C1); `coastWarp` breaks the round
 * disc into an irregular shore (C2).
 */
export const DEFAULT_ISLAND: IslandSpec = {
  // coastWarp raised + freq lowered so the shore reads as an organic landmass with
  // real bays/peninsulas instead of a near-round disc (lower freq = larger lobes).
  shape: 'euclidean', start: 0.62, end: 1.0, dome: 0.16, coastWarp: 0.28, coastWarpFreq: 0.022,
};

/**
 * Normalise a {@link WorldSeed.island} value to a spec (or null when off):
 * `false`/`undefined` → null, `true` → {@link DEFAULT_ISLAND}, a spec → itself.
 */
export function resolveIslandSpec(island: boolean | IslandSpec | undefined): IslandSpec | null {
  if (!island) return null;
  return island === true ? DEFAULT_ISLAND : island;
}

/** Stable, compact signature of a spec (for cache keys). `null` → "c" (continent).
 *  Includes the warp params so two worlds differing only in coast warp don't
 *  collide in the heightfield / coast-distance caches. */
export function islandSignature(spec: IslandSpec | null): string {
  return spec
    ? `i${spec.shape[0]}${spec.start}-${spec.end}-${spec.dome ?? 0}-${spec.coastWarp ?? 0}-${spec.coastWarpFreq ?? COAST_WARP_FREQ}`
    : 'c';
}

/**
 * Apply the world-style `coastDrama` knob (S1) to a resolved spec: scale the
 * central-dome swell so the land rises more (storybook) or less (simulator)
 * dramatically from coast to interior. `coastDrama === 1` (default) returns the
 * SAME spec instance unchanged — so the cache signature and every downstream
 * field stay byte-identical when the knob is at its neutral value.
 */
export function applyCoastDrama(spec: IslandSpec | null, coastDrama: number): IslandSpec | null {
  if (!spec || coastDrama === 1) return spec;
  return { ...spec, dome: (spec.dome ?? 0) * coastDrama };
}

/**
 * The island spec a world actually uses: {@link resolveIslandSpec} of its
 * `island` field, with the style's `coastDrama` applied. The SINGLE resolver both
 * worldgen and the render heightfield call, so they cannot drift. `null` when the
 * world is not an island.
 */
export function styledIslandSpec(
  seed?: { island?: boolean | IslandSpec; style?: WorldStyleConfig } | null,
): IslandSpec | null {
  return applyCoastDrama(resolveIslandSpec(seed?.island), worldStyleOf(seed).coastDrama);
}

/** Hermite smoothstep, clamped to [0,1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Normalised radial distance of a tile from the island centre (0 = centre,
 *  1 = edge midpoint, ~1.41 = euclidean corner). The round baseline. */
function islandDistance(x: number, y: number, width: number, height: number, spec: IslandSpec): number {
  // Normalise tile centre to [-1, 1] on each axis (a 1-wide axis stays centred).
  const nx = width  <= 1 ? 0 : (x / (width  - 1)) * 2 - 1;
  const ny = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
  return spec.shape === 'square'
    ? Math.max(Math.abs(nx), Math.abs(ny))
    : Math.hypot(nx, ny);
}

/**
 * Coast-warped normalised distance (C2): the round {@link islandDistance}
 * perturbed inward/outward by seeded fbm so the shoreline reads as irregular.
 * The perturbation is TAPERED to 0 by {@link COAST_WARP_TAPER_HI} (< the
 * border's d = 1), so border tiles are never warped → the ocean frame is
 * preserved. `coastWarp ≤ 0` (or seedless legacy with no warp) → the exact round
 * distance, byte-for-byte. Pure + deterministic in `(x,y,spec,seed)`.
 */
function warpedIslandDistance(
  x: number, y: number, width: number, height: number, spec: IslandSpec, seed: number,
): number {
  const d = islandDistance(x, y, width, height, spec);
  const warp = spec.coastWarp ?? 0;
  if (warp <= 0) return d;
  const taper = 1 - smoothstep(COAST_WARP_TAPER_LO, COAST_WARP_TAPER_HI, d);
  if (taper <= 0) return d;
  const freq = spec.coastWarpFreq ?? COAST_WARP_FREQ;
  const n = fbm(x * freq, y * freq, { seed: seed + COAST_WARP_SEED, octaves: COAST_WARP_OCTAVES }); // [0,1]
  const out = d + (n - 0.5) * 2 * warp * taper;
  return out < 0 ? 0 : out;
}

/**
 * Mask strength at a tile: `0` = keep elevation unchanged (interior),
 * `1` = fully sink to ocean (border). Pure and deterministic. `seed` drives the
 * coastline warp (C2); a spec with no `coastWarp` ignores it and stays round.
 */
export function islandFalloff(
  x: number,
  y: number,
  width: number,
  height: number,
  spec: IslandSpec = DEFAULT_ISLAND,
  seed = 0,
): number {
  return smoothstep(spec.start, spec.end, warpedIslandDistance(x, y, width, height, spec, seed));
}

// ─── Coast-distance relief (C1) ─────────────────────────────────────────────

/**
 * Falloff value at/above which a tile counts as SEA for the macro land/sea split
 * that the coast-distance field measures from. Chosen near the *real* waterline:
 * by here the falloff has multiplied a nominal interior elevation below sea
 * level, so inland relief starts at ~0 along the actual shore (beaches stay low)
 * rather than from the structural `start` band further out.
 */
const COAST_SEA_THRESHOLD = 0.35;

/**
 * Fraction of the deepest coast-distance over which inland relief ramps from 0
 * (shore) to the full plateau (`spec.dome`). The innermost ~(1−frac) of the land
 * sits on the plateau, so relief reads as a broad upland rather than a
 * centre-spiking dome.
 */
const RELIEF_RAMP_FRAC = 0.55;

interface CoastField {
  /** Row-major tiles-to-nearest-sea (chamfer); 0 in sea cells. */
  dist: Float32Array;
  /** Deepest land distance in the field (0 if no land). */
  maxDist: number;
}

const COAST_CACHE_CAP = 6;
const coastCache = new Map<string, CoastField>();

/** Drop cached coast fields (tests; harmless in prod). */
export function clearCoastFieldCache(): void {
  coastCache.clear();
}

/**
 * Chamfer (orthogonal=1, diagonal=√2) distance-to-coast over the macro land/sea
 * mask, memoised by `(w, h, spec signature, seed)`. Sea cells (`islandFalloff ≥
 * {@link COAST_SEA_THRESHOLD}`) are 0; land cells hold tiles to the nearest sea
 * cell. Pure + deterministic — two passes, O(w·h). Because the mask comes from
 * {@link islandFalloff} (which C2 warps), the distance field — and the relief
 * built on it — follows the warped coastline automatically.
 */
function getCoastField(width: number, height: number, spec: IslandSpec, seed: number): CoastField {
  const key = `${width}x${height}:${islandSignature(spec)}:${seed}`;
  const hit = coastCache.get(key);
  if (hit) { coastCache.delete(key); coastCache.set(key, hit); return hit; }

  const n = width * height;
  const dist = new Float32Array(n);
  const INF = 1e9;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sea = islandFalloff(x, y, width, height, spec, seed) >= COAST_SEA_THRESHOLD;
      dist[y * width + x] = sea ? 0 : INF;
    }
  }
  const D1 = 1, D2 = Math.SQRT2;
  // Forward pass (top-left → bottom-right).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = dist[i];
      if (y > 0)                  d = Math.min(d, dist[i - width] + D1);
      if (x > 0)                  d = Math.min(d, dist[i - 1] + D1);
      if (y > 0 && x > 0)         d = Math.min(d, dist[i - width - 1] + D2);
      if (y > 0 && x < width - 1) d = Math.min(d, dist[i - width + 1] + D2);
      dist[i] = d;
    }
  }
  // Backward pass (bottom-right → top-left).
  let maxDist = 0;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = dist[i];
      if (y < height - 1)                  d = Math.min(d, dist[i + width] + D1);
      if (x < width - 1)                   d = Math.min(d, dist[i + 1] + D1);
      if (y < height - 1 && x < width - 1) d = Math.min(d, dist[i + width + 1] + D2);
      if (y < height - 1 && x > 0)         d = Math.min(d, dist[i + width - 1] + D2);
      dist[i] = d;
      if (d < INF && d > maxDist) maxDist = d;
    }
  }

  const field: CoastField = { dist, maxDist };
  coastCache.set(key, field);
  if (coastCache.size > COAST_CACHE_CAP) {
    const oldest = coastCache.keys().next().value;
    if (oldest !== undefined) coastCache.delete(oldest);
  }
  return field;
}

/**
 * Inland relief ADDED at a tile (C1) — the dome replacement. Rises with distance
 * from the coast: ~0 at the shore (coastal plain / beach), ramping up to
 * `spec.dome` (the plateau) over the inner island, so land swells from the beach
 * to a broad upland interior WITHOUT a central bullseye. POI peaks ride on top.
 * `0` when no `dome` configured. Adaptive: the ramp spans a fraction of the
 * island's own deepest coast-distance, so it reaches the plateau on any map size.
 */
export function coastReliefAt(
  x: number, y: number, width: number, height: number,
  spec: IslandSpec = DEFAULT_ISLAND, seed = 0,
): number {
  const plateau = spec.dome ?? 0;
  if (plateau <= 0) return 0;
  const { dist, maxDist } = getCoastField(width, height, spec, seed);
  if (maxDist <= 0) return 0;
  // Bilinear-sample the coast distance field so FRACTIONAL coords (sub-tile detail
  // sampling) read a finite, continuous value instead of `dist[non-integer]` =
  // undefined ⇒ NaN. At integer coords this is exactly the cell value, so worldgen
  // (which only samples integer cells) stays byte-identical.
  const px = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const py = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const tx = px - x0, ty = py - y0;
  const dTop = dist[y0 * width + x0] + (dist[y0 * width + x1] - dist[y0 * width + x0]) * tx;
  const dBot = dist[y1 * width + x0] + (dist[y1 * width + x1] - dist[y1 * width + x0]) * tx;
  const d = dTop + (dBot - dTop) * ty;
  if (d <= 0) return 0;
  const ramp = maxDist * RELIEF_RAMP_FRAC;
  return plateau * (ramp <= 0 ? 1 : smoothstep(0, ramp, d));
}

/**
 * **C0 seam — the ONE coast/relief shaping every consumer calls.** Given a base
 * elevation `e` at a tile, returns it shaped into an island: interior relief
 * ADDED ({@link coastReliefAt} — a coast-distance ramp since C1), then the
 * land/sea `falloff` MULTIPLIED in to sink the edges to ocean.
 *
 * Returns the shaped value **UNCLAMPED** — callers clamp to `[0,1]` (matches
 * both call sites: `generateTerrainFields` and {@link applyIslandMask}).
 * Collapsing the two duplicate shaping implementations behind this single
 * function is the whole point of C0: C1/C2 change relief and warp the coast
 * HERE, and no consumer call site moves.
 *
 * `seed` feeds the relief's coast-distance field and the warped coastline (C2).
 */
export function shapeCoastElevation(
  e: number,
  x: number,
  y: number,
  width: number,
  height: number,
  spec: IslandSpec,
  seed: number,
): number {
  let out = e + coastReliefAt(x, y, width, height, spec, seed);
  const f = islandFalloff(x, y, width, height, spec, seed);
  if (f > 0) out *= 1 - f;
  return out;
}

/**
 * Shape an elevation field into an island in place via {@link shapeCoastElevation}
 * per cell, clamping to `[0,1]`. Row-major `[width*height]`; returns the same
 * array. (Test/legacy helper — the production path shapes inline in
 * `generateTerrainFields`; both now go through the one seam.)
 */
export function applyIslandMask(
  elevation: Float32Array,
  width: number,
  height: number,
  spec: IslandSpec = DEFAULT_ISLAND,
  seed = 0,
): Float32Array {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = shapeCoastElevation(elevation[i], x, y, width, height, spec, seed);
      elevation[i] = e > 1 ? 1 : e < 0 ? 0 : e;
    }
  }
  return elevation;
}
