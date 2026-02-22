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
  [Biome.Mountain]:           { mountain: 0.5, rocky: 0.3, hills: 0.2 },
  [Biome.Peak]:               { mountain: 0.8, rocky: 0.2 },
  [Biome.Ice]:                { mountain: 0.5, rocky: 0.3, grass: 0.2 },
  [Biome.Tundra]:             { rocky: 0.4, grass: 0.3, hills: 0.2, mountain: 0.1 },
  [Biome.BorealForest]:       { pine_forest: 0.5, forest: 0.2, grass: 0.2, rocky: 0.1 },
  [Biome.TemperateGrassland]: { grass: 0.6, hills: 0.2, dirt: 0.1, scrubland: 0.1 },
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
 * Classify a tile into a biome given its field values.
 *
 * @param elevation  [0, 1] — 0 = sea floor, 1 = highest peak
 * @param moisture   [0, 1] — 0 = desert dry, 1 = rain forest wet
 * @param temperature [0, 1] — 0 = polar, 1 = equatorial
 * @param seaLevel   elevation threshold below which ocean tiles appear
 */
export function classifyBiome(
  elevation: number,
  moisture: number,
  temperature: number,
  seaLevel: number,
): Biome {
  // Elevation-first: ocean, beach, mountain, peak
  if (elevation < seaLevel * 0.6) return Biome.DeepOcean;
  if (elevation < seaLevel)       return Biome.Ocean;
  if (elevation < seaLevel + 0.04) return Biome.Beach;
  if (elevation > 0.86)           return Biome.Peak;
  if (elevation > 0.76)           return Biome.Mountain;

  // Whittaker: temperature × moisture
  if (temperature < 0.15) {
    return elevation > 0.65 ? Biome.Ice : Biome.Tundra;
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
