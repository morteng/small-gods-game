import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed } from '@/core/types';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { buildWaterField, computeShoreDist, fillShoreRing, floodDilateLakes, LAKE_FLOOD_RINGS, packWaterGlobals, WATER_GLOBALS_FLOATS } from '@/render/gpu/water-field';
import { terrainGrid } from '@/render/gpu/terrain-field';
import { packTerrainGlobals, type TerrainGlobalsInput } from '@/render/gpu/instance-buffer';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { clearHydrologyCache } from '@/world/hydrology-store';
import { worldStyleOf } from '@/core/world-style';

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

  it('encodes the inland water-level offset (drought/flood) into uWater.w (normalised)', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const relief = worldStyleOf(map.worldSeed).mountainRelief;
    const flood = buildWaterField(map, { ...opts, waterLevelM: 3 })!;
    const drought = buildWaterField(map, { ...opts, waterLevelM: -2 })!;
    const none = buildWaterField(map, opts)!;
    expect(none.globals[27]).toBe(0);                         // default = no offset
    expect(flood.globals[27]).toBeCloseTo(3 / relief, 6);     // flood raises
    expect(drought.globals[27]).toBeCloseTo(-2 / relief, 6);  // drought lowers
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

  it('shore distance is 0 on land everywhere when the map is bone dry', () => {
    const W = 4, H = 3;
    const mask = new Uint8Array(W * H); // all 0 = all land
    const d = computeShoreDist(W, H, mask);
    expect(Array.from(d)).toEqual(new Array(W * H).fill(0));
  });

  it('shore distance grows offshore as 8-neighbour (Chebyshev) rings from land', () => {
    // 5×5 all water except a single land cell at the centre (2,2). 8-neighbour
    // BFS from land ⇒ Chebyshev distance: the ring around the cell is 1, corners 2.
    const W = 5, H = 5;
    const mask = new Uint8Array(W * H).fill(1);
    const land = 2 * W + 2;
    mask[land] = 0;
    const d = computeShoreDist(W, H, mask);
    const at = (x: number, y: number) => d[y * W + x];
    expect(at(2, 2)).toBe(0);          // land source
    expect(at(2, 1)).toBe(1);          // orthogonal neighbour
    expect(at(1, 1)).toBe(1);          // diagonal neighbour
    expect(at(0, 0)).toBe(2);          // far corner = Chebyshev(2,2)
    expect(at(4, 2)).toBe(2);          // two tiles east
  });

  it('shore distance off a straight coast is the column offset', () => {
    // Left two columns land, right three water (W=5). Each water column's distance
    // is its horizontal offset from the coast: col2→1, col3→2, col4→3.
    const W = 5, H = 3;
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 2; x < W; x++) mask[y * W + x] = 1;
    const d = computeShoreDist(W, H, mask);
    for (let y = 0; y < H; y++) {
      expect(d[y * W + 0]).toBe(0); // land
      expect(d[y * W + 1]).toBe(0); // land
      expect(d[y * W + 2]).toBe(1); // first wet column
      expect(d[y * W + 3]).toBe(2);
      expect(d[y * W + 4]).toBe(3);
    }
  });

  it('fillShoreRing overhangs the bank by one cell on every side (pixel-perfect waterline)', () => {
    // 5×5: a 3×3 water pond at the centre (cols/rows 1..3), land rim. The single
    // wet cell is the centre (2,2)'s ring; verify a dry cell that orthogonally OR
    // diagonally touches water inherits the water plane, and a far corner stays dry.
    const W = 5, H = 5;
    const mask = new Uint8Array(W * H);
    // One wet cell at (2,2).
    const wet = 2 * W + 2;
    mask[wet] = 1;
    const f = {
      surfaceW: new Float32Array(W * H).fill(-1),
      waterType: new Uint32Array(W * H), // 0 = Dry
      shallow: new Uint32Array(W * H),
      deep: new Uint32Array(W * H),
      clarity: new Float32Array(W * H),
      flow: new Float32Array(W * H * 2),
    };
    // Seed the lone wet cell with a recognisable signature.
    f.surfaceW[wet] = 0.35;
    f.waterType[wet] = WaterType.Lake;
    f.shallow[wet] = 0xaabbccdd;
    f.deep[wet] = 0x11223344;
    f.clarity[wet] = 0.8;
    f.flow[wet * 2] = 0.5;
    f.flow[wet * 2 + 1] = -0.25;

    fillShoreRing(W, H, mask, f);

    const at = (x: number, y: number) => y * W + x;
    // All 8 neighbours of the wet cell inherit the full water signature.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const i = at(2 + dx, 2 + dy);
        expect(f.surfaceW[i], `(${2 + dx},${2 + dy}) surface`).toBeCloseTo(0.35, 6);
        expect(f.waterType[i]).toBe(WaterType.Lake);
        expect(f.shallow[i]).toBe(0xaabbccdd);
        expect(f.deep[i]).toBe(0x11223344);
        expect(f.clarity[i]).toBeCloseTo(0.8, 6);
        expect(f.flow[i * 2]).toBeCloseTo(0.5, 6);
        expect(f.flow[i * 2 + 1]).toBeCloseTo(-0.25, 6);
      }
    }
    // A cell two tiles away (no water neighbour) stays bone dry — the ring does not chain.
    expect(f.surfaceW[at(0, 0)]).toBe(-1);
    expect(f.waterType[at(0, 0)]).toBe(WaterType.Dry);
    // The original wet cell is untouched.
    expect(f.surfaceW[wet]).toBeCloseTo(0.35, 6);
  });

  it('floodDilateLakes extends a LAKE plane outward by N rings (flood headroom)', () => {
    // 9×1 strip, a single lake cell at the centre (index 4). With 3 rings the lake
    // plane spreads to cells 1..7; cells 0 and 8 (ring 4) stay bone dry. The cells
    // carry the lake's surface + biome so a flood can later climb them.
    const W = 9, H = 1;
    const f = {
      surfaceW: new Float32Array(W * H).fill(-1),
      waterType: new Uint32Array(W * H), // 0 = Dry
      shallow: new Uint32Array(W * H),
      deep: new Uint32Array(W * H),
      clarity: new Float32Array(W * H),
      flow: new Float32Array(W * H * 2),
    };
    f.surfaceW[4] = 0.4; f.waterType[4] = WaterType.Lake;
    f.shallow[4] = 0x1234; f.deep[4] = 0x5678; f.clarity[4] = 0.6;

    floodDilateLakes(W, H, 3, f);

    for (let x = 1; x <= 7; x++) {
      expect(f.waterType[x], `cell ${x} type`).toBe(WaterType.Lake);
      expect(f.surfaceW[x], `cell ${x} surface`).toBeCloseTo(0.4, 6);
      expect(f.shallow[x]).toBe(0x1234);
    }
    expect(f.waterType[0]).toBe(WaterType.Dry);
    expect(f.surfaceW[0]).toBe(-1);
    expect(f.waterType[8]).toBe(WaterType.Dry);
  });

  it('floodDilateLakes ignores OCEAN (the datum never floods) and occupied cells', () => {
    // A lone OCEAN cell does NOT dilate; and a pre-occupied neighbour is left as-is.
    const W = 5, H = 1;
    const f = {
      surfaceW: new Float32Array([-1, -1, 0.35, 0.42, -1]),
      waterType: new Uint32Array([WaterType.Dry, WaterType.Dry, WaterType.Ocean, WaterType.Lake, WaterType.Dry]),
      shallow: new Uint32Array(W), deep: new Uint32Array(W),
      clarity: new Float32Array(W), flow: new Float32Array(W * 2),
    };
    floodDilateLakes(W, H, 3, f);
    expect(f.waterType[2]).toBe(WaterType.Ocean);   // ocean untouched (not a seed)
    expect(f.surfaceW[2]).toBeCloseTo(0.35, 6);     // occupied cell kept its surface
    expect(f.waterType[4]).toBe(WaterType.Lake);    // lake spread to the open dry side
    expect(f.surfaceW[4]).toBeCloseTo(0.42, 6);
  });

  it('LAKE_FLOOD_RINGS is a positive headroom band', () => {
    expect(LAKE_FLOOD_RINGS).toBeGreaterThan(1);
  });

  it('fillShoreRing picks the highest adjacent surface for a dry cell between two bodies', () => {
    // Row of 3: wet(low) · dry · wet(high). The dry middle cell should take the
    // taller plane so the waterline can only over-reach (the depth clip trims it).
    const W = 3, H = 1;
    const mask = new Uint8Array([1, 0, 1]);
    const f = {
      surfaceW: new Float32Array([0.2, -1, 0.6]),
      waterType: new Uint32Array([WaterType.Lake, WaterType.Dry, WaterType.Ocean]),
      shallow: new Uint32Array([1, 0, 2]),
      deep: new Uint32Array([3, 0, 4]),
      clarity: new Float32Array([0.1, 0, 0.9]),
      flow: new Float32Array([0, 0, 0, 0, 0, 0]),
    };
    fillShoreRing(W, H, mask, f);
    expect(f.surfaceW[1]).toBeCloseTo(0.6, 6);     // took the higher (ocean) surface
    expect(f.waterType[1]).toBe(WaterType.Ocean);
    expect(f.shallow[1]).toBe(2);
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
