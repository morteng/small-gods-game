/**
 * Climate zones — the per-world temperature/moisture gradient.
 *
 * The terrain temperature field is a latitude band (north cold → south warm)
 * plus an east/west lean and an elevation lapse. A *climate* picks WHERE that
 * band sits: a `european` world spans a temperate range (cool-but-not-frozen
 * north coast, mild south, snow only on the peaks), an `arctic` world sits the
 * whole band down in the snow, a `tropical` one up in the heat.
 *
 * This is the GLOBAL backdrop only. Local cold/heat is the POI layer's job:
 * a `glacier`/`mountain`/`volcano` POI applies a temperature delta on top of
 * the climate-shaped base (`POI_INFLUENCES` in `poi-influence.ts`), so the
 * world-author / Fate agent can drop an ice field or a volcano anywhere
 * regardless of the zone.
 *
 * Mirrors the `island-mask.ts` pattern: a spec, named presets, a `resolve…`
 * coercion, a `…Signature` for cache keys, and a `styledClimate(worldSeed)`
 * that reads the seed. Worldgen and the render heightfield BOTH resolve through
 * here so their temperature/moisture fields stay identical (parity-critical).
 */

/** The shape of a climate gradient. All temperatures are in the biome [0,1] scale
 *  (0 = frozen, ~0.30 = snowline, ~0.80 = desert-hot). */
export interface ClimateSpec {
  /** Temperature at the NORTH (cold) edge of the map. */
  tempNorth: number;
  /** Temperature at the SOUTH (warm) edge of the map. */
  tempSouth: number;
  /** East-warm lean: added at the east edge, subtracted at the west (±half). */
  eastWarmLean: number;
  /** West-wet lean for moisture: west edge wetter, east drier (±half). */
  westWetLean: number;
  /** Temperature drop per unit of elevation ABOVE SEA LEVEL (snowy peaks; lowland
   *  near the coast barely cools, so the band sets the valley temperature). */
  elevationLapse: number;
  /** Flat moisture bias added to the fBm base (wetter climates higher). */
  moistureBias: number;
}

export type ClimateName =
  | 'european'
  | 'temperate'
  | 'boreal'
  | 'arctic'
  | 'mediterranean'
  | 'tropical'
  | 'arid';

/**
 * Named climate zones. `european` is the DEFAULT — a central-European /
 * English / French temperate band: cool green north, mild south, snow reserved
 * for the high peaks via the elevation lapse (the Alps look: white tops, green
 * valleys). `temperate` is an alias for it.
 */
export const CLIMATE_PRESETS: Record<ClimateName, ClimateSpec> = {
  // Temperate lowlands (north 0.42 → south 0.58, both in the 0.35–0.60 temperate
  // biome band → forest/grassland, never tundra or desert) with a steep lapse
  // (0.85/unit-above-sea) that snow-caps the peaks at every latitude — green
  // valleys, white tops (the alpine look). moistureBias stays 0: the green comes
  // from the band + coastal bonus, and a blanket add tips ground into swamp.
  european:      { tempNorth: 0.45, tempSouth: 0.60, eastWarmLean: 0.05, westWetLean: 0.12, elevationLapse: 0.85, moistureBias: 0.00 },
  temperate:     { tempNorth: 0.45, tempSouth: 0.60, eastWarmLean: 0.05, westWetLean: 0.12, elevationLapse: 0.85, moistureBias: 0.00 },
  // Taiga / Scandinavia: snowy north, cool south, damp.
  boreal:        { tempNorth: 0.10, tempSouth: 0.38, eastWarmLean: 0.04, westWetLean: 0.12, elevationLapse: 0.70, moistureBias: 0.05 },
  // Frozen the whole way down — the band sits below the snowline.
  arctic:        { tempNorth: 0.02, tempSouth: 0.22, eastWarmLean: 0.03, westWetLean: 0.10, elevationLapse: 0.50, moistureBias: 0.00 },
  // Warm, dry, summer-bleached south; still snow-caps the high peaks.
  mediterranean: { tempNorth: 0.50, tempSouth: 0.72, eastWarmLean: 0.06, westWetLean: 0.10, elevationLapse: 0.85, moistureBias: -0.08 },
  // Hot and wet everywhere; little N–S spread, only the highest peaks snow.
  tropical:      { tempNorth: 0.72, tempSouth: 0.95, eastWarmLean: 0.04, westWetLean: 0.05, elevationLapse: 0.90, moistureBias: 0.20 },
  // Hot and parched — pushes the desert biome (temp > 0.80) across the south.
  arid:          { tempNorth: 0.62, tempSouth: 0.90, eastWarmLean: 0.06, westWetLean: 0.08, elevationLapse: 0.80, moistureBias: -0.35 },
};

/** Every named climate zone — the agent/authoring vocabulary (enum source). */
export const CLIMATE_NAMES = Object.keys(CLIMATE_PRESETS) as ClimateName[];

/** The default climate when a world doesn't specify one. */
export const DEFAULT_CLIMATE: ClimateSpec = CLIMATE_PRESETS.european;

/** Whether a string is a known climate-preset name. */
export function isClimateName(s: unknown): s is ClimateName {
  return typeof s === 'string' && s in CLIMATE_PRESETS;
}

/** Coerce a name / partial spec / undefined into a full {@link ClimateSpec}.
 *  Unknown names and `undefined` fall back to `european`; a partial spec is
 *  filled from the european defaults. */
export function resolveClimate(
  climate?: ClimateName | Partial<ClimateSpec> | null,
): ClimateSpec {
  if (climate == null) return DEFAULT_CLIMATE;
  if (typeof climate === 'string') {
    return CLIMATE_PRESETS[climate] ?? DEFAULT_CLIMATE;
  }
  return { ...DEFAULT_CLIMATE, ...climate };
}

/** Stable cache-key fragment for a resolved climate (parity with island sig). */
export function climateSignature(c: ClimateSpec): string {
  return `c${c.tempNorth},${c.tempSouth},${c.eastWarmLean},${c.westWetLean},${c.elevationLapse},${c.moistureBias}`;
}

/** Resolve the climate for a world seed (reads `worldSeed.climate`). */
export function styledClimate(worldSeed: { climate?: ClimateName | Partial<ClimateSpec> } | null | undefined): ClimateSpec {
  return resolveClimate(worldSeed?.climate ?? null);
}
