/**
 * Terrain Generator
 *
 * Noise fields → biome classification → tile sampling.
 *
 * The canonical flow:
 *   generateTerrainFields(config) → TerrainField
 *   classifyBiomes(fields, config) → BiomeMap
 *   sampleTiles(biomeMap, fields, config) → string[][]
 *
 * Or use the convenience wrapper generateTerrain() for all three steps.
 *
 * Noise fields are Float32Arrays sized [width * height] in row-major order
 * (index = y * width + x).
 *
 * Performance target: 256×256 map in <200ms.
 */

import { fbm, warpedNoise, ridgeNoise } from '@/core/noise';
import type { TerrainConfig, TerrainField, BiomeMap } from '@/core/types';
import { classifyBiome, sampleBiomeTile, Biome } from './biomes';
import { shapeCoastElevation } from './island-mask';
import { applyTerrainShape } from './terrain-shape';
import { resolveClimate } from './climate';

// ── Elevation shaping tunables (see generateTerrainFields) ──────────────────────
/** Weight of the warped continental base (raised from 0.7 to absorb the removed
 *  flat ridge term, so lowland area/coastlines are unchanged). */
const BASE_WEIGHT = 0.9;
/** Peak height ridges ADD inside a fully-masked mountain zone. */
const RIDGE_WEIGHT = 0.55;
/** Low-freq zone-noise band over which mountains fade in (below LO: none). */
const MOUNTAIN_ZONE_LO = 0.52;
const MOUNTAIN_ZONE_HI = 0.80;

/** Hermite smoothstep, clamped to [0,1]. */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export type { TerrainConfig, TerrainField, BiomeMap };
export { Biome };

/**
 * Build the per-cell BASE elevation sampler (pre-erosion, pre-POI) as a pure
 * function of CONTINUOUS tile coordinates. This is the exact elevation math the
 * `generateTerrainFields` loop runs per integer cell, lifted out so it can be
 * evaluated at FRACTIONAL coords — the basis for genuine sub-tile detail (the
 * noise is analytic, so half-tile samples reveal real high-frequency relief that
 * bilinear upsampling of the coarse field cannot). The worldgen loop calls this
 * at integer coords, so the field stays byte-identical.
 */
export function makeBaseElevationSampler(
  config: TerrainConfig,
): (x: number, y: number) => number {
  const {
    seed, width, height,
    elevationScale = 0.02, continentWarp = 2.0, island, shape,
  } = config;
  return (x: number, y: number): number => {
    const baseElev = continentWarp > 0
      ? warpedNoise(x * elevationScale, y * elevationScale, seed, continentWarp)
      : fbm(x * elevationScale, y * elevationScale, { seed, octaves: 6 });
    const ridges = ridgeNoise(x * elevationScale * 1.5, y * elevationScale * 1.5, seed + 999, 5);
    const zone   = fbm(x * elevationScale * 0.6, y * elevationScale * 0.6, { seed: seed + 777, octaves: 2 });
    const mountainMask = smoothstep01(MOUNTAIN_ZONE_LO, MOUNTAIN_ZONE_HI, zone);
    let elev = baseElev * BASE_WEIGHT + ridges * RIDGE_WEIGHT * mountainMask;
    if (island) {
      elev = shapeCoastElevation(elev, x, y, width, height, island, seed);
    }
    // Authored landform (studio scenarios) laid LAST, over coast/noise — a deliberate
    // vale/knoll/plain. Absent ⇒ untouched, so live worlds stay byte-identical.
    if (shape) {
      elev = applyTerrainShape(elev, x, y, width, height, shape, seed);
    }
    return Math.max(0, Math.min(1, elev));
  };
}

/**
 * Generate the three noise fields (elevation, moisture, temperature).
 *
 * Temperature model (latitude band set by the world's CLIMATE — north cold,
 * south warm):
 *   baseTemp(y) = mix(climate.tempNorth, climate.tempSouth, y/(height−1))
 *   + a gentle east-warm lean (climate.eastWarmLean)
 *   − climate.elevationLapse · elevation   (snowy peaks)
 *   + noise jitter.
 *   The climate (default `european`, a temperate band) decides WHERE the band
 *   sits; local cold/heat is the POI layer (glacier/mountain/volcano deltas).
 *
 * Moisture model:
 *   fBm base + climate.moistureBias + a west-wet lean (prevailing-wind rain
 *   shadow: west wetter, east drier) + water-proximity bonus (after elevation).
 */
