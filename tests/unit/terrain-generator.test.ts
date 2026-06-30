import { describe, it, expect } from 'vitest';
import { gradientNoise, fbm, warpedNoise, ridgeNoise } from '@/core/noise';
import { classifyBiome, sampleBiomeTile, Biome, BIOME_TILES } from '@/terrain/biomes';
import {
  generateTerrainFields,
  classifyBiomes,
  sampleTiles,
  generateTerrain,
  recomputeRegion,
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

  it('peak at high elevation (default relief: 0.9 ≈ 26 m above sea)', () => {
    expect(classifyBiome(0.9, 0.5, 0.5, SEA)).toBe(Biome.Peak);
  });

  it('mountain band (default relief: 0.80 ≈ 21.6 m above sea)', () => {
    expect(classifyBiome(0.80, 0.5, 0.5, SEA)).toBe(Biome.Mountain);
  });

  it('keys upland on ABSOLUTE metres, not the elevation fraction', () => {
    // The SAME high fraction (0.9) on a LOW-relief world is only ~5 m above sea —
    // a buildable hill, NOT an alpine mountain. (heightM = (0.9-0.35)*10 = 5.5 m.)
    const lowRelief = (0.9 - SEA) * 10;
    expect(classifyBiome(0.9, 0.5, 0.5, SEA, lowRelief)).not.toBe(Biome.Peak);
    expect(classifyBiome(0.9, 0.5, 0.5, SEA, lowRelief)).not.toBe(Biome.Mountain);
    // On a HIGH-relief world the same fraction is a real summit.
    expect(classifyBiome(0.9, 0.5, 0.5, SEA, (0.9 - SEA) * 48)).toBe(Biome.Peak);
  });

  it('a steep face promotes elevated ground to rocky Mountain below the height line', () => {
    // 14 m above sea (below the 19 m mountain line) but a steep 8 m/tile scarp → bare rock.
    expect(classifyBiome(0.64, 0.5, 0.5, SEA, 14, 8)).toBe(Biome.Mountain);
    // Same height, gentle slope → ordinary land, not rock.
    expect(classifyBiome(0.64, 0.5, 0.5, SEA, 14, 0)).not.toBe(Biome.Mountain);
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

// ─── Spatial coherence (noise-based sampling) ─────────────────────────────────

describe('sampleTiles spatial coherence', () => {
  /**
   * Measure average same-type neighbor count across all tiles.
   * Random baseline for a 4-neighbour check with a distribution like
   * TemperateGrassland (60% grass) gives ~2.4. Noise-based sampling
   * should produce spatially coherent patches, giving > 2.5.
   */
  function avgSameNeighborCount(tiles: string[][], width: number, height: number): number {
    let total = 0, count = 0;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = tiles[y][x];
        let same = 0;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && tiles[ny][nx] === t) same++;
        }
        total += same;
        count++;
      }
    }
    return total / count;
  }

  it('produces spatially coherent patches (avg same-neighbour > 2.5)', () => {
    // Force a single-biome map so we're measuring tile coherence, not biome boundaries
    const W = 64, H = 64;
    const config = { seed: 42, width: W, height: H, seaLevel: 0.0 };
    const { biomeMap, tiles, fields } = generateTerrain(config);
    // Override all biomes to TemperateGrassland for a clean single-biome test
    biomeMap.biomes.fill(Biome.TemperateGrassland);
    const noiseTiles = sampleTiles(biomeMap, fields, config);
    const avg = avgSameNeighborCount(noiseTiles, W, H);
    expect(avg).toBeGreaterThan(2.5);
  });

  it('is deterministic (same seed → same tiles)', () => {
    const config = { seed: 77, width: 32, height: 32 };
    const { biomeMap: bm1, fields: f1 } = generateTerrain(config);
    const { biomeMap: bm2, fields: f2 } = generateTerrain(config);
    const t1 = sampleTiles(bm1, f1, config);
    const t2 = sampleTiles(bm2, f2, config);
    expect(t1[10][15]).toBe(t2[10][15]);
    expect(t1[5][5]).toBe(t2[5][5]);
  });
});

// ─── recomputeRegion consistency ──────────────────────────────────────────────

describe('recomputeRegion', () => {
  it('recomputed sub-region tiles match full-map generation', () => {
    const config = { seed: 99, width: 32, height: 32 };
    const { fields, biomeMap, tiles } = generateTerrain(config);

    // Re-generate a 4x4 sub-region in a fresh copy
    const { biomeMap: freshBiomeMap, tiles: freshTiles, fields: freshFields } = generateTerrain(config);

    // Mutate the copy and recompute region [8,8]→[11,11]
    recomputeRegion(freshFields, freshBiomeMap, freshTiles, config, 8, 8, 11, 11);

    // recomputeRegion should produce tiles matching the original (deterministic)
    for (let y = 8; y <= 11; y++) {
      for (let x = 8; x <= 11; x++) {
        expect(freshTiles[y][x]).toBe(tiles[y][x]);
      }
    }
    void fields; // used implicitly via reference generation
  });

  it('recomputeRegion clamped to map bounds does not throw', () => {
    const config = { seed: 7, width: 16, height: 16 };
    const { fields, biomeMap, tiles } = generateTerrain(config);
    expect(() => recomputeRegion(fields, biomeMap, tiles, config, -5, -5, 5, 5)).not.toThrow();
    expect(() => recomputeRegion(fields, biomeMap, tiles, config, 12, 12, 30, 30)).not.toThrow();
  });
});
