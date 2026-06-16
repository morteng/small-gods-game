// src/world/heightfield.ts
//
// World-owned terrain heightfield — the seed-deterministic elevation substrate.
//
// Worldgen computes an eroded elevation field (`generateTerrainFields` →
// `erodeElevation`, in `src/map/map-generator.ts`) to drive biome
// classification, then DISCARDS it into flat tiles. This service resurfaces
// that SAME base field on demand, recomputed purely from `(seed, width,
// height)` — so it is **not persisted** in saves (it regenerates identically),
// and BOTH the renderer (height shading now, geometry later) and sim/connectome
// (placement affordance, slope) can read it **read-only**.
//
// Per the cross-session contract (coordination-board, connectome confirmed) the
// final `heightAt(tx,ty)` is `baseSeedHeight ⊕ deformations`. This module is the
// `baseSeedHeight` half only: it reproduces the base eroded field, EXCLUDING the
// POI / settlement / road deformations that worldgen and the connectome apply on
// top (those compose in a later slice — callers keep reading one read-only
// height and never see the layering).
//
// Lives in `src/world` (neither renderer nor connectome owns it); both lanes
// import it read-only. It returns metres — a pure world unit — so it never
// depends on render-layer pixel scales.
import type { GameMap, TerrainConfig } from '@/core/types';
import { generateTerrainFields } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import { DEFAULT_ISLAND } from '@/terrain/island-mask';

/**
 * Total vertical relief from elevation `0` → `1`, in metres. Tunable; chosen so
 * peaks read as rolling hills rather than alpine spikes at this map scale (a
 * tile is 2 m across). Sea level sits at {@link ELEVATION_SEA_LEVEL} of the
 * `[0,1]` range, so {@link heightMetresAt} reports metres relative to the
 * shoreline (water negative, high ground positive).
 */
export const TERRAIN_RELIEF_M = 48;

/**
 * Normalised elevation of the waterline. Mirrors the `seaLevel` default baked
 * into `map-generator`'s `TerrainConfig` — kept in sync here so height is
 * reported relative to the same shoreline the biomes were classified against.
 */
export const ELEVATION_SEA_LEVEL = 0.35;

/**
 * Reproduce the EXACT `TerrainConfig` `generateWithNoise` builds from the world
 * dimensions (`src/map/map-generator.ts`). The elevation/moisture scales are
 * derived from `maxDim`, the rest are fixed — so `(seed, width, height)` alone
 * pins the field. If those worldgen constants change, update them here too (a
 * heightfield-parity test guards the shape).
 */
function configFor(seed: number, width: number, height: number, island = false): TerrainConfig {
  const maxDim = Math.max(width, height);
  return {
    seed,
    width,
    height,
    elevationScale: 6.0 / maxDim,
    moistureScale: 8.0 / maxDim,
    seaLevel: ELEVATION_SEA_LEVEL,
    poleFalloff: true,
    continentWarp: 2.0,
    island: island ? DEFAULT_ISLAND : undefined,
  };
}

/**
 * Recompute the base eroded elevation field for a world, purely from its seed
 * and dimensions. Row-major `Float32Array[width*height]`, values in `[0,1]`.
 * Deterministic: same inputs → identical array. Excludes POI/connectome
 * deformations (see file header).
 */
export function computeHeightfield(
  seed: number,
  width: number,
  height: number,
  island = false,
): Float32Array {
  const cfg = configFor(seed, width, height, island);
  const fields = generateTerrainFields(cfg);
  return erodeElevation(fields.elevation, width, height, { seed });
}

// Small LRU-ish memo: a heightfield is ~256 KB for a 256² map and recomputing
// it runs erosion, so we cache per (seed,dims). Worlds are rare; cap a few so
// repeated "New World" can't grow this unbounded.
const CACHE_CAP = 4;
const cache = new Map<string, Float32Array>();

/**
 * Memoised {@link computeHeightfield}. Returns the SAME array instance for
 * repeated calls with the same `(seed, width, height)` — callers must treat it
 * as read-only.
 */
export function getHeightfield(
  seed: number,
  width: number,
  height: number,
  island = false,
): Float32Array {
  const key = `${seed}:${width}x${height}:${island ? 'i' : 'c'}`;
  let hf = cache.get(key);
  if (hf) {
    // Refresh recency (Map preserves insertion order → re-insert = most recent).
    cache.delete(key);
    cache.set(key, hf);
    return hf;
  }
  hf = computeHeightfield(seed, width, height, island);
  cache.set(key, hf);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return hf;
}

/** Drop all cached heightfields (used by tests; harmless in prod). */
export function clearHeightfieldCache(): void {
  cache.clear();
}

/** Normalised elevation `[0,1]` at a tile (edge-clamped to the map). */
export function elevationAt(map: GameMap, tx: number, ty: number): number {
  const { seed, width, height } = map;
  const hf = getHeightfield(seed, width, height, !!map.worldSeed?.island);
  const cx = Math.max(0, Math.min(width - 1, tx | 0));
  const cy = Math.max(0, Math.min(height - 1, ty | 0));
  return hf[cy * width + cx];
}

/**
 * Terrain height in metres at a tile, with sea level = `0 m` (above positive,
 * below the waterline negative). This is the value that backs the renderer's
 * `TerrainView.heightAt` and the connectome's placement affordance.
 */
export function heightMetresAt(map: GameMap, tx: number, ty: number): number {
  return (elevationAt(map, tx, ty) - ELEVATION_SEA_LEVEL) * TERRAIN_RELIEF_M;
}
