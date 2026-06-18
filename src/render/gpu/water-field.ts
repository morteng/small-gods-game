// src/render/gpu/water-field.ts
//
// Water S2 — the pure CPU half: pack the per-cell fields the water shader
// (`wgsl/water-wgsl.ts`) samples as storage buffers, mirroring terrain-field.ts.
// All data comes from the (memoised, deterministic) hydrology model; the shader
// reads the SAME composed-terrain height buffer the terrain pass uses, so water
// depth = surfaceW − terrainHeight needs no extra upload. No GPU/DOM here.

import type { GameMap } from '@/core/types';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { worldStyleOf } from '@/core/world-style';
import { terrainGrid, TERRAIN_SUN_DIR } from '@/render/gpu/terrain-field';
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

/** Relative luminance of an RGB triple — the water sun-strength scalar. */
function luminance(c: readonly [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

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
  /** Wet cells in the field — the pass is skipped when 0. */
  wetCount: number;
  /** Vertices the grid-gen vertex shader draws (same LOD grid as terrain). */
  vertexCount: number;
  /** Packed water uniform (`WATER_GLOBALS_FLOATS`), ready to upload. */
  globals: Float32Array;
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
  const stat: WaterStatic = {
    surfaceW: hydro.surfaceW,
    waterType: Uint32Array.from(hydro.waterType),
    flow, shallow, deep, clarity,
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

  const style = worldStyleOf(map.worldSeed);
  const tg: TerrainGlobalsInput = {
    viewport: opts.viewport,
    xform: opts.xform,
    grid: [map.width, map.height],
    half: [ISO_TILE_W / 2, ISO_TILE_H / 2],
    zPxPerM: style.terrainVerticalExaggeration,
    seaLevel: ELEVATION_SEA_LEVEL,
    reliefM: style.mountainRelief,
    subsample: stat.subsample,
    sunDir: TERRAIN_SUN_DIR,
    bands: opts.lighting.bands,
    ambient: opts.lighting.ambient,
    sunStrength: luminance(opts.lighting.sunColor),
  };

  return {
    surfaceW: stat.surfaceW,
    waterType: stat.waterType,
    flow: stat.flow,
    shallow: stat.shallow,
    deep: stat.deep,
    clarity: stat.clarity,
    wetCount: stat.wetCount,
    vertexCount: stat.vertexCount,
    globals: packWaterGlobals(tg, [opts.timeSec ?? 0, SHALLOW_BAND_M, FOAM_BAND_M, 0]),
  };
}
