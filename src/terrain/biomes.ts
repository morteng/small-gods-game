/**
 * Biome classification — Whittaker-style diagram mapped onto
 * elevation × temperature × moisture.
 *
 * Elevation thresholds are applied first (ocean, beach, mountain, peak),
 * then the temperature × moisture grid determines land biomes.
 */

export enum Biome {
  DeepOcean          = 'deep_ocean',
  Ocean              = 'ocean',
  Beach              = 'beach',
  Mountain           = 'mountain',
  Peak               = 'peak',
  // Coastal (the shoreline band, sub-typed by how steeply the land meets the sea)
  Cliff              = 'cliff',        // steep rock plunging to the water — a headland
  RockyShore         = 'rocky_shore',  // a boulder/shingle strand below sloping ground
  // Cold
  Ice                = 'ice',
  Tundra             = 'tundra',
  BorealForest       = 'boreal_forest',
  // Temperate
  TemperateGrassland = 'temperate_grassland',
  TemperateForest    = 'temperate_forest',
  Scrubland          = 'scrubland',
  // Warm / subtropical
  TropicalGrassland  = 'tropical_grassland',
  Savanna            = 'savanna',
  TropicalForest     = 'tropical_forest',
  // Hot / arid
  Desert             = 'desert',
  // Wet / lowland
  Swamp              = 'swamp',
  // Special
  SacredGrove        = 'sacred_grove',
}

/**
 * Weighted tile distributions per biome.
 * Values are relative weights; they do not need to sum to 1.
 */
export const BIOME_TILES: Record<Biome, Record<string, number>> = {
  [Biome.DeepOcean]:          { deep_water: 1.0 },
  [Biome.Ocean]:              { shallow_water: 0.4, deep_water: 0.6 },
  [Biome.Beach]:              { sand: 0.7, grass: 0.2, dirt: 0.1 },
  [Biome.Cliff]:              { rocky: 0.7, mountain: 0.2, sand: 0.1 },
  [Biome.RockyShore]:         { rocky: 0.5, sand: 0.3, dirt: 0.2 },
  [Biome.Mountain]:           { mountain: 0.5, rocky: 0.3, hills: 0.2 },
  [Biome.Peak]:               { mountain: 0.8, rocky: 0.2 },
  [Biome.Ice]:                { mountain: 0.5, rocky: 0.3, grass: 0.2 },
  [Biome.Tundra]:             { rocky: 0.4, grass: 0.3, hills: 0.2, mountain: 0.1 },
  [Biome.BorealForest]:       { pine_forest: 0.5, forest: 0.2, grass: 0.2, rocky: 0.1 },
  [Biome.TemperateGrassland]: { grass: 0.5, meadow: 0.2, hills: 0.18, dirt: 0.07, scrubland: 0.05 },
  [Biome.TemperateForest]:    { forest: 0.4, dense_forest: 0.2, pine_forest: 0.15, glen: 0.1, grass: 0.15 },
  [Biome.Scrubland]:          { scrubland: 0.5, grass: 0.3, dirt: 0.2 },
  [Biome.TropicalGrassland]:  { grass: 0.6, scrubland: 0.2, dirt: 0.2 },
  [Biome.Savanna]:            { grass: 0.5, scrubland: 0.3, dirt: 0.2 },
  [Biome.TropicalForest]:     { forest: 0.35, dense_forest: 0.35, grass: 0.3 },
  [Biome.Desert]:             { sand: 0.5, scrubland: 0.2, rocky: 0.15, dirt: 0.15 },
  [Biome.Swamp]:              { swamp: 0.4, shallow_water: 0.3, grass: 0.2, dirt: 0.1 },
  [Biome.SacredGrove]:        { sacred_grove: 0.5, forest: 0.3, grass: 0.2 },
};

/**
 * Default total relief (metres) for the elevation `0→1` span. Mirrors
 * `TERRAIN_RELIEF_M` in `src/world/heightfield.ts` — duplicated as a plain
 * constant here only to break an import cycle (heightfield → terrain-generator →
 * biomes). Used as the metre fallback when a caller passes no absolute height.
 */
const DEFAULT_RELIEF_M = 48;

/**
 * Upland is keyed on ABSOLUTE altitude (metres above sea) and STEEPNESS — not a
 * fraction of the local relief. A fraction made a 6 m hill on a low-relief world
 * read as an alpine mountain (grey rock + a shader snow cap) exactly like a real
 * 25 m summit; metres fix that. Calibrated so a DEFAULT-relief (48 m) world keeps
 * its old mountain/peak extent (old frac 0.76 ≈ 19.7 m, 0.86 ≈ 24.5 m).
 */
export const MOUNTAIN_HEIGHT_M = 19;  // ≥ m above sea → upland (rocky/mountain ground)
export const PEAK_HEIGHT_M     = 24;  // ≥ m above sea → bare summit
/** A face this steep (m of rise per tile) can't hold soil → bare rock; promotes
 *  high-ish ground to Mountain even below the height line (canyon walls, scarps). */
