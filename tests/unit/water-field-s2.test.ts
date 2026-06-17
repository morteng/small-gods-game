import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed } from '@/core/types';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { buildWaterField, packWaterGlobals, WATER_GLOBALS_FLOATS } from '@/render/gpu/water-field';
import { terrainGrid } from '@/render/gpu/terrain-field';
import { packTerrainGlobals, type TerrainGlobalsInput } from '@/render/gpu/instance-buffer';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { clearHydrologyCache } from '@/world/hydrology-store';

const noPoiSeed: WorldSeed = {
  name: 'test', size: { width: 64, height: 64 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};
const opts = {
  viewport: [800, 600] as [number, number],
  xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
  lighting: DEFAULT_LIGHTING,
  timeSec: 2.5,
};

describe('Water S2 — water field builder', () => {
  it('assembles per-cell surface/type/flow buffers sized to the map + LOD grid', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const wf = buildWaterField(map, opts);
    expect(wf).not.toBeNull();
    const cells = 64 * 64;
    expect(wf!.surfaceW.length).toBe(cells);
    expect(wf!.waterType.length).toBe(cells);
    expect(wf!.flow.length).toBe(cells * 2);
    expect(wf!.wetCount).toBeGreaterThan(0);
    expect(wf!.vertexCount).toBe(terrainGrid(64, 64).vertexCount);
    expect(wf!.globals.length).toBe(WATER_GLOBALS_FLOATS); // 28
  });

  it('ocean cells carry the sea-level surface; dry land carries the −1 sentinel', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const wf = buildWaterField(map, opts)!;
    const ocean = wf.waterType.indexOf(WaterType.Ocean);
    const dry = wf.waterType.indexOf(WaterType.Dry);
    if (ocean >= 0) expect(wf.surfaceW[ocean]).toBeCloseTo(ELEVATION_SEA_LEVEL, 5);
    if (dry >= 0) expect(wf.surfaceW[dry]).toBe(-1);
  });

  it('packs WGlobals as terrain globals (24) + uWater (4)', () => {
    const tg: TerrainGlobalsInput = {
      viewport: [800, 600], xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
      grid: [64, 64], half: [16, 8], zPxPerM: 14, seaLevel: 0.35, reliefM: 48, subsample: 1,
      sunDir: [-1, 1.6, -1], bands: 4, ambient: [0.7, 0.7, 0.74], sunStrength: 0.4,
    };
    const packed = packWaterGlobals(tg, [2.5, 1.5, 0.4, 0]);
    expect(packed.length).toBe(28);
    expect(Array.from(packed.subarray(0, 24))).toEqual(Array.from(packTerrainGlobals(tg)));
    // uWater (Float32-rounded): time, shallowBand, foamBand, flags
    expect(packed[24]).toBe(2.5);
    expect(packed[25]).toBe(1.5);
    expect(packed[26]).toBeCloseTo(0.4, 6);
    expect(packed[27]).toBe(0);
  });

  it('is deterministic — same world ⇒ identical surface/type/flow', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const a = buildWaterField(map, opts)!;
    const b = buildWaterField(map, opts)!;
    expect(Array.from(b.surfaceW)).toEqual(Array.from(a.surfaceW));
    expect(Array.from(b.waterType)).toEqual(Array.from(a.waterType));
    expect(Array.from(b.flow)).toEqual(Array.from(a.flow));
  });
});
