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
// `baseSeedHeight` half: it reproduces worldgen's eroded elevation field,
// INCLUDING the POI terrain influences (a mountain POI raises real elevation, a
// lake sinks it) so the RENDERED height agrees with the biomes worldgen
// classified from that same influenced field — else mountains read as mountains
// but stand on flat ground. It still EXCLUDES the settlement/road deformations
// that compose on top via the deformation channel (callers read one height).
// POIs are part of the world seed (available on load), so the field stays purely
// recomputable from `(seed, width, height, island, pois)` — never persisted.
//
// Lives in `src/world` (neither renderer nor connectome owns it); both lanes
// import it read-only. It returns metres — a pure world unit — so it never
// depends on render-layer pixel scales.
import type { GameMap, TerrainConfig, POI } from '@/core/types';
import { generateTerrainFields, makeBaseElevationSampler } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import { applyPoiInfluences, POI_INFLUENCES } from '@/terrain/poi-influence';
import { islandSignature, styledIslandSpec, type IslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec, shapeSignature, type TerrainShapeSpec } from '@/terrain/terrain-shape';
import { climateSignature, styledClimate, type ClimateSpec } from '@/terrain/climate';
import { worldStyleOf } from '@/core/world-style';

/** Memo-key fragment for the POIs that move elevation (mountains/lakes/…). Two
 *  worlds with the same seed/dims but different terrain POIs must not share a
 *  cached field. POIs without an elevation influence don't affect height. */
function poiHeightSignature(pois: POI[] | null | undefined): string {
  if (!pois?.length) return '';
  let s = '';
  for (const p of pois) {
    if (!p.position) continue;
    // M4: runtime-created POIs are heightfield-inert BY RULE — a runtime `castle`
    // (whose type HAS an elevation cap) must not re-key/recompute the base field;
    // its ground expression is earthworks via the deformation channel. Guarded
    // here AND in `applyPoiInfluences` (see src/world/runtime-poi.ts).
    if (p.runtime) continue;
    if (!POI_INFLUENCES[p.type]?.elevation) continue;
    s += `${p.type}@${p.position.x},${p.position.y};`;
  }
  return s;
}

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
function configFor(
  seed: number,
  width: number,
  height: number,
  island: IslandSpec | null = null,
  climate: ClimateSpec | null = null,
  shape: TerrainShapeSpec | null = null,
): TerrainConfig {
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
    island: island ?? undefined,
    climate: climate ?? undefined,
    shape: shape ?? undefined,
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
  island: IslandSpec | null = null,
  pois: POI[] | null = null,
  shape: TerrainShapeSpec | null = null,
): Float32Array {
  const cfg = configFor(seed, width, height, island, null, shape);
  const fields = generateTerrainFields(cfg);
  // Mirror map-generator EXACTLY: generate → erode → apply POI influences, so
  // this field equals the one biomes were classified from (mountains have real
  // height, lakes a real basin). Influence runs AFTER erosion (peaks stay sharp).
  fields.elevation = erodeElevation(fields.elevation, width, height, { seed });
  if (pois?.length) applyPoiInfluences(fields, pois, cfg);
  return fields.elevation;
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
  island: IslandSpec | null = null,
  pois: POI[] | null = null,
  shape: TerrainShapeSpec | null = null,
): Float32Array {
  const key = `${seed}:${width}x${height}:${islandSignature(island)}:${poiHeightSignature(pois)}:${shapeSignature(shape)}`;
  let hf = cache.get(key);
  if (hf) {
    // Refresh recency (Map preserves insertion order → re-insert = most recent).
    cache.delete(key);
    cache.set(key, hf);
    return hf;
  }
  hf = computeHeightfield(seed, width, height, island, pois, shape);
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
  climateCache.clear();
}

