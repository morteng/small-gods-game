// src/render/gpu/water-field.ts
//
// Water S2 — the pure CPU half: pack the per-cell fields the water shader
// (`wgsl/water-wgsl.ts`) samples as storage buffers, mirroring terrain-field.ts.
// All data comes from the (memoised, deterministic) hydrology model; the shader
// reads the SAME composed-terrain height buffer the terrain pass uses, so water
// depth = surfaceW − terrainHeight needs no extra upload. No GPU/DOM here.

import type { GameMap } from '@/core/types';
import { terrainGrid, terrainGlobalsFor } from '@/render/gpu/terrain-field';
import { packTerrainGlobals, TERRAIN_GLOBALS_FLOATS, type TerrainGlobalsInput } from '@/render/gpu/instance-buffer';
import type { LightingState } from '@/render/lighting-state';
import { getHydrologyResult } from '@/world/hydrology-store';
import { WaterType } from '@/core/types';
import { classifyWaterCell, climateOf, type AquaticBiome, type Rgb } from '@/water/water-biome';

/** Depth (m) below which water blends toward opaque — past it, water is opaque. */
export const SHALLOW_BAND_M = 1.5;
/** Depth (m) under which the shoreline foam band shows. */
export const FOAM_BAND_M = 0.4;
/** WGlobals = TGlobals (24) + uWater vec4 = 28 floats / 112 bytes. */
export const WATER_GLOBALS_FLOATS = TERRAIN_GLOBALS_FLOATS + 4;

/** Linear-RGB 0..1 → 0xAABBGGRR (LE-friendly upload; shader unpacks to 0..1). */
function rgbToAbgr(c: Rgb): number {
  const r = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Pack the water uniform: the terrain globals followed by `uWater`. */
export function packWaterGlobals(
  g: TerrainGlobalsInput,
  water: [number, number, number, number],
): Float32Array {
  const b = new Float32Array(WATER_GLOBALS_FLOATS);
  b.set(packTerrainGlobals(g), 0);
  b[24] = water[0]; b[25] = water[1]; b[26] = water[2]; b[27] = water[3];
  return b;
}

/** The buffer-driven water surface handed to `GpuScene.renderFrame`. */
export interface WaterField {
  /** Row-major water-surface height (normalised elev), `width*height`; −1 dry. */
  surfaceW: Float32Array;
  /** Row-major `WaterType` per cell as u32, `width*height`. */
  waterType: Uint32Array;
  /** Row-major unit flow vectors interleaved (x,y), `2*width*height`. */
  flow: Float32Array;
  /** Per-cell aquatic-biome shallow colour `0xAABBGGRR` (S4); 0 on dry cells. */
  shallow: Uint32Array;
  /** Per-cell aquatic-biome deep colour `0xAABBGGRR` (S4). */
  deep: Uint32Array;
  /** Per-cell water clarity 0..1 (S4) — blend depth + caustic reach. */
  clarity: Float32Array;
  /** Per-cell distance to the nearest shore (land), in TILES; 0 on/at land,
   *  growing offshore. Drives shoreward swell bands + the breaking-foam line. */
  shoreDist: Float32Array;
  /** Wet cells in the field — the pass is skipped when 0. */
  wetCount: number;
  /** Vertices the grid-gen vertex shader draws (same LOD grid as terrain). */
  vertexCount: number;
  /** Packed water uniform (`WATER_GLOBALS_FLOATS`), ready to upload. */
  globals: Float32Array;
}

/**
 * Per-water-cell distance to the nearest shore (land cell), in tiles, via a
 * multi-source BFS seeded from every land cell (8-neighbour, so contours stay
 * round-ish around an island). Land reads 0; a water cell touching land reads 1,
 * and so on offshore. The shader bilinearly samples this so swell crests run
 * parallel to the coast and roll shoreward — "waves washing ashore" keyed to the
 * actual island shape. Cheap (one O(cells) sweep) and cached per map.
 */
export function computeShoreDist(width: number, height: number, waterMask: Uint8Array): Float32Array {
  const cells = width * height;
  const dist = new Float32Array(cells).fill(0);
  // Frontier = land cells adjacent to water (the coastline). BFS outward INTO
  // water only; land stays 0 (the shader never reads land cells).
  const queue = new Int32Array(cells);
  let head = 0, tail = 0;
  const visited = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    if (waterMask[i]) continue;          // land: distance 0, a BFS source
    visited[i] = 1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const c = queue[head++];
    const cx = c % width;
    const cy = (c / width) | 0;
    const d = dist[c] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (visited[ni] || !waterMask[ni]) continue;
        visited[ni] = 1;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
  }
  return dist;
}