export function generateTerrainFields(config: TerrainConfig): TerrainField {
  const {
    seed,
    width,
    height,
    moistureScale  = 0.03,
    seaLevel       = 0.35,
    poleFalloff    = true,
  } = config;
  // elevationScale / continentWarp / island are consumed by the base-elevation
  // sampler (makeBaseElevationSampler), which owns the elevation math now.
  const climate = resolveClimate(config.climate);

  const size = width * height;
  const elevation    = new Float32Array(size);
  const moisture     = new Float32Array(size);
  const temperature  = new Float32Array(size);

  // Elevation: warped continental base, with sharp ridges GATED behind a
  // low-frequency "mountain zone" mask so peaks form RANGES in a few places
  // instead of blobbing isotropically everywhere (research: libnoise ridged
  // multifractal + Red Blob ridge gating). The base weight is raised to 0.9 to
  // compensate for the removed flat ridge term, so lowland area/coastlines stay
  // put; ridges only ADD inside mountain zones. Island shaping (C0 coast/relief
  // seam) swells the interior + sinks the edges. Lifted into one continuous-coord
  // sampler so sub-tile detail can re-evaluate it (see makeBaseElevationSampler).
  const sampleBaseElev = makeBaseElevationSampler(config);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      elevation[idx] = sampleBaseElev(x, y);

      // East/west lean (−0.5 west … +0.5 east): a roughly continental feel —
      // west wetter, east drier + a touch warmer.
      const ew = width > 1 ? x / (width - 1) - 0.5 : 0;

      // Moisture: base fBm + climate bias − west-wet lean (water proximity below).
      moisture[idx] = fbm(x * moistureScale, y * moistureScale, { seed: seed + 500, octaves: 5 })
        + climate.moistureBias - ew * climate.westWetLean;

      // Temperature: latitude band (climate.tempNorth → tempSouth, south=warm) +
      // east-warm lean − elevation lapse + noise jitter. poleFalloff off → the
      // band's midpoint everywhere (no N–S gradient). The lapse is on elevation
      // ABOVE SEA LEVEL so lowlands keep their latitude temperature (a near-sea
      // tile barely cools) and only real high ground ices — snow-capped peaks at
      // any latitude, green valleys below.
      const south    = poleFalloff ? (height > 1 ? y / (height - 1) : 0.5) : 0.5;
      const lat      = climate.tempNorth + (climate.tempSouth - climate.tempNorth) * south;
      const aboveSea = Math.max(0, elevation[idx] - seaLevel);
      const jitter   = fbm(x * 0.02, y * 0.02, { seed: seed + 1500, octaves: 3 }) * 0.15 - 0.075;
      temperature[idx] = Math.max(0, Math.min(1,
        lat + ew * climate.eastWarmLean - climate.elevationLapse * aboveSea + jitter));
    }
  }

  // Water-proximity moisture bonus (within 15 tiles of sea/ocean)
  const bonus = computeWaterProximity(elevation, width, height, seaLevel, 15);
  for (let i = 0; i < size; i++) {
    moisture[i] = Math.max(0, Math.min(1, moisture[i] + bonus[i] * 0.3));
  }

  return { elevation, moisture, temperature };
}

/** Compute [0,1] proximity bonus for each land tile based on distance to water. */
function computeWaterProximity(
  elevation: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  radius: number,
): Float32Array {
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elevation[idx] < seaLevel) continue;       // water tile — no bonus needed
      let minDist = radius + 1;
      const yr0 = Math.max(0, y - radius), yr1 = Math.min(height - 1, y + radius);
      const xr0 = Math.max(0, x - radius), xr1 = Math.min(width  - 1, x + radius);
      outer: for (let ny = yr0; ny <= yr1; ny++) {
        for (let nx = xr0; nx <= xr1; nx++) {
          if (elevation[ny * width + nx] < seaLevel) {
            const d = Math.sqrt((nx - x) ** 2 + (ny - y) ** 2);
            if (d < minDist) { minDist = d; if (minDist === 0) break outer; }
          }
        }
      }
      if (minDist <= radius) result[idx] = 1 - minDist / radius;
    }
  }
  return result;
}

/** Default total relief (metres) for elevation 0→1 — mirrors TERRAIN_RELIEF_M. */
const DEFAULT_RELIEF_M = 48;

/**
 * Absolute metres above sea + local slope (metres of rise per tile), the two
 * physical quantities biome classification needs so snow/rock key on real
 * altitude/steepness instead of a fraction of the local relief. Central
 * differences on the elevation field, clamped at the edges.
 */
export function siteMetrics(
  elevation: ArrayLike<number>, x: number, y: number, width: number, height: number,
  seaLevel: number, reliefM: number,
): { heightM: number; slopeM: number } {
  const idx = y * width + x;
  const e = elevation[idx];
  const xm = x > 0 ? elevation[idx - 1] : e;
  const xp = x < width - 1 ? elevation[idx + 1] : e;
  const ym = y > 0 ? elevation[idx - width] : e;
  const yp = y < height - 1 ? elevation[idx + width] : e;
  const gx = (xp - xm) * 0.5;   // elevation fraction per tile (x)
  const gy = (yp - ym) * 0.5;   // elevation fraction per tile (y)
  return {
    heightM: (e - seaLevel) * reliefM,
    slopeM: Math.hypot(gx, gy) * reliefM,
  };
}

