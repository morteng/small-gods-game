import { describe, it, expect, beforeEach } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type GameMap, type HydrologyResult, type WorldSeed } from '@/core/types';
import { buildRiverDeformations, clearRiverDeformationCache } from '@/world/river-deformation';
import { getHydrologyResult, clearHydrologyCache } from '@/world/hydrology-store';
import { getWorldDeformationStore, clearRoadDeformationCache } from '@/world/road-deformation';
import { baseHeightAt, heightAt as composedHeightAt } from '@/world/terrain-deformation';

const noPoiSeed: WorldSeed = {
  name: 'test', size: { width: 64, height: 64 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

/** A minimal hydrology model: a 3×1 strip — two river cells then dry land. */
function stubHydro(): HydrologyResult {
  const n = 3;
  const z = () => new Float32Array(n);
  return {
    riverMask: new Uint8Array([1, 1, 0]),
    flowField: z(),
    drainTo: new Int32Array([1, -1, -1]),
    surfaceW: z(),
    waterMask: new Uint8Array([1, 1, 0]),
    waterType: new Uint8Array([WaterType.River, WaterType.River, WaterType.Dry]),
    flowDirX: z(), flowDirY: z(),
    strahler: new Uint8Array([1, 2, 0]),
    width: new Float32Array([0.5, 1.0, 0]),
  };
}

describe('Water S1 — river carve + fill', () => {
  beforeEach(() => {
    clearHydrologyCache();
    clearRiverDeformationCache();
    clearRoadDeformationCache();
  });

  it('carves along the reach centreline — one brook reach over the 2-cell channel', () => {
    const map = { width: 3, height: 1 } as GameMap;
    const defs = buildRiverDeformations(map, stubHydro());
    // The two river cells form ONE reach (spring→mouth); short channels carve as a
    // single bounded brush rather than one staircase step per cell.
    expect(defs.length).toBe(1);
    expect(defs.every((d) => d.source === 'river:incision' && d.op === 'carve')).toBe(true);
    // A zero-flow headwater channel classifies as a brook → the shallow base depth.
    expect(defs[0].amount).toBeCloseTo(1.0, 5);
  });

  it('exposes a unified water model on a generated world (rivers + some still water)', async () => {
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const hydro = getHydrologyResult(map);
    const count = (t: WaterType) => hydro.waterType.reduce((s, v) => s + (v === t ? 1 : 0), 0);
    expect(count(WaterType.River)).toBeGreaterThan(0);
    let wet = 0; for (const m of hydro.waterMask) wet += m;
    expect(wet).toBeGreaterThan(0);
  });

  it('carves the channel: a river cell sits below its base terrain in the composed field', async () => {
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const hydro = getHydrologyResult(map);
    const store = getWorldDeformationStore(map);
    // Find a river cell and check the carve lowered it.
    let carved = 0, checked = 0;
    for (let i = 0; i < hydro.waterType.length && checked < 40; i++) {
      if (hydro.waterType[i] !== WaterType.River) continue;
      const x = i % 64, y = (i / 64) | 0;
      const base = baseHeightAt(map, x, y);
      const composed = composedHeightAt(map, store, x, y);
      checked++;
      if (composed < base - 0.1) carved++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(carved).toBeGreaterThan(0); // at least some river cells are visibly incised
  });

  it('the merged world store contains river:incision deformations', async () => {
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const store = getWorldDeformationStore(map);
    // Sample the store at a known river cell; it must report a river carve there.
    const hydro = getHydrologyResult(map);
    const i = hydro.waterType.indexOf(WaterType.River);
    expect(i).toBeGreaterThanOrEqual(0);
    const defs = store.at(i % 64, (i / 64) | 0);
    expect(defs.some((d) => d.source === 'river:incision')).toBe(true);
  });

  it('is deterministic — recomputed hydrology arrays are identical', async () => {
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const a = getHydrologyResult(map);
    clearHydrologyCache();
    const b = getHydrologyResult(map);
    expect(Array.from(b.waterType)).toEqual(Array.from(a.waterType));
    expect(Array.from(b.surfaceW)).toEqual(Array.from(a.surfaceW));
  });
});