/**
 * One-ring shore dilation — the CPU half of the pixel-perfect waterline. Copies
 * each WET cell's water attributes (surface height, type, biome colours, clarity,
 * flow) into its DRY 8-neighbours, so the water pass draws a flat water plane that
 * slightly OVERHANGS the bank on every side. The fragment shader then clips that
 * plane per-pixel at the exact terrain contour (`surfaceW − bed ≤ 0` → discard),
 * yielding a sub-cell waterline instead of the cell-quantised diamond staircase.
 *
 * Why a ring is needed: each cell's quad spans `[cell, cell+1]`, so a wet cell's
 * own quad covers only its +x/+y transitions; the −x/−y transitions live in the
 * dry neighbour's quad, which would otherwise be discarded wholesale (leaving a
 * half-cell of missing water — the staircase). Filling that neighbour lets its
 * quad draw the water up to the contour from the other side.
 *
 * Mutates the passed arrays IN PLACE. Reads the original `waterMask` to know the
 * wet/dry split: it only ever READS wet cells as sources and WRITES dry cells as
 * targets (disjoint sets), so in-place writes never chain outward past one ring.
 */
export function fillShoreRing(
  width: number,
  height: number,
  waterMask: Uint8Array,
  f: {
    surfaceW: Float32Array;
    waterType: Uint32Array;
    shallow: Uint32Array;
    deep: Uint32Array;
    clarity: Float32Array;
    flow: Float32Array;
  },
): void {
  const cells = width * height;
  for (let i = 0; i < cells; i++) {
    if (waterMask[i]) continue; // only fill dry cells
    const cx = i % width;
    const cy = (i / width) | 0;
    // Pick the wet neighbour with the HIGHEST surface (a conservative waterline —
    // the plane sits at the taller adjacent body so it can only ever over-reach,
    // never under-reach, the bank the depth clip then trims back).
    let src = -1;
    let bestSurf = -Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (!waterMask[ni]) continue; // sources are wet cells only
        if (f.surfaceW[ni] > bestSurf) {
          bestSurf = f.surfaceW[ni];
          src = ni;
        }
      }
    }
    if (src < 0) continue; // dry cell not on the shore ring — leave it dry (−1)
    f.surfaceW[i] = f.surfaceW[src];
    f.waterType[i] = f.waterType[src];
    f.shallow[i] = f.shallow[src];
    f.deep[i] = f.deep[src];
    f.clarity[i] = f.clarity[src];
    f.flow[i * 2] = f.flow[src * 2];
    f.flow[i * 2 + 1] = f.flow[src * 2 + 1];
  }
}

export interface BuildWaterFieldOpts {
  viewport: [number, number];
  xform: { sx: number; sy: number; ox: number; oy: number };
  lighting: LightingState;
  /** Seconds, for ripple animation (pure render — never the sim clock). */
  timeSec?: number;
  maxQuads?: number;
}

/** The per-cell water buffers — static for a given map (they come from the
 *  deterministic, memoised hydrology model). Cached so the live loop neither
 *  re-allocates nor re-loops over the whole map every frame, AND so the GPU
 *  upload's reference guard (`gpu-scene.uploadWaterFields`) actually hits and
 *  skips the per-frame writeBuffer. Only the `globals` uniform (camera/time)
 *  changes frame-to-frame. */
interface WaterStatic {
  surfaceW: Float32Array;
  waterType: Uint32Array;
  flow: Float32Array;
  shallow: Uint32Array;
  deep: Uint32Array;
  clarity: Float32Array;
  shoreDist: Float32Array;
  wetCount: number;
  vertexCount: number;
  subsample: number;
  /** null = world is bone dry (skip the pass). */
  dry: boolean;
}

