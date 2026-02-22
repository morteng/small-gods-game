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

import { fbm, warpedNoise, ridgeNoise, Random } from '@/core/noise';
import type { TerrainConfig, TerrainField, BiomeMap } from '@/core/types';
import { classifyBiome, sampleBiomeTile, Biome } from './biomes';

export type { TerrainConfig, TerrainField, BiomeMap };
export { Biome };

/**
 * Generate the three noise fields (elevation, moisture, temperature).
 *
 * Temperature model:
 *   baseTemp(y) = 1.0 − |y/height − 0.5| × 2.0  (equator=1, poles=0)
 *   modified by elevation (−0.3 per unit above 0) and noise jitter.
 *
 * Moisture model:
 *   fBm base + water-proximity bonus applied after elevation is known.
 */
export function generateTerrainFields(config: TerrainConfig): TerrainField {
  const {
    seed,
    width,
    height,
    elevationScale = 0.02,
    moistureScale  = 0.03,
    seaLevel       = 0.35,
    poleFalloff    = true,
    continentWarp  = 2.0,
  } = config;

  const size = width * height;
  const elevation    = new Float32Array(size);
  const moisture     = new Float32Array(size);
  const temperature  = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Elevation: warped noise + ridge ridges blended
      const baseElev = continentWarp > 0
        ? warpedNoise(x * elevationScale, y * elevationScale, seed, continentWarp)
        : fbm(x * elevationScale, y * elevationScale, { seed, octaves: 6 });
      const ridges = ridgeNoise(x * elevationScale * 1.5, y * elevationScale * 1.5, seed + 999, 4);
      elevation[idx] = Math.max(0, Math.min(1, baseElev * 0.7 + ridges * 0.3));

      // Moisture: base fBm (water proximity applied below)
      moisture[idx] = fbm(x * moistureScale, y * moistureScale, { seed: seed + 500, octaves: 5 });

      // Temperature: latitude gradient + elevation penalty + noise jitter
      const lat    = poleFalloff ? 1.0 - Math.abs(y / height - 0.5) * 2.0 : 0.5;
      const jitter = fbm(x * 0.02, y * 0.02, { seed: seed + 1500, octaves: 3 }) * 0.15 - 0.075;
      temperature[idx] = Math.max(0, Math.min(1, lat - 0.3 * elevation[idx] + jitter));
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

/** Classify every tile into a Biome using the three field values. */
export function classifyBiomes(fields: TerrainField, config: TerrainConfig): BiomeMap {
  const { width, height, seaLevel = 0.35 } = config;
  const biomes: string[] = new Array(width * height);
  for (let i = 0; i < biomes.length; i++) {
    biomes[i] = classifyBiome(
      fields.elevation[i],
      fields.moisture[i],
      fields.temperature[i],
      seaLevel,
    );
  }
  return { biomes, width, height };
}

/** Sample a tile type string for every cell from its biome's distribution. */
export function sampleTiles(
  biomeMap: BiomeMap,
  _fields: TerrainField,
  config: TerrainConfig,
): string[][] {
  const { width, height, seed } = config;
  const rng = new Random((seed * 9973 + 7919) | 0);
  const tiles: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const biome = biomeMap.biomes[y * width + x] as Biome;
      row.push(sampleBiomeTile(biome, rng.next()));
    }
    tiles.push(row);
  }
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
  const { width, height, seaLevel = 0.35, seed } = config;
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
  const cx1 = Math.min(width - 1, x1), cy1 = Math.min(height - 1, y1);
  const rng  = new Random((seed * 9973 + 7919) | 0);

  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const idx = y * width + x;
      const biome = classifyBiome(
        fields.elevation[idx],
        fields.moisture[idx],
        fields.temperature[idx],
        seaLevel,
      ) as Biome;
      biomeMap.biomes[idx] = biome;
      tiles[y][x] = sampleBiomeTile(biome, rng.next());
    }
  }
}
