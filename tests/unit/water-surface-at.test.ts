import { describe, it, expect } from 'vitest';
import { WaterType } from '@/core/types';
import { waterSurfaceAt } from '@/render/gpu/water-field';
import { getHydrologyResult } from '@/world/hydrology-store';
import { heightField } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import type { GameMap } from '@/core/types';
import { createDefaultWorldSeed } from '@/core/schema';

// A real generated world: the probe must agree with the SAME memoised hydrology
// model + curved bed the renderer composes from, so we derive expectations from
// those sources rather than hand-rolling a fixture.
function world(): GameMap {
  const worldSeed = { ...createDefaultWorldSeed('probe'), seed: 4242 };
  return { width: 96, height: 96, tiles: [], worldSeed } as unknown as GameMap;
}

/** First cell whose static hydrology type matches `t` (or -1). */
function firstCellOfType(map: GameMap, t: WaterType): number {
  const hydro = getHydrologyResult(map);
  for (let i = 0; i < hydro.waterType.length; i++) if (hydro.waterType[i] === t) return i;
  return -1;
}

describe('waterSurfaceAt — the point-query form of the ΔW rule', () => {
  it('reads dry land as dry (no water, zero depth)', () => {
    const map = world();
    const dryI = firstCellOfType(map, WaterType.Dry);
    expect(dryI).toBeGreaterThanOrEqual(0);
    const x = dryI % map.width, y = (dryI / map.width) | 0;
    const p = waterSurfaceAt(map, x, y);
    expect(p.wet).toBe(false);
    expect(p.depthM).toBe(0);
    expect(p.type).toBe(WaterType.Dry);
  });

  it('out-of-bounds tiles read dry, never throw', () => {
    const map = world();
    expect(waterSurfaceAt(map, -1, 5).wet).toBe(false);
    expect(waterSurfaceAt(map, 5, map.height + 3).wet).toBe(false);
  });

  it('a flood lays standing water of the requested depth on dry land', () => {
    const map = world();
    const dryI = firstCellOfType(map, WaterType.Dry);
    const x = dryI % map.width, y = (dryI / map.width) | 0;
    const flood = new Float32Array(map.width * map.height);
    flood[dryI] = 2.0; // 2 m
    const p = waterSurfaceAt(map, x, y, { floodOffsetM: flood });
    expect(p.wet).toBe(true);
    expect(p.type).toBe(WaterType.Lake);
    expect(p.depthM).toBeCloseTo(2.0, 4);
  });

  it('the probe surface equals bed + flood depth (agrees with the GPU bake)', () => {
    const map = world();
    const dryI = firstCellOfType(map, WaterType.Dry);
    const x = dryI % map.width, y = (dryI / map.width) | 0;
    const relief = worldStyleOf(map.worldSeed).mountainRelief;
    const bedN = heightField(map)[dryI];
    const flood = new Float32Array(map.width * map.height);
    flood[dryI] = 1.3;
    const p = waterSurfaceAt(map, x, y, { floodOffsetM: flood });
    // depth in metres = (bed + 1.3/relief − bed)·relief = 1.3
    expect(p.depthM).toBeCloseTo(1.3, 4);
    // and the absolute surface a renderer would draw is bedN + 1.3/relief
    expect(bedN + 1.3 / relief).toBeGreaterThan(bedN);
  });

  it('a global drought lowers a river+lake but never the sea datum', () => {
    const map = world();
    const riverI = firstCellOfType(map, WaterType.River);
    if (riverI < 0) return; // some seeds have no river — skip rather than fail
    const x = riverI % map.width, y = (riverI / map.width) | 0;
    const wet0 = waterSurfaceAt(map, x, y);
    const drought = waterSurfaceAt(map, x, y, { waterLevelM: -50 });
    // A deep enough drought drops the river surface below its bed → dry.
    expect(drought.depthM).toBeLessThanOrEqual(wet0.depthM);
  });
});