const STATIC_CACHE = new WeakMap<GameMap, WaterStatic>();

function waterStatic(map: GameMap, maxQuads?: number): WaterStatic {
  const cached = STATIC_CACHE.get(map);
  if (cached) return cached;

  const hydro = getHydrologyResult(map);
  let wet = 0;
  for (const m of hydro.waterMask) wet += m;

  const cells = map.width * map.height;
  const flow = new Float32Array(cells * 2);
  const shallow = new Uint32Array(cells);
  const deep = new Uint32Array(cells);
  const clarity = new Float32Array(cells);

  // Aquatic biome is constant per (climate × body kind), so resolve the body
  // kinds once and reuse — climate is world-level for this slice.
  const climate = climateOf(map.worldSeed?.biome);
  const biomeByType = new Map<WaterType, AquaticBiome | null>();
  const biomeFor = (wt: WaterType): AquaticBiome | null => {
    if (!biomeByType.has(wt)) biomeByType.set(wt, classifyWaterCell(wt, climate));
    return biomeByType.get(wt)!;
  };

  for (let i = 0; i < cells; i++) {
    flow[i * 2] = hydro.flowDirX[i];
    flow[i * 2 + 1] = hydro.flowDirY[i];
    const b = biomeFor(hydro.waterType[i] as WaterType);
    if (b) {
      shallow[i] = rgbToAbgr(b.shallowColor);
      deep[i] = rgbToAbgr(b.deepColor);
      clarity[i] = b.clarity;
    }
  }

  const grid = terrainGrid(map.width, map.height, maxQuads);
  const shoreDist = computeShoreDist(map.width, map.height, hydro.waterMask);

  // Clone the (shared, memoised) hydrology surface before dilating — fillShoreRing
  // mutates it to overhang the bank for the pixel-perfect waterline, and the
  // hydrology result must stay pristine for other consumers. `waterType` is already
  // a copy (Uint32Array.from); flow/shallow/deep/clarity are freshly allocated above.
  const surfaceW = Float32Array.from(hydro.surfaceW);
  const waterType = Uint32Array.from(hydro.waterType);
  fillShoreRing(map.width, map.height, hydro.waterMask, {
    surfaceW, waterType, shallow, deep, clarity, flow,
  });

  const stat: WaterStatic = {
    surfaceW,
    waterType,
    flow, shallow, deep, clarity, shoreDist,
    wetCount: wet,
    vertexCount: grid.vertexCount,
    subsample: grid.subsample,
    dry: wet === 0,
  };
  STATIC_CACHE.set(map, stat);
  return stat;
}

/**
 * Assemble the `WaterField` for a world + camera frame, or `null` when the world
 * is bone dry (so the caller skips the pass entirely). The per-cell arrays are
 * cached per map (see `waterStatic`) — only the camera/time `globals` uniform is
 * rebuilt each frame, and the cached array references let the GPU upload skip its
 * per-frame writeBuffer.
 */
export function buildWaterField(map: GameMap, opts: BuildWaterFieldOpts): WaterField | null {
  const stat = waterStatic(map, opts.maxQuads);
  if (stat.dry) return null;

  // Water rides the terrain heightfield → it shares the terrain projection
  // uniform exactly; the only water-specific bits are the trailing uWater vec4.
  const tg: TerrainGlobalsInput = terrainGlobalsFor(map, {
    viewport: opts.viewport, xform: opts.xform, lighting: opts.lighting, subsample: stat.subsample,
  });

  return {
    surfaceW: stat.surfaceW,
    waterType: stat.waterType,
    flow: stat.flow,
    shallow: stat.shallow,
    deep: stat.deep,
    clarity: stat.clarity,
    shoreDist: stat.shoreDist,
    wetCount: stat.wetCount,
    vertexCount: stat.vertexCount,
    globals: packWaterGlobals(tg, [opts.timeSec ?? 0, SHALLOW_BAND_M, FOAM_BAND_M, 0]),
  };
}