/**
 * The two climate fields biome classification reads — moisture + temperature —
 * resurfaced the SAME way {@link getHeightfield} resurfaces elevation: recomputed
 * deterministically from `(seed, width, height, island)` via `generateTerrainFields`
 * (which already produces them, then discards them into flat tiles), memoised, and
 * never persisted. Both are row-major `Float32Array[width*height]`, values `[0,1]`.
 *
 * Unlike elevation these need no erosion or POI influence (those only move height),
 * so a single `generateTerrainFields` call is exact. The terrain shader reads them
 * (with slope, free from the surface normal) to drive material texturing —
 * water→mud→earth→snow — so placement stays consistent with the biome the world
 * was classified into.
 */
export interface ClimateFields {
  moisture: Float32Array;
  temperature: Float32Array;
}

const climateCache = new Map<string, ClimateFields>();

/** Memoised moisture+temperature fields for a world. Same array instances across
 *  calls with matching `(seed, width, height, island)`; treat as read-only. */
export function getClimateFields(map: GameMap): ClimateFields {
  const { seed, width, height } = map;
  // Inspection ground (studio): uniform temperate climate — no cold cells, so the
  // shader paints no snow on the flat plane (it composes snow from temperature).
  if (map.flatHeight) {
    const n = width * height;
    return { moisture: new Float32Array(n).fill(0.5), temperature: new Float32Array(n).fill(0.7) };
  }
  const island = styledIslandSpec(map.worldSeed);
  const climate = styledClimate(map.worldSeed);
  const shape = styledShapeSpec(map.worldSeed);
  const key = `${seed}:${width}x${height}:${islandSignature(island)}:${climateSignature(climate)}:${shapeSignature(shape)}`;
  let c = climateCache.get(key);
  if (c) {
    climateCache.delete(key);
    climateCache.set(key, c);
    return c;
  }
  const fields = generateTerrainFields(configFor(seed, width, height, island, climate, shape));
  c = { moisture: fields.moisture, temperature: fields.temperature };
  climateCache.set(key, c);
  if (climateCache.size > CACHE_CAP) {
    const oldest = climateCache.keys().next().value;
    if (oldest !== undefined) climateCache.delete(oldest);
  }
  return c;
}

/**
 * The world's analytic BASE-elevation sampler at CONTINUOUS tile coords — the
 * pre-erosion, pre-POI elevation math (same one worldgen runs per integer cell),
 * built for this map's seed/dims/island. Used to recover genuine sub-tile relief
 * for the detail-patch renderer: re-evaluating it at half-tile coords reveals real
 * high-frequency structure that bilinear upsampling of the coarse field cannot.
 */
export function baseElevationSamplerFor(map: GameMap): (x: number, y: number) => number {
  const island = styledIslandSpec(map.worldSeed);
  const shape = styledShapeSpec(map.worldSeed);
  return makeBaseElevationSampler(configFor(map.seed, map.width, map.height, island, null, shape));
}

/** Normalised elevation `[0,1]` at a tile (edge-clamped to the map). */
export function elevationAt(map: GameMap, tx: number, ty: number): number {
  const { seed, width, height } = map;
  const hf = getHeightfield(seed, width, height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
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
  // `mountainRelief` (S1 style knob) sets the metre span of the 0→1 field;
  // defaults to TERRAIN_RELIEF_M, so unstyled worlds are unchanged.
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  return (elevationAt(map, tx, ty) - ELEVATION_SEA_LEVEL) * relief;
}

/**
 * {@link heightMetresAt} at CONTINUOUS tile coords — bilinear over the same memoised base
 * field (edge-clamped). This is exactly the surface the GPU terrain mesh draws between
 * cell centres, so consumers sampling a fractional centerline (the road carve's grade
 * line) see the renderer's ground rather than the nearest cell's — `Math.round` sampling
 * quantised the carve's grade to whole tiles while the ribbon rode the interpolated mesh.
 */
export function heightMetresBilinearAt(map: GameMap, x: number, y: number): number {
  const { seed, width, height } = map;
  const hf = getHeightfield(seed, width, height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const a = hf[y0 * width + x0], b = hf[y0 * width + x1];
  const c = hf[y1 * width + x0], d = hf[y1 * width + x1];
  const e = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  return (e - ELEVATION_SEA_LEVEL) * relief;
}
