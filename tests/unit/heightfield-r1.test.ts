import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHeightfield, getHeightfield, clearHeightfieldCache,
  elevationAt, heightMetresAt,
  TERRAIN_RELIEF_M, ELEVATION_SEA_LEVEL,
} from '@/world/heightfield';
import { generateTerrainFields } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import type { GameMap, TerrainConfig } from '@/core/types';

const mapOf = (seed: number, width = 48, height = 48): GameMap =>
  ({ seed, width, height } as unknown as GameMap);

describe('R1 — world heightfield', () => {
  beforeEach(() => clearHeightfieldCache());

  it('is seed-deterministic: same (seed,dims) → identical field', () => {
    const a = computeHeightfield(123, 48, 48);
    const b = computeHeightfield(123, 48, 48);
    expect(a.length).toBe(48 * 48);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('different seeds → different fields', () => {
    const a = computeHeightfield(1, 48, 48);
    const b = computeHeightfield(2, 48, 48);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('values stay in the normalised [0,1] elevation range', () => {
    const hf = computeHeightfield(7, 48, 48);
    for (const v of hf) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('reproduces the worldgen field exactly (generateTerrainFields → erodeElevation, same config)', () => {
    // Mirror map-generator's TerrainConfig derivation for (seed=99, 64×64).
    const seed = 99, width = 64, height = 64, maxDim = 64;
    const cfg: TerrainConfig = {
      seed, width, height,
      elevationScale: 6.0 / maxDim, moistureScale: 8.0 / maxDim,
      seaLevel: 0.35, poleFalloff: true, continentWarp: 2.0,
    };
    const expected = erodeElevation(generateTerrainFields(cfg).elevation, width, height, { seed });
    const actual = computeHeightfield(seed, width, height);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('getHeightfield memoises (returns the same instance) and is read-stable', () => {
    const first = getHeightfield(5, 32, 32);
    const second = getHeightfield(5, 32, 32);
    expect(second).toBe(first); // identity, not just equality
  });

  it('caps the cache so repeated worlds cannot grow it unbounded', () => {
    // CACHE_CAP is 4; touch 6 distinct worlds, then the first must have evicted.
    const a = getHeightfield(1000, 32, 32);
    for (const s of [1001, 1002, 1003, 1004, 1005]) getHeightfield(s, 32, 32);
    const aAgain = getHeightfield(1000, 32, 32);
    expect(aAgain).not.toBe(a); // recomputed → evicted earlier
  });

  it('heightMetresAt reports metres relative to the waterline', () => {
    const map = mapOf(42);
    const e = elevationAt(map, 10, 10);
    const m = heightMetresAt(map, 10, 10);
    expect(m).toBeCloseTo((e - ELEVATION_SEA_LEVEL) * TERRAIN_RELIEF_M, 5);
    // a tile exactly at sea level would be 0 m; the sign tracks above/below.
    expect(Math.sign(m)).toBe(Math.sign(e - ELEVATION_SEA_LEVEL));
  });

  it('edge-clamps out-of-bounds tile coords instead of reading NaN', () => {
    const map = mapOf(42, 48, 48);
    expect(Number.isFinite(elevationAt(map, -5, -5))).toBe(true);
    expect(elevationAt(map, -5, -5)).toBe(elevationAt(map, 0, 0));
    expect(elevationAt(map, 999, 999)).toBe(elevationAt(map, 47, 47));
  });

  it('the field is not flat (relief actually varies across the map)', () => {
    const hf = computeHeightfield(3, 48, 48);
    const min = Math.min(...hf), max = Math.max(...hf);
    expect(max - min).toBeGreaterThan(0.1);
  });
});