export const ROCK_SLOPE_M      = 6;
/**
 * COAST sub-typing by how steeply the land meets the sea (m of rise per tile at
 * the waterline). A flat strand is a sandy Beach; where the ground tilts up it
 * becomes a boulder/shingle RockyShore; a steep face plunging to the water is a
 * Cliff. Thresholds are deliberately modest so even a low-relief island gets some
 * rocky headlands among its bays — a genuinely mountainous coast (slope many
 * m/tile) reads as continuous Cliff. Tuned against the demo island's coastal-slope
 * spread (median ≈0.56, p90 ≈1.0, p99 ≈1.5 m/tile): ~75% beach / ~18% rocky / ~7%
 * cliff there, scaling to mostly-cliff where mountains drop into the sea. */
export const CLIFF_SLOPE_M = 1.2;   // ≥ → a rock cliff headland
export const SHORE_SLOPE_M = 0.8;   // ≥ → a rocky/shingle shore

/**
 * Classify a tile into a biome given its field values.
 *
 * @param elevation  [0, 1] — 0 = sea floor, 1 = highest peak
 * @param moisture   [0, 1] — 0 = desert dry, 1 = rain forest wet
 * @param temperature [0, 1] — 0 = polar, 1 = equatorial
 * @param seaLevel   elevation threshold below which ocean tiles appear
 * @param heightM    absolute metres above sea (style-scaled). Defaults to the
 *                   default-relief conversion of `elevation` for legacy callers.
 * @param slopeM     local gradient magnitude in metres of rise per tile (0 if unknown)
 */
export function classifyBiome(
  elevation: number,
  moisture: number,
  temperature: number,
  seaLevel: number,
  heightM: number = (elevation - seaLevel) * DEFAULT_RELIEF_M,
  slopeM: number = 0,
): Biome {
  // Water first — sea level lives in the normalised field, so this stays a fraction.
  if (elevation < seaLevel * 0.6) return Biome.DeepOcean;
  if (elevation < seaLevel)       return Biome.Ocean;
  // The shoreline band, sub-typed by how steeply the land rises from the water:
  // a flat strand is a sandy Beach, a tilted one a RockyShore, a steep face a Cliff.
  // slopeM defaults to 0 (legacy callers) → every coast stays Beach, unchanged.
  if (elevation < seaLevel + 0.04) {
    if (slopeM >= CLIFF_SLOPE_M) return Biome.Cliff;
    if (slopeM >= SHORE_SLOPE_M) return Biome.RockyShore;
    return Biome.Beach;
  }

  // Upland by ABSOLUTE altitude + steepness. A steep face promotes to Mountain
  // once it's at least half-way to the height line, so river banks and gentle
  // lowland undulation stay green while real scarps go rocky.
  const steep = slopeM >= ROCK_SLOPE_M && heightM >= MOUNTAIN_HEIGHT_M * 0.5;
  if (heightM >= PEAK_HEIGHT_M)               return Biome.Peak;
  if (heightM >= MOUNTAIN_HEIGHT_M || steep)  return Biome.Mountain;

  // Whittaker: temperature × moisture. Ice keys on real altitude (metres), not a
  // fraction, so only genuine cold high ground freezes.
  if (temperature < 0.15) {
    return heightM >= MOUNTAIN_HEIGHT_M * 0.6 ? Biome.Ice : Biome.Tundra;
  }
  if (temperature < 0.35) {
    return moisture > 0.4 ? Biome.BorealForest : Biome.Tundra;
  }
  if (temperature < 0.6) {
    if (moisture > 0.55) return Biome.TemperateForest;
    if (moisture > 0.2)  return Biome.TemperateGrassland;
    return Biome.Scrubland;
  }
  if (temperature < 0.8) {
    if (moisture > 0.65) return Biome.TropicalForest;
    if (moisture > 0.45) return Biome.Savanna;
    if (moisture > 0.2)  return Biome.TropicalGrassland;
    return Biome.Scrubland;
  }
  // Hot
  if (moisture > 0.70) return Biome.Swamp;
  if (moisture > 0.50) return Biome.TropicalForest;
  if (moisture > 0.25) return Biome.Savanna;
  return Biome.Desert;
}

/**
 * Sample a tile type from a biome's weighted distribution.
 * @param rngValue  a uniform random value in [0, 1)
 */
export function sampleBiomeTile(biome: Biome, rngValue: number): string {
  const dist = BIOME_TILES[biome] ?? BIOME_TILES[Biome.TemperateGrassland];
  let total = 0;
  for (const w of Object.values(dist)) total += w;
  let threshold = rngValue * total;
  for (const [tile, weight] of Object.entries(dist)) {
    threshold -= weight;
    if (threshold <= 0) return tile;
  }
  return Object.keys(dist)[0];
}
