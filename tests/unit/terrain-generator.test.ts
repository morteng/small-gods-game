import { describe, it, expect } from 'vitest';
import { gradientNoise, fbm, warpedNoise, ridgeNoise } from '@/core/noise';
import { classifyBiome, sampleBiomeTile, Biome, BIOME_TILES } from '@/terrain/biomes';
import {
  generateTerrainFields,
  classifyBiomes,
  sampleTiles,
  generateTerrain,
} from '@/terrain/terrain-generator';

// ─── Noise tests ──────────────────────────────────────────────────────────────

describe('gradientNoise', () => {
  it('returns value in [0, 1]', () => {
    for (let i = 0; i < 100; i++) {
      const v = gradientNoise(i * 1.3, i * 0.7, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(gradientNoise(3.5, 7.2, 999)).toBe(gradientNoise(3.5, 7.2, 999));
  });

  it('differs across seeds', () => {
    // Avoid integer lattice points (always 0.5 in gradient noise)
    expect(gradientNoise(5.3, 5.7, 1)).not.toBe(gradientNoise(5.3, 5.7, 2));
  });
});

describe('fbm', () => {
  it('returns value in [0, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const v = fbm(i * 2.1, i * 1.7, { seed: 42, octaves: 6, scale: 0.02 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const a = fbm(10, 20, { seed: 77, octaves: 4, scale: 0.03 });
    const b = fbm(10, 20, { seed: 77, octaves: 4, scale: 0.03 });
    expect(a).toBe(b);
  });
});

describe('warpedNoise', () => {
  it('returns value in [0, 1]', () => {
    for (let i = 0; i < 30; i++) {
      const v = warpedNoise(i * 5, i * 3, 12345);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('is deterministic', () => {
    expect(warpedNoise(100, 200, 42)).toBe(warpedNoise(100, 200, 42));
  });
});

describe('ridgeNoise', () => {
  it('returns value in [0, 1]', () => {
    for (let i = 0; i < 30; i++) {
      const v = ridgeNoise(i * 1.1, i * 0.9, 7777);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('is deterministic', () => {
    expect(ridgeNoise(50, 50, 42)).toBe(ridgeNoise(50, 50, 42));
  });
});

// ─── Biome classification ─────────────────────────────────────────────────────

describe('classifyBiome', () => {
  const SEA = 0.35;

  it('deep ocean when elevation < 0.6 * seaLevel', () => {
    expect(classifyBiome(0.0, 0.5, 0.5, SEA)).toBe(Biome.DeepOcean);
    expect(classifyBiome(0.2, 0.5, 0.5, SEA)).toBe(Biome.DeepOcean);
  });

  it('ocean between 0.6*seaLevel and seaLevel', () => {
    expect(classifyBiome(0.22, 0.5, 0.5, SEA)).toBe(Biome.Ocean);
  });

  it('beach just above seaLevel', () => {
    expect(classifyBiome(SEA + 0.01, 0.5, 0.5, SEA)).toBe(Biome.Beach);
  });

  it('peak at high elevation', () => {
    expect(classifyBiome(0.9, 0.5, 0.5, SEA)).toBe(Biome.Peak);
  });

  it('mountain band', () => {
    expect(classifyBiome(0.80, 0.5, 0.5, SEA)).toBe(Biome.Mountain);
  });

  it('desert: hot + dry', () => {
    expect(classifyBiome(0.5, 0.1, 0.95, SEA)).toBe(Biome.Desert);
  });

  it('tundra: cold', () => {
    expect(classifyBiome(0.5, 0.5, 0.05, SEA)).toBe(Biome.Tundra);
  });

  it('temperate forest: temperate + moist', () => {
    expect(classifyBiome(0.5, 0.7, 0.5, SEA)).toBe(Biome.TemperateForest);
  });

  it('swamp: hot + very wet', () => {
    expect(classifyBiome(0.4, 0.85, 0.9, SEA)).toBe(Biome.Swamp);
  });
});

describe('sampleBiomeTile', () => {
  it('returns a valid tile type for every biome', () => {
    for (const biome of Object.values(Biome)) {
      const tile = sampleBiomeTile(biome, 0.5);
      expect(typeof tile).toBe('string');
      expect(tile.length).toBeGreaterThan(0);
    }
  });

  it('samples from distribution boundaries correctly', () => {
    // Value 0 → first tile; value ~1 → last tile
    const biome = Biome.Desert;
    const first = sampleBiomeTile(biome, 0);
    expect(first).toBe(Object.keys(BIOME_TILES[biome])[0]);
  });
});

// ─── Terrain generation ───────────────────────────────────────────────────────

describe('generateTerrainFields', () => {
  const config = { seed: 42, width: 32, height: 32, elevationScale: 0.02 };

  it('returns Float32Arrays of correct size', () => {
    const fields = generateTerrainFields(config);
    expect(fields.elevation.length).toBe(32 * 32);
    expect(fields.moisture.length).toBe(32 * 32);
    expect(fields.temperature.length).toBe(32 * 32);
  });

  it('all values in [0, 1]', () => {
    const fields = generateTerrainFields(config);
    for (let i = 0; i < fields.elevation.length; i++) {
      expect(fields.elevation[i]).toBeGreaterThanOrEqual(0);
      expect(fields.elevation[i]).toBeLessThanOrEqual(1);
      expect(fields.moisture[i]).toBeGreaterThanOrEqual(0);
      expect(fields.moisture[i]).toBeLessThanOrEqual(1);
      expect(fields.temperature[i]).toBeGreaterThanOrEqual(0);
      expect(fields.temperature[i]).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const a = generateTerrainFields(config);
    const b = generateTerrainFields(config);
    expect(a.elevation[100]).toBe(b.elevation[100]);
    expect(a.moisture[55]).toBe(b.moisture[55]);
  });

  it('differs with different seeds', () => {
    const a = generateTerrainFields(config);
    const b = generateTerrainFields({ ...config, seed: 9999 });
    // At least some values should differ
    let differs = false;
    for (let i = 0; i < a.elevation.length; i++) {
      if (a.elevation[i] !== b.elevation[i]) { differs = true; break; }
    }
    expect(differs).toBe(true);
  });
});

describe('classifyBiomes', () => {
  it('returns BiomeMap with correct dimensions', () => {
    const config = { seed: 1, width: 16, height: 16 };
    const fields = generateTerrainFields(config);
    const bm = classifyBiomes(fields, config);
    expect(bm.biomes.length).toBe(16 * 16);
    expect(bm.width).toBe(16);
    expect(bm.height).toBe(16);
  });

  it('produces valid Biome strings', () => {
    const config = { seed: 1, width: 16, height: 16 };
    const fields = generateTerrainFields(config);
    const bm = classifyBiomes(fields, config);
    const validBiomes = new Set(Object.values(Biome));
    for (const b of bm.biomes) {
      expect(validBiomes.has(b as Biome)).toBe(true);
    }
  });
});

describe('generateTerrain', () => {
  it('produces tiles of correct dimensions', () => {
    const config = { seed: 7, width: 20, height: 15 };
    const { tiles } = generateTerrain(config);
    expect(tiles.length).toBe(15);
    expect(tiles[0].length).toBe(20);
  });

  it('all tile types are non-empty strings', () => {
    const config = { seed: 7, width: 20, height: 15 };
    const { tiles } = generateTerrain(config);
    for (const row of tiles) {
      for (const t of row) {
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic', () => {
    const config = { seed: 42, width: 32, height: 32 };
    const a = generateTerrain(config);
    const b = generateTerrain(config);
    expect(a.tiles[10][15]).toBe(b.tiles[10][15]);
    expect(a.biomeMap.biomes[200]).toBe(b.biomeMap.biomes[200]);
  });

  it('large map (256×256) completes in <5s', { timeout: 10000 }, () => {
    const config = { seed: 1234, width: 256, height: 256 };
    const t0 = Date.now();
    generateTerrain(config);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
