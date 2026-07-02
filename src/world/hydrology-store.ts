// src/world/hydrology-store.ts
//
// The world's hydrology data model (Water S0/S1), memoised per (seed, dims) — the
// SAME derive-don't-persist contract as getHeightfield / getRoadDeformationStore.
//
// generateHydrology only reads `fields.elevation`; we feed it the seed heightfield
// (the eroded + POI-influenced field map-generator classifies biomes from, so the
// result matches map-generator's own hydrology pass byte-for-byte) at the world's
// sea level. Nothing here is persisted — it re-derives identically on load, which
// is why the renderer can read `waterType` / `surfaceW` / `flowDir` without the
// HydrologyResult travelling in the save.
import type { GameMap, HydrologyResult, TerrainField } from '@/core/types';
import { generateHydrology, buildVolcanoScorchMask, styledRiverFlowThreshold } from '@/terrain/hydrology';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec, shapeSignature } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';

const cache = new Map<string, HydrologyResult>();
const CACHE_CAP = 4;

function key(map: GameMap): string {
  return `${map.seed}:${map.width}x${map.height}:s${shapeSignature(styledShapeSpec(map.worldSeed))}`;
}

/** The world's water model — memoised. Deterministic from (seed, dims) + the seed heightfield. */
export function getHydrologyResult(map: GameMap): HydrologyResult {
  const k = key(map);
  const hit = cache.get(k);
  if (hit) return hit;

  const elevation = getHeightfield(
    map.seed, map.width, map.height,
    styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed),
  );
  // moisture/temperature are unread by generateHydrology; allocate zero-length-safe.
  const fields: TerrainField = {
    elevation,
    moisture: new Float32Array(elevation.length),
    temperature: new Float32Array(elevation.length),
  };
  // Match map-generator: the STYLED river threshold (area-scaled ÷ riverDensity — omitting
  // it diverged rendered water from the tiles whenever riverDensity ≠ 1), world sea level,
  // and the SAME volcano scorch mask (dry craters) — else the rendered water diverges from
  // the tiles (a phantom caldera lake over dry volcanic_rock).
  const scorchMask = buildVolcanoScorchMask(
    map.worldSeed?.pois, map.width, map.height, elevation, ELEVATION_SEA_LEVEL,
    worldStyleOf(map.worldSeed ?? undefined).mountainRelief);
  const res = generateHydrology(fields, {
    seed: map.seed, width: map.width, height: map.height, seaLevel: ELEVATION_SEA_LEVEL,
  }, { scorchMask, riverFlowThreshold: styledRiverFlowThreshold(map.worldSeed, map.width, map.height) });

  cache.set(k, res);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return res;
}

/** Drop the memoised hydrology (tests; harmless in prod). */
export function clearHydrologyCache(): void {
  cache.clear();
}
