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
    // WET-CELL MESH: one quad (6 verts) per water-or-river-band lattice cell — so the draw
    // is a SUBSET of the dense whole-map grid, and wetCells holds exactly one packed entry
    // per quad. (Was: the full dense grid, with dry quads collapsed to degenerate triangles.)
    expect(wf!.vertexCount).toBeGreaterThan(0);
    expect(wf!.vertexCount % 6).toBe(0);
    expect(wf!.vertexCount).toBeLessThanOrEqual(terrainGrid(64, 64).vertexCount);
    expect(wf!.wetCells.length).toBe(wf!.vertexCount / 6);
    expect(wf!.globals.length).toBe(WATER_GLOBALS_FLOATS); // 36 (TGlobals 24 + uWater 4 + uChannel 4 + uWindow 4)
  });

  it('culls the water mesh to the viewport window (fewer quads than the whole map)', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    const full = buildWaterField(map, opts)!;
    // A 16×12-tile window (sub=1 on a 64² map): at most 16·12 quads, and — being a sub-
    // region — strictly fewer wet quads than the whole map.
    const win = buildWaterField(map, { ...opts, window: { minTx: 0, minTy: 0, maxTx: 15, maxTy: 11 } })!;
    expect(win.vertexCount).toBeLessThanOrEqual(16 * 12 * 6);   // sparse ≤ dense window
    expect(win.vertexCount).toBeLessThan(full.vertexCount);     // window is a strict sub-region
    // The window still rides into uWindow (origin 0,0 + the snapped 16×12 cell span) — it
    // drives the CPU cull that scopes which wet cells are emitted.
    expect(Array.from(win.globals.subarray(32, 36))).toEqual([0, 0, 16, 12]);
  });

  it('memoises the packed wet-cell list — same window ⇒ same reference; changed window/flood ⇒ re-pack', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    // Stationary camera (same coarsened window twice): the SAME subarray view comes
    // back — no CPU re-pack, and the stable reference is what lets the GPU upload
    // guard (gpu-scene.uploadWaterFields) skip the per-frame writeBuffer.
    const a = buildWaterField(map, opts)!;
    const b = buildWaterField(map, opts)!;
    expect(b.wetCells).toBe(a.wetCells);
    expect(a.wetCells.length).toBeGreaterThan(0);
    // Moved window: the signature changes ⇒ a fresh pack (new view, windowed subset).
    const win = { minTx: 0, minTy: 0, maxTx: 15, maxTy: 11 };
    const c = buildWaterField(map, { ...opts, window: win })!;
    expect(c.wetCells).not.toBe(a.wetCells);
    expect(c.wetCells.length).toBeLessThan(a.wetCells.length);
    // Snapshot NOW — later re-packs reuse the same underlying buffer (views are
    // consumed/uploaded the same frame they're built, so aliasing is by design).
    const cContent = Array.from(c.wetCells);
    // …and holding THAT window memoises again.
    const c2 = buildWaterField(map, { ...opts, window: win })!;
    expect(c2.wetCells).toBe(c.wetCells);
    // An active FLOOD flips the pack to the dense window fallback (arbitrary land can
    // be wet), so the signature MUST include it — same window, different list.
    const flood = new Float32Array(64 * 64);
    flood[32 * 64 + 32] = 1.5;
    const f = buildWaterField(map, { ...opts, window: win, floodOffsetM: flood })!;
    expect(f.wetCells).not.toBe(c.wetCells);
    expect(f.wetCells.length).toBe(16 * 12);  // dense: every quad in the 16×12 window
    // Receding fully re-packs back to the sparse set (content parity with pre-flood).
    const g = buildWaterField(map, { ...opts, window: win })!;
    expect(Array.from(g.wetCells)).toEqual(cContent);
  });

  it('the water draw count is SUP-FREE — superSample never multiplies it (water never subdivides)', async () => {
    clearHydrologyCache();
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    // The water shader lays one quad per coarsened tile (no sub-tile subdivision), so a
    // superSample of 2 must NOT change the draw count the way it does for terrain.
    const s1 = buildWaterField(map, { ...opts, superSample: 1 })!;
    const s2 = buildWaterField(map, { ...opts, superSample: 2 })!;
    expect(s2.vertexCount).toBe(s1.vertexCount);
    // Sparse: the count is the wet-cell quads, a strict subset of the dense whole-map grid.
    expect(s1.vertexCount).toBeGreaterThan(0);
    expect(s1.vertexCount).toBeLessThan(64 * 64 * 6);
    // (terrain, by contrast, DOES subdivide: its grid quadruples under superSample 2.)
    expect(terrainGrid(64, 64, undefined, 2).vertexCount).toBe(terrainGrid(64, 64, undefined, 1).vertexCount * 4);
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

  it('packs WGlobals as terrain globals (24) + uWater (4) + uChannel (4) + uWindow (4)', () => {
    const tg: TerrainGlobalsInput = {
      viewport: [800, 600], xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
      grid: [64, 64], half: [16, 8], zPxPerM: 14, seaLevel: 0.35, reliefM: 48, subsample: 1,
      sunDir: [-1, 1.6, -1], bands: 4, ambient: [0.7, 0.7, 0.74], sunStrength: 0.4,
    };
    const packed = packWaterGlobals(tg, [2.5, 1.5, 0.4, 0]);
    expect(packed.length).toBe(36);
    expect(Array.from(packed.subarray(0, 24))).toEqual(Array.from(packTerrainGlobals(tg)));
    // uWater (Float32-rounded): time, shallowBand, foamBand, flags
    expect(packed[24]).toBe(2.5);
    expect(packed[25]).toBe(1.5);
    expect(packed[26]).toBeCloseTo(0.4, 6);
    expect(packed[27]).toBe(0);
    // uChannel defaults to a no-river [1,1,1,0] when omitted (shader skips on segCount 0).
    expect(Array.from(packed.subarray(28, 32))).toEqual([1, 1, 1, 0]);
    // uWindow defaults to the WHOLE map (0,0,W,H) when omitted → the vertex shader draws
    // every tile, byte-identical to the pre-cull grid.
    expect(Array.from(packed.subarray(32, 36))).toEqual([0, 0, 64, 64]);
    // …and carries the channel grid dims + an explicit cull window when supplied.
    const withCh = packWaterGlobals(tg, [0, 0, 0, 0], [8, 12, 9, 240], [10, 20, 16, 12]);
    expect(Array.from(withCh.subarray(28, 32))).toEqual([8, 12, 9, 240]);
    expect(Array.from(withCh.subarray(32, 36))).toEqual([10, 20, 16, 12]);
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

    // Banks that all stand at/above the 0.35 pond plane (a normal basin) — every
    // shore neighbour is a real bank, so the full 8-ring overhang is kept.
    fillShoreRing(W, H, mask, new Float32Array(W * H).fill(0.5), f);

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

  it('fillShoreRing does NOT overhang the DOWN-slope corners of a perched crater pond', () => {
    // A summit pond at the centre of a 5×5: the 8 ring cells around it are the bank.
    // The orthogonal rim cells RISE above the 0.68 plane (real banks, kept), but the
    // four DIAGONAL corners DESCEND below it (the outer flank of a crater rim). An
    // ungated 8-ring sprays the plane onto those corners; the depth clip can't trim a
    // flank that genuinely sits below the surface, so water drapes as radial petals
    // down the cone. The bed gate must drop exactly those corners. (The volcano bug.)
    const W = 5, H = 5;
    const mask = new Uint8Array(W * H);
    const wet = 2 * W + 2;
    mask[wet] = 1;
    const f = {
      surfaceW: new Float32Array(W * H).fill(-1),
      waterType: new Uint32Array(W * H),
      shallow: new Uint32Array(W * H),
      deep: new Uint32Array(W * H),
      clarity: new Float32Array(W * H),
      flow: new Float32Array(W * H * 2),
    };
    f.surfaceW[wet] = 0.68; f.waterType[wet] = WaterType.Lake;
    f.shallow[wet] = 0x1234; f.deep[wet] = 0x5678; f.clarity[wet] = 0.6;
    // Bed: orthogonal rim 0.74 (above the plane → kept), diagonal corners 0.60 (below
    // the plane → the down-slope flank → must be dropped). Centre well below (a basin).
    const bed = new Float32Array(W * H).fill(0.5);
    const at = (x: number, y: number) => y * W + x;
    bed[at(2, 1)] = 0.74; bed[at(1, 2)] = 0.74; bed[at(3, 2)] = 0.74; bed[at(2, 3)] = 0.74;
    bed[at(1, 1)] = 0.60; bed[at(3, 1)] = 0.60; bed[at(1, 3)] = 0.60; bed[at(3, 3)] = 0.60;

    fillShoreRing(W, H, mask, bed, f);

    // Orthogonal rim banks (≥ plane) are overhung — the waterline AA is preserved.
    for (const [x, y] of [[2, 1], [1, 2], [3, 2], [2, 3]]) {
      expect(f.surfaceW[at(x, y)], `rim (${x},${y})`).toBeCloseTo(0.68, 6);
      expect(f.waterType[at(x, y)]).toBe(WaterType.Lake);
    }
    // Diagonal corners (< plane, down-slope) are left bone dry — no petals.
    for (const [x, y] of [[1, 1], [3, 1], [1, 3], [3, 3]]) {
      expect(f.surfaceW[at(x, y)], `corner (${x},${y}) dry`).toBe(-1);
      expect(f.waterType[at(x, y)]).toBe(WaterType.Dry);
    }
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

    // Dry banks standing above the 0.4 lake plane — a rising flood would climb them.
    const bed = new Float32Array(W * H).fill(0.5);
    floodDilateLakes(W, H, 3, bed, f);

    for (let x = 1; x <= 7; x++) {
      expect(f.waterType[x], `cell ${x} type`).toBe(WaterType.Lake);
      expect(f.surfaceW[x], `cell ${x} surface`).toBeCloseTo(0.4, 6);
      expect(f.shallow[x]).toBe(0x1234);
    }
    expect(f.waterType[0]).toBe(WaterType.Dry);
    expect(f.surfaceW[0]).toBe(-1);
    expect(f.waterType[8]).toBe(WaterType.Dry);
  });

  it('floodDilateLakes does NOT spill a perched crater lake DOWN its outer flanks', () => {
    // A peak with a tiny summit pond: bed rises to a rim (0.70) around a crater floor
    // (0.65), then DESCENDS on both flanks. The pond surface (0.68) sits above the floor
    // but below the rim. An ungated `rings`-deep dilation would leap the rim and paint
    // the lower flanks (0.6, 0.5, 0.4, 0.3 — all below 0.68) as a square apron of water,
    // because the in-shader depth clip can't trim a flank that genuinely lies below the
    // plane. The bed gate must stop the band AT the rim. (The volcano-lake square bug.)
    const W = 11, H = 1;
    const bed = new Float32Array([0.3, 0.4, 0.5, 0.6, 0.70, 0.65, 0.70, 0.6, 0.5, 0.4, 0.3]);
    const f = {
      surfaceW: new Float32Array(W * H).fill(-1),
      waterType: new Uint32Array(W * H),
      shallow: new Uint32Array(W * H),
      deep: new Uint32Array(W * H),
      clarity: new Float32Array(W * H),
      flow: new Float32Array(W * H * 2),
    };
    f.surfaceW[5] = 0.68; f.waterType[5] = WaterType.Lake;  // the crater pond
    f.shallow[5] = 0x1234; f.deep[5] = 0x5678; f.clarity[5] = 0.6;

    floodDilateLakes(W, H, 4, bed, f);

    // The rim cells (4, 6) stand at/above the plane → claimed as dry headroom (the depth
    // clip renders them dry now, floodable later).
    expect(f.waterType[4]).toBe(WaterType.Lake);
    expect(f.waterType[6]).toBe(WaterType.Lake);
    // The outer flanks lie BELOW the plane across the rim → never painted (no apron).
    for (const x of [0, 1, 2, 3, 7, 8, 9, 10]) {
      expect(f.waterType[x], `flank ${x} stays dry`).toBe(WaterType.Dry);
      expect(f.surfaceW[x], `flank ${x} surface untouched`).toBe(-1);
    }
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
    // Banks above the lake plane so the dilation has somewhere to climb.
    floodDilateLakes(W, H, 3, new Float32Array(W * H).fill(0.5), f);
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
    // The dry middle bank stands above the taller (ocean) plane, so it's kept.
    fillShoreRing(W, H, mask, new Float32Array([0.2, 0.65, 0.6]), f);
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