/** Classify every tile into a Biome using the three field values. */
export function classifyBiomes(fields: TerrainField, config: TerrainConfig): BiomeMap {
  const { width, height, seaLevel = 0.35, reliefM = DEFAULT_RELIEF_M } = config;
  const biomes: string[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const { heightM, slopeM } = siteMetrics(fields.elevation, x, y, width, height, seaLevel, reliefM);
      biomes[i] = classifyBiome(
        fields.elevation[i],
        fields.moisture[i],
        fields.temperature[i],
        seaLevel,
        heightM,
        slopeM,
      );
    }
  }
  return { biomes, width, height };
}

/** Abramowitz & Stegun 7.1.26 error-function approximation (|err| ≤ 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Flatten the tile-selection noise to a UNIFORM [0,1] value.
 *
 * `sampleBiomeTile` walks a CDF and so assumes a uniform input — but the source
 * is `fbm(…, octaves:3)`, which is NOT uniform: summing octaves gives a roughly
 * Gaussian spread (measured: μ≈0.500, σ≈0.085, range ≈[0.16,0.84], ~74% of values
 * inside [0.4,0.6]). Fed raw, only the FIRST distribution band (and a sliver of
 * the second) ever wins — every later tile starves far below its nominal weight
 * (e.g. a `glen: 0.1` clearing rendered at ~0.01%), so BIOME_TILES weights were
 * NOT honoured as fractions; entry ORDER decided everything.
 *
 * Φ — the Gaussian CDF with that σ — is the exact inverse-transform that maps the
 * fbm spread back to uniform, so the weights become real area fractions. The remap
 * is MONOTONIC, so it preserves the noise's spatial coherence (neighbouring cells
 * keep their relative ordering → tile variants still cluster into patches rather
 * than salt-and-pepper); only the value HISTOGRAM is flattened.
 */
const FBM3_MEAN = 0.5;
const FBM3_STD = 0.085;
export function uniformizeTileNoise(noiseValue: number): number {
  // Φ(z) = ½(1 + erf(z/√2)), z = standardised fbm value.
  const z = (noiseValue - FBM3_MEAN) / FBM3_STD;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Sample a tile type from a biome's distribution using a spatially-coherent
 * noise value instead of a random value. The fbm noise is uniformised first
 * (see `uniformizeTileNoise`) so the CDF walk honours BIOME_TILES weights as
 * true area fractions while keeping tile variants spatially clustered.
 */
export function sampleTileFromNoise(biome: Biome, noiseValue: number): string {
  return sampleBiomeTile(biome, uniformizeTileNoise(noiseValue));
}

/** Sample a tile type string for every cell from its biome's distribution. */
export function sampleTiles(
  biomeMap: BiomeMap,
  fields: TerrainField,
  config: TerrainConfig,
): string[][] {
  const { width, height, seed } = config;
  const detailSeed = (seed * 9973 + 7919) | 0;
  const tiles: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const biome = biomeMap.biomes[y * width + x] as Biome;
      const noiseValue = fbm(x * 0.15, y * 0.15, { seed: detailSeed, octaves: 3 });
      row.push(sampleTileFromNoise(biome, noiseValue));
    }
    tiles.push(row);
  }
  void fields; // fields reserved for future per-tile moisture/elevation overrides
  return tiles;
}

/**
 * Convenience wrapper: runs all three generation steps.
 */
export function generateTerrain(config: TerrainConfig): {
  fields:   TerrainField;
  biomeMap: BiomeMap;
  tiles:    string[][];
} {
  const fields   = generateTerrainFields(config);
  const biomeMap = classifyBiomes(fields, config);
  const tiles    = sampleTiles(biomeMap, fields, config);
  return { fields, biomeMap, tiles };
}

/**
 * Recompute a rectangular sub-region after a change (POI move, etc.).
 * Returns updated biomeMap and tile samples for the affected cells.
 *
 * @param x0, y0, x1, y1  inclusive region bounds (clamped to map)
 */
export function recomputeRegion(
  fields:    TerrainField,
  biomeMap:  BiomeMap,
  tiles:     string[][],
  config:    TerrainConfig,
  x0: number, y0: number, x1: number, y1: number,
): void {
  const { width, height, seaLevel = 0.35, reliefM = DEFAULT_RELIEF_M, seed } = config;
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
  const cx1 = Math.min(width - 1, x1), cy1 = Math.min(height - 1, y1);
  const detailSeed = (seed * 9973 + 7919) | 0;

  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const idx = y * width + x;
      const { heightM, slopeM } = siteMetrics(fields.elevation, x, y, width, height, seaLevel, reliefM);
      const biome = classifyBiome(
        fields.elevation[idx],
        fields.moisture[idx],
        fields.temperature[idx],
        seaLevel,
        heightM,
        slopeM,
      ) as Biome;
      biomeMap.biomes[idx] = biome;
      const noiseValue = fbm(x * 0.15, y * 0.15, { seed: detailSeed, octaves: 3 });
      tiles[y][x] = sampleTileFromNoise(biome, noiseValue);
    }
  }
}
