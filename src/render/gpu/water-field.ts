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

/**
 * Assemble the `WaterField` for a world + camera frame, or `null` when the world
 * is bone dry (so the caller skips the pass entirely). The per-cell arrays are the
 * hydrology model's own buffers (shared by reference — read-only on the GPU).
 */
export function buildWaterField(map: GameMap, opts: BuildWaterFieldOpts): WaterField | null {
  const hydro = getHydrologyResult(map);
  let wet = 0;
  for (const m of hydro.waterMask) wet += m;
  if (wet === 0) return null;

  const cells = map.width * map.height;
  const flow = new Float32Array(cells * 2);
  for (let i = 0; i < cells; i++) {
    flow[i * 2] = hydro.flowDirX[i];
    flow[i * 2 + 1] = hydro.flowDirY[i];
  }

  const grid = terrainGrid(map.width, map.height, opts.maxQuads);
  const style = worldStyleOf(map.worldSeed);
  const tg: TerrainGlobalsInput = {
    viewport: opts.viewport,
    xform: opts.xform,
    grid: [map.width, map.height],
    half: [ISO_TILE_W / 2, ISO_TILE_H / 2],
    zPxPerM: style.terrainVerticalExaggeration,
    seaLevel: ELEVATION_SEA_LEVEL,
    reliefM: style.mountainRelief,
    subsample: grid.subsample,
    sunDir: TERRAIN_SUN_DIR,
    bands: opts.lighting.bands,
    ambient: opts.lighting.ambient,
    sunStrength: luminance(opts.lighting.sunColor),
  };

  return {
    surfaceW: hydro.surfaceW,
    waterType: Uint32Array.from(hydro.waterType),
    flow,
    wetCount: wet,
    vertexCount: grid.vertexCount,
    globals: packWaterGlobals(tg, [opts.timeSec ?? 0, SHALLOW_BAND_M, FOAM_BAND_M, 0]),
  };
}
