import { describe, it, expect } from 'vitest';
import type { GameMap } from '@/core/types';
import {
  snowWeight,
  mudWeight,
  terrainContextFrom,
  sampleTerrainContext,
  groundBlend,
  weatherAggression,
  SNOWLINE,
} from '@/world/terrain-context';

describe('snow / mud weights', () => {
  it('snow accumulates only below the snowline, monotonically', () => {
    expect(snowWeight(0.8)).toBe(0);                 // desert-warm: bare
    expect(snowWeight(SNOWLINE)).toBe(0);            // exactly at the line: none yet
    expect(snowWeight(0.05)).toBeGreaterThan(0);     // cold: dressed
    expect(snowWeight(0.0)).toBeGreaterThan(snowWeight(0.2)); // colder ⇒ more
    expect(snowWeight(-1)).toBeLessThanOrEqual(1);   // clamped
  });

  it('mud needs wet AND unfrozen ground', () => {
    expect(mudWeight(0.2, 0)).toBe(0);               // dry ⇒ no mud
    expect(mudWeight(0.9, 0)).toBeGreaterThan(0);    // wet + warm ⇒ muddy
    expect(mudWeight(0.9, 1)).toBe(0);               // wet but frozen ⇒ snow, not mud
    expect(mudWeight(0.9, 0)).toBeGreaterThan(mudWeight(0.7, 0)); // wetter ⇒ more
  });
});

describe('terrainContextFrom (pure core)', () => {
  it('derives consistent snow + mud from moisture/temperature', () => {
    const cold = terrainContextFrom(0.9, 0.05);
    expect(cold.snow).toBeGreaterThan(0.5);
    expect(cold.mud).toBeLessThan(0.2); // frozen ⇒ snow wins over mud
    const warmWet = terrainContextFrom(0.9, 0.7);
    expect(warmWet.snow).toBe(0);
    expect(warmWet.mud).toBeGreaterThan(0.5);
  });

  it('clamps its inputs into [0,1]', () => {
    const c = terrainContextFrom(2, -1);
    expect(c.moisture).toBe(1);
    expect(c.temperature).toBe(0);
  });
});

describe('weatherAggression', () => {
  it('a cold, wet surface weathers harder than a warm, dry one', () => {
    const harsh = weatherAggression(terrainContextFrom(0.9, 0.05));
    const mild = weatherAggression(terrainContextFrom(0.1, 0.7));
    expect(harsh).toBeGreaterThan(mild);
    expect(harsh).toBeLessThanOrEqual(1);
    expect(mild).toBeGreaterThanOrEqual(0);
  });
});

describe('groundBlend', () => {
  it('passes snow/mud through and tints harder on soft ground', () => {
    const bare = groundBlend(terrainContextFrom(0.2, 0.6));
    const muddy = groundBlend(terrainContextFrom(0.95, 0.6));
    const snowy = groundBlend(terrainContextFrom(0.2, 0.0));
    expect(muddy.mud).toBeGreaterThan(bare.mud);
    expect(snowy.snow).toBeGreaterThan(bare.snow);
    expect(muddy.biomeTint).toBeGreaterThan(bare.biomeTint);
    expect(snowy.biomeTint).toBeGreaterThan(bare.biomeTint);
  });
});

describe('sampleTerrainContext (engine-wide seam)', () => {
  function fakeMap(): GameMap {
    const width = 8, height = 8;
    const tiles = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => ({ type: 'grass', x, y })),
    );
    return {
      tiles, width, height, seed: 42, worldSeed: null,
      villages: [], success: true, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    } as unknown as GameMap;
  }

  it('is deterministic for the same world + tile', () => {
    const m = fakeMap();
    expect(sampleTerrainContext(m, 3, 4)).toEqual(sampleTerrainContext(m, 3, 4));
  });

  it('reads the under-biome from baseType when a road overwrote the tile type', () => {
    const m = fakeMap();
    expect(sampleTerrainContext(m, 2, 2).baseType).toBe('grass'); // no override ⇒ type
    (m.tiles[2][2] as { baseType?: string }).baseType = 'dirt';   // a road carved here
    expect(sampleTerrainContext(m, 2, 2).baseType).toBe('dirt');  // seam sees the ground UNDER it
  });

  it('edge-clamps out-of-bounds samples to the nearest cell', () => {
    const m = fakeMap();
    expect(sampleTerrainContext(m, -5, -5)).toEqual(sampleTerrainContext(m, 0, 0));
    expect(sampleTerrainContext(m, 999, 999)).toEqual(sampleTerrainContext(m, 7, 7));
  });

  it('returns values in range', () => {
    const m = fakeMap();
    const c = sampleTerrainContext(m, 4, 4);
    for (const v of [c.moisture, c.temperature, c.elevation, c.snow, c.mud]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
