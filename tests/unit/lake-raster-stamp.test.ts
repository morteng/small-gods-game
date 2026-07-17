import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { getHydrologyResult } from '@/world/hydrology-store';
import { WaterType } from '@/core/types';
import type { WorldSeed } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';

// WCV 103: hydrology LAKES stamp into the tile raster. A lake is a filled basin
// ABOVE sea level, so the elevation-classified tile under one used to say
// grass/forest/mountain — every consumer gating on `tile.type` (brushes, building
// placer, road walker, pathfinding) then treated the lake bed as dry buildable land
// while the renderer painted standing water over it. The stamp closes that split:
// every cell the hydrology model calls Lake must carry a water tile type, except
// where a LATER pass legitimately re-typed it (a road carving `bridge`/dirt over
// the water — those tiles carry `baseType`, the carve's provenance marker).
//
// `getHydrologyResult` is the render path's own recompute (hydrology-store), so this
// asserts the raster against the SAME water model the shader paints from.

const SEEDS = [1, 999]; // 29 / 112 lake cells at 96×96 (probed 2026-07-17)

function worldSeed(): WorldSeed {
  return {
    name: 'lake-raster-stamp-test', size: { width: 96, height: 96 }, biome: 'temperate',
    pois: [], connections: [], constraints: [],
  };
}

describe('lake raster stamp (WCV 103)', () => {
  it.each(SEEDS)('seed %i: every hydrology Lake cell is water-typed (or road-carved) and unwalkable', async (seed) => {
    const { map } = await generateWithNoise(96, 96, seed, worldSeed());
    const hy = getHydrologyResult(map);
    let lakeCells = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (hy.waterType[y * map.width + x] !== WaterType.Lake) continue;
        lakeCells++;
        const t = map.tiles[y][x];
        const carvedOver = t.baseType != null || t.type === 'bridge';
        if (carvedOver) continue; // a road legitimately crossed the water here
        expect(WATER_TYPES.has(t.type), `(${x},${y}) type=${t.type}`).toBe(true);
        expect(t.walkable, `(${x},${y}) walkable`).toBe(false);
      }
    }
    // The invariant is vacuous on a lakeless world — pin that these seeds have lakes,
    // so a hydrology change that drains them fails loudly instead of passing silently.
    expect(lakeCells).toBeGreaterThan(0);
  });
});
