import { describe, it, expect } from 'vitest';
import {
  buildGrassInstances, GRASS_INSTANCE_FLOATS,
  type ClutterManifest,
} from '@/render/gpu/grass-scatter';
import type { TerrainField } from '@/render/gpu/terrain-field';
import type { TerrainGlobalsInput } from '@/render/gpu/instance-buffer';

// Shared globals for every synthetic field: ISO half-tile, modest relief, sea at 0.35
// (unless a test overrides it explicitly).
function makeGlobals(w: number, h: number, seaLevel = 0.35): TerrainGlobalsInput {
  return {
    viewport: [800, 600],
    xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
    grid: [w, h],
    half: [64, 32],
    zPxPerM: 20,
    seaLevel,
    reliefM: 48,
    subsample: 1,
    sunDir: [-1, 1.6, -1],
    bands: 4,
    ambient: [0.3, 0.3, 0.35],
    sunStrength: 1,
  };
}

/** Build a minimal synthetic TerrainField. `heightFn`/`moistureFn`/`temperatureFn`
 *  are sampled per tile (tx,ty); `colors`/`roadFeature` are unread by the scatter
 *  and filled with harmless placeholders. Temperature defaults TEMPERATE (0.5) —
 *  an all-zero field would read as arctic and the snow skip would empty it. */
function makeField(
  w: number, h: number,
  heightFn: (tx: number, ty: number) => number,
  moistureFn: (tx: number, ty: number) => number = () => 0.5,
  seaLevel = 0.35,
  temperatureFn: (tx: number, ty: number) => number = () => 0.5,
): TerrainField {
  const heights = new Float32Array(w * h);
  const moisture = new Float32Array(w * h);
  const temperature = new Float32Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      heights[i] = heightFn(tx, ty);
      moisture[i] = moistureFn(tx, ty);
      temperature[i] = temperatureFn(tx, ty);
    }
  }
  return {
    heights,
    colors: new Uint32Array(w * h),
    moisture,
    temperature,
    roadFeature: new Uint32Array(4),
    vertexCount: 0,
    globals: makeGlobals(w, h, seaLevel),
  };
}

function makeManifest(): ClutterManifest {
  return {
    cell: 32, cols: 4, rows: 2, count: 7,
    ranges: {
      grass: { start: 0, count: 2 },
      flower: { start: 2, count: 1 },
      reed: { start: 3, count: 0 },
      rock: { start: 3, count: 1 },
      seaweed: { start: 4, count: 1 },
      wrack: { start: 5, count: 1 },
      lilypad: { start: 6, count: 1 },
    },
    cats: ['grass', 'flower', 'rock', 'seaweed', 'wrack', 'lilypad'],
  };
}

/** Mirrors `cellRect` in the source (private) — used to check UV-fallback behaviour. */
function cellRect(m: ClutterManifest, layer: number): [number, number, number, number] {
  const atlasW = m.cols * m.cell, atlasH = m.rows * m.cell;
  const col = layer % m.cols, row = (layer / m.cols) | 0;
  const u0 = (col * m.cell + 0.5) / atlasW, u1 = ((col + 1) * m.cell - 0.5) / atlasW;
  const v0 = (row * m.cell + 0.5) / atlasH, v1 = ((row + 1) * m.cell - 0.5) / atlasH;
  return [u0, v0, u1, v1];
}

describe('buildGrassInstances — determinism', () => {
  it('is byte-identical across two calls on the same field object', () => {
    const field = makeField(24, 24, () => 0.6, () => 0.5);
    const manifest = makeManifest();
    const a = buildGrassInstances(field, manifest);
    const b = buildGrassInstances(field, manifest);
    expect(b.count).toBe(a.count);
    expect(b.data).toEqual(a.data);
  });

  it('is byte-identical across two INDEPENDENTLY built fields with the same values', () => {
    // Proves the hash is a pure function of (tile coord, values) — not of array identity.
    const manifest = makeManifest();
    const fieldA = makeField(24, 24, (tx, ty) => 0.4 + 0.1 * Math.sin(tx * 0.4) + 0.05 * ty, () => 0.5);
    const fieldB = makeField(24, 24, (tx, ty) => 0.4 + 0.1 * Math.sin(tx * 0.4) + 0.05 * ty, () => 0.5);
    const a = buildGrassInstances(fieldA, manifest);
    const b = buildGrassInstances(fieldB, manifest);
    expect(b.count).toBe(a.count);
    expect(b.data).toEqual(a.data);
  });
});

describe('buildGrassInstances — underwater cells are skipped', () => {
  it('emits nothing on an all-ocean field', () => {
    const field = makeField(20, 20, () => 0.1, () => 0.5, 0.35);
    const { data, count } = buildGrassInstances(field, makeManifest());
    expect(count).toBe(0);
    expect(data.length).toBe(0);
  });

  it('never emits an instance whose reconstructed tile-row is in the deep-ocean band', () => {
    // Rows 0..11 deep ocean, rows 12..23 flat land, on a 24x24 grid.
    const W = 24, H = 24, sea = 0.35;
    const field = makeField(W, H,
      (_tx, ty) => (ty < 12 ? 0.05 : 0.6),
      () => 0.2, // below the flower moisture threshold — keeps this a pure grass check
      sea);
    const { data, count, } = buildGrassInstances(field, makeManifest());
    expect(count).toBeGreaterThan(0);
    const halfW = field.globals.half[0];
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      const footX = data[o], depth = data[o + 2];
      const sum = depth * (W + H);      // fx + fy
      const diff = footX / halfW;       // fx - fy
      const fy = (sum - diff) / 2;
      // Land starts at ty=12; only assert well clear of the bilinear boundary (rows 10-11)
      // so interpolation at the ocean/land seam can't produce a false positive.
      expect(Math.floor(fy)).toBeGreaterThan(9);
    }
  });

  it('land-only density is roughly double a half-land/half-ocean field of the same size', () => {
    const W = 24, H = 24, sea = 0.35;
    const full = makeField(W, H, () => 0.6, () => 0.2, sea);
    const half = makeField(W, H, (_tx, ty) => (ty < H / 2 ? 0.05 : 0.6), () => 0.2, sea);
    const cFull = buildGrassInstances(full, makeManifest()).count;
    const cHalf = buildGrassInstances(half, makeManifest()).count;
    expect(cHalf).toBeGreaterThan(0);
    expect(cHalf).toBeLessThan(cFull);
    const ratio = cHalf / cFull;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });
});

describe('buildGrassInstances — per-instance value ranges', () => {
  it('keeps every field finite and in its documented range', () => {
    const W = 16, H = 16, sea = 0.2;
    const field = makeField(W, H,
      (tx, ty) => 0.5 + 0.3 * Math.sin(tx * 0.31) + 0.15 * Math.cos(ty * 0.23),
      (tx, ty) => 0.3 + 0.6 * ((tx + ty) % 7) / 7,
      sea);
    const { data, count } = buildGrassInstances(field, makeManifest());
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      const footX = data[o], footY = data[o + 1], depth = data[o + 2], size = data[o + 3];
      const u0 = data[o + 4], v0 = data[o + 5], u1 = data[o + 6], v1 = data[o + 7];
      const width = data[o + 8], seed = data[o + 9], cat = data[o + 10], bendK = data[o + 11];
      expect(Number.isFinite(footX)).toBe(true);
      expect(Number.isFinite(footY)).toBe(true);
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(0.999);
      expect(Number.isFinite(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect([0, 1, 2, 3, 4, 5, 6]).toContain(cat); // grass / flower / rock / reed / seaweed / wrack / lilypad
      expect(u0).toBeGreaterThanOrEqual(0); expect(u0).toBeLessThanOrEqual(1);
      expect(u1).toBeGreaterThanOrEqual(0); expect(u1).toBeLessThanOrEqual(1);
      expect(v0).toBeGreaterThanOrEqual(0); expect(v0).toBeLessThanOrEqual(1);
      expect(v1).toBeGreaterThanOrEqual(0); expect(v1).toBeLessThanOrEqual(1);
      expect(u1).toBeGreaterThan(u0);
      expect(v1).toBeGreaterThan(v0);
      expect(Number.isFinite(seed)).toBe(true);
      // 12th float = per-category wind stiffness: rocks rigid (0), grass floppy,
      // flowers stiffer, reeds stiffest. Range [0, 1].
      expect(Number.isFinite(bendK)).toBe(true);
      expect(bendK).toBeGreaterThanOrEqual(0);
      expect(bendK).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildGrassInstances — category selection vs manifest ranges', () => {
  // Three horizontal bands on one grid: flat/low-moisture (grass), a steep ramp
  // (rock), flat/high-moisture (flower) — each band is built to deterministically
  // favour one category branch in the source's if/else chain.
  const W = 30, H = 30, sea = 0.2;
  function bandedField(): TerrainField {
    return makeField(W, H,
      (tx, ty) => {
        if (ty < 10) return 0.5;                              // grass band: flat
        if (ty < 20) return 0.3 + 3.0 * (tx / (W - 1));        // rock band: steep ramp along x
        return 0.5;                                            // flower band: flat
      },
      (_tx, ty) => (ty < 10 ? 0.2 : ty < 20 ? 0.5 : 0.9),
      sea);
  }

  it('emits all three categories when the manifest has capacity for all three', () => {
    const { data, count } = buildGrassInstances(bandedField(), makeManifest());
    expect(count).toBeGreaterThan(0);
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) seen.add(data[i * GRASS_INSTANCE_FLOATS + 10]);
    expect(seen.has(0)).toBe(true); // grass
    expect(seen.has(1)).toBe(true); // flower
    expect(seen.has(2)).toBe(true); // rock
  });

  it('places seaweed in the shallow submerged band and wrack at the tide line', () => {
    // A shore ramping west→east: submerged shelf (seaweed) → wet sand (wrack) → dry land.
    // With reliefM 48 / sea 0.35: e≈0.30 sits ~2.4 m under (seaweed band), e≈0.36 just above
    // the waterline (wrack band), e≥0.38 is dry beach/land.
    const shore = makeField(28, 28, (tx) => 0.30 + tx * 0.006, () => 0.5, 0.35);
    const { data, count, seaweedCount } = buildGrassInstances(shore, makeManifest());
    let weed = 0, wrack = 0;
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      const cat = data[o + 10], bendK = data[o + 11];
      if (cat === 4) { weed++; expect(bendK).toBeGreaterThan(0); }   // seaweed drifts (current sway)
      if (cat === 5) { wrack++; expect(bendK).toBe(0); }             // wrack is static beach debris
    }
    expect(weed).toBeGreaterThan(0);
    expect(wrack).toBeGreaterThan(0);

    // CONTRACT the renderer relies on: the leading `seaweedCount` instances are ALL seaweed
    // (they draw as the pre-water submerged sub-pass), and none of the rest are.
    expect(seaweedCount).toBe(weed);
    for (let i = 0; i < count; i++) {
      const isSeaweed = data[i * GRASS_INSTANCE_FLOATS + 10] === 4;
      expect(isSeaweed).toBe(i < seaweedCount);
    }
  });

  it('grows submerged weed on a river/lake bed ABOVE sea level, keyed on the local water surface', () => {
    // A flat isle at height 0.50 — 7.2 m ABOVE the sea (0.35, relief 48), so the ocean
    // submerged branch never fires here. A central block is a River (waterType 3) whose local
    // surface (0.52) sits ~1 m over the bed → the freshwater branch should plant seaweed-
    // category weed there. Without the water fields the same field grows ZERO weed (proof the
    // weed comes from the fresh-water surface, not the global sea).
    const W = 24, H = 24;
    const field = makeField(W, H, () => 0.50, () => 0.5, 0.35);
    const surfaceW = new Float32Array(W * H).fill(-1);
    const waterType = new Uint32Array(W * H); // 0 = Dry
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) {
      const i = y * W + x;
      waterType[i] = 3;        // WaterType.River
      surfaceW[i] = 0.52;      // ~1 m above the 0.50 bed
    }
    let weedWith = 0;
    const withWater = buildGrassInstances(field, makeManifest(), surfaceW, waterType);
    for (let i = 0; i < withWater.count; i++) if (withWater.data[i * GRASS_INSTANCE_FLOATS + 10] === 4) weedWith++;
    expect(weedWith).toBeGreaterThan(0);
    expect(withWater.seaweedCount).toBe(weedWith);   // contiguous at the front (pre-water sub-pass)

    let weedNone = 0;
    const noWater = buildGrassInstances(field, makeManifest());
    for (let i = 0; i < noWater.count; i++) if (noWater.data[i * GRASS_INSTANCE_FLOATS + 10] === 4) weedNone++;
    expect(weedNone).toBe(0);
  });

  it('floats lily pads ON the surface of a calm lake — land buffer, static, foot at the SURFACE', () => {
    // A flat isle at 0.50 with a central LAKE block whose surface (0.52, ~1 m deep) is calm
    // (uniform → zero surface gradient). Pads must appear, in the LAND sub-range (drawn AFTER
    // the water pass), wind-static, with the foot lifted to the WATER SURFACE — not the bed.
    const W = 24, H = 24;
    const field = makeField(W, H, () => 0.50, () => 0.5, 0.35);
    const surfaceW = new Float32Array(W * H).fill(-1);
    const waterType = new Uint32Array(W * H);
    for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) {
      const i = y * W + x;
      waterType[i] = 2;        // WaterType.Lake
      surfaceW[i] = 0.52;      // ~1 m over the 0.50 bed — inside the lily depth band
    }
    const { data, count, seaweedCount } = buildGrassInstances(field, makeManifest(), surfaceW, waterType);
    const g = field.globals;
    const halfH = g.half[1];
    const surfLiftPx = (0.52 - g.seaLevel) * g.reliefM * g.zPxPerM;   // foot lift AT THE SURFACE
    let pads = 0;
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      if (data[o + 10] !== 6) continue;   // lilypad category
      pads++;
      expect(i).toBeGreaterThanOrEqual(seaweedCount);   // land buffer → post-water pass
      expect(data[o + 11]).toBe(0);                     // no wind bend
      // footY = (fx+fy)·halfH − lift. Reconstruct fx+fy from the depth float; the residual
      // lift must equal the SURFACE lift (0.52), not the bed's (0.50 → 144 px vs 163.2 px).
      const sum = data[o + 2] * (W + H);
      expect(sum * halfH - data[o + 1]).toBeCloseTo(surfLiftPx, 3);
    }
    expect(pads).toBeGreaterThan(0);
  });

  it('grows NO lily pads on a descending river reach (current tears a floating leaf off)', () => {
    // Same block, but the water surface FALLS along x (0.096 m/tile — a live current, well
    // over the calm gate). The waterweed branch still fires; the lily branch must not.
    const W = 24, H = 24;
    const field = makeField(W, H, (tx) => 0.50 - tx * 0.002, () => 0.5, 0.35);
    const surfaceW = new Float32Array(W * H).fill(-1);
    const waterType = new Uint32Array(W * H);
    for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) {
      const i = y * W + x;
      waterType[i] = 3;                  // WaterType.River
      surfaceW[i] = 0.52 - x * 0.002;    // surface tracks the bed downhill → constant ~1 m depth
    }
    const { data, count } = buildGrassInstances(field, makeManifest(), surfaceW, waterType);
    let pads = 0, weed = 0;
    for (let i = 0; i < count; i++) {
      const cat = data[i * GRASS_INSTANCE_FLOATS + 10];
      if (cat === 6) pads++;
      if (cat === 4) weed++;
    }
    expect(pads).toBe(0);
    expect(weed).toBeGreaterThan(0);     // the reach is still alive below the surface
  });

  it('falls back to the grass atlas cell (UV) when a triggered category has zero manifest capacity', () => {
    // Isolate the flower band only, so every non-skipped instance is grass or flower.
    const flowerOnly = makeField(W, 10, () => 0.5, () => 0.9, sea);
    const manifest: ClutterManifest = {
      cell: 32, cols: 4, rows: 1, count: 4,
      ranges: {
        grass: { start: 0, count: 2 },
        flower: { start: 2, count: 0 }, // no flower sprites sliced
        reed: { start: 3, count: 0 },
        rock: { start: 3, count: 1 },
        seaweed: { start: 4, count: 0 },
        wrack: { start: 4, count: 0 },
        lilypad: { start: 4, count: 0 },
      },
      cats: ['grass', 'flower', 'rock'],
    };
    const { data, count } = buildGrassInstances(flowerOnly, manifest);
    expect(count).toBeGreaterThan(0);
    const [gu0, gv0, gu1, gv1] = cellRect(manifest, manifest.ranges.grass.start);
    let sawFlowerCategory = false;
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      const cat = data[o + 10];
      if (cat !== 1) continue; // only the flower-CATEGORY instances are of interest here
      sawFlowerCategory = true;
      // SURPRISE (see report): the packed category scalar stays "flower" (1) even
      // though the atlas UV gracefully falls back to the grass cell — the fallback
      // in `pickLayer` only changes which sprite is drawn, not the shader category.
      expect(data[o + 4]).toBeCloseTo(gu0, 6);
      expect(data[o + 5]).toBeCloseTo(gv0, 6);
      expect(data[o + 6]).toBeCloseTo(gu1, 6);
      expect(data[o + 7]).toBeCloseTo(gv1, 6);
    }
    expect(sawFlowerCategory).toBe(true); // the field really does trigger the flower branch
  });
});

describe('buildGrassInstances — hard cap thins uniformly', () => {
  it('plateaus near one cap on two grids of different (large) size', () => {
    const manifest = makeManifest();
    // Lush moisture (≥ the aridity-thinning threshold) so the grass carpet saturates the
    // MAX_GRASS cap — the point of this test. A dry field would thin below the cap and mask it.
    const big = buildGrassInstances(makeField(170, 170, () => 0.6, () => 0.6), manifest);
    const bigger = buildGrassInstances(makeField(260, 260, () => 0.6, () => 0.6), manifest);
    expect(big.data.length).toBe(big.count * GRASS_INSTANCE_FLOATS);
    expect(bigger.data.length).toBe(bigger.count * GRASS_INSTANCE_FLOATS);
    expect(Number.isFinite(big.count)).toBe(true);
    // An uncapped generator would scale ~2.3x with the grid area; the thinned cap
    // plateaus both at (just under) the same ceiling. Not exact equality — the
    // deterministic keep-hash lands slightly differently per grid.
    const ratio = bigger.count / big.count;
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  }, 20_000);   // two big double-scanned grids — well past the 5 s default on a busy box

  it('covers the WHOLE map when capped — thinning, never truncating at a row', () => {
    // Regression: the old cap broke out of the row scan when the buffer filled, so a
    // big lush map got a full-density carpet down to ~row N and NOTHING below it —
    // "the terrain looks bare" over most of the world. Thinning must reach the bottom.
    const W = 260, H = 260;
    const field = makeField(W, H, () => 0.6, () => 0.6);
    const { data, count } = buildGrassInstances(field, makeManifest());
    const halfW = field.globals.half[0];
    let bottomQuarter = 0;
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      const sum = data[o + 2] * (W + H);         // fx + fy (from the packed depth)
      const diff = data[o] / halfW;              // fx - fy
      const fy = (sum - diff) / 2;
      if (fy >= H * 0.75) bottomQuarter++;
    }
    // Uniform thinning ⇒ the bottom quarter of a uniform field holds ~25% of the
    // instances. The truncating cap put exactly 0 there.
    expect(bottomQuarter).toBeGreaterThan(count * 0.15);
  }, 20_000);   // one big double-scanned grid (see above)
});

describe('buildGrassInstances — snow-covered ground carries no land clutter', () => {
  it('emits nothing on an arctic-cold flat field where the terrain shader paints snow', () => {
    // temp 0.1 → the snow kernel's cold term saturates on flat ground; the same
    // field at temperate 0.5 is a full meadow (control), so the emptiness is the
    // snow skip and not some other gate.
    const cold = makeField(20, 20, () => 0.6, () => 0.5, 0.35, () => 0.1);
    const warm = makeField(20, 20, () => 0.6, () => 0.5, 0.35, () => 0.5);
    expect(buildGrassInstances(warm, makeManifest()).count).toBeGreaterThan(0);
    expect(buildGrassInstances(cold, makeManifest()).count).toBe(0);
  });

  it('still grows submerged waterweed under a cold climate — snow never covers liquid water', () => {
    // Cold flat isle with a river block ~1 m deep: the land stays clutter-bare
    // (snow) but the freshwater submerged branch runs before the snow check.
    const W = 24, H = 24;
    const field = makeField(W, H, () => 0.50, () => 0.5, 0.35, () => 0.1);
    const surfaceW = new Float32Array(W * H).fill(-1);
    const waterType = new Uint32Array(W * H);
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) {
      const i = y * W + x;
      waterType[i] = 3;        // WaterType.River
      surfaceW[i] = 0.52;
    }
    const { data, count, seaweedCount } = buildGrassInstances(field, makeManifest(), surfaceW, waterType);
    expect(seaweedCount).toBeGreaterThan(0);
    // Everything emitted is submerged/surface water flora (seaweed or lilypad) — no
    // green tufts or bare-ground rocks pasted onto the snowfield.
    for (let i = 0; i < count; i++) {
      const cat = data[i * GRASS_INSTANCE_FLOATS + 10];
      expect([4, 6]).toContain(cat);
    }
  });
});

describe('buildGrassInstances — flower clumping', () => {
  it('flowers exist but stay a minority against grass on a uniformly flower-eligible field', () => {
    const W = 48, H = 40, sea = 0.2;
    const field = makeField(W, H, () => 0.5, () => 0.6, sea); // flat, moist enough for flower branch
    const { data, count } = buildGrassInstances(field, makeManifest());
    expect(count).toBeGreaterThan(0);
    let flowers = 0;
    for (let i = 0; i < count; i++) if (data[i * GRASS_INSTANCE_FLOATS + 10] === 1) flowers++;
    expect(flowers).toBeGreaterThan(0);
    expect(flowers).toBeLessThan(count * 0.5);
  });

  it('flower instances concentrate into a minority of spatial blocks rather than spreading uniformly', () => {
    // A low-frequency clumping field (~5.5-tile period) should leave whole blocks of
    // that scale empty while others cluster several flowers — a uniform per-cell
    // Bernoulli process at the same density would touch nearly every block instead.
    const W = 48, H = 40, sea = 0.2, BLOCK = 6;
    const field = makeField(W, H, () => 0.5, () => 0.6, sea);
    const { data, count } = buildGrassInstances(field, makeManifest());
    const halfW = field.globals.half[0];
    const blocksX = Math.ceil(W / BLOCK), blocksY = Math.ceil(H / BLOCK);
    const blockCounts = new Map<number, number>();
    let flowers = 0;
    for (let i = 0; i < count; i++) {
      const o = i * GRASS_INSTANCE_FLOATS;
      if (data[o + 10] !== 1) continue;
      flowers++;
      const footX = data[o], depth = data[o + 2];
      const sum = depth * (W + H), diff = footX / halfW;
      const fx = (sum + diff) / 2, fy = (sum - diff) / 2;
      const bx = Math.min(blocksX - 1, Math.floor(fx / BLOCK));
      const by = Math.min(blocksY - 1, Math.floor(fy / BLOCK));
      const key = by * blocksX + bx;
      blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);
    }
    expect(flowers).toBeGreaterThan(0);
    const totalBlocks = blocksX * blocksY;
    const occupiedBlocks = blockCounts.size;
    // Loose but meaningful: clustering leaves a real fraction of blocks untouched.
    expect(occupiedBlocks).toBeLessThan(totalBlocks);
  });
});

describe('buildGrassInstances — soft cover obeys the terrain splat ramps', () => {
  const FLOATS = GRASS_INSTANCE_FLOATS;
  /** Reconstruct the continuous tile fx of a packed LAND instance (halfW = 64). */
  const fxOf = (data: Float32Array, o: number, W: number, H: number): number => {
    const sum = data[o + 2] * (W + H);        // depth = (fx+fy)/(W+H)
    const diff = data[o] / 64;                // footX = (fx-fy)*halfW
    return (sum + diff) / 2;
  };
  const SOFT = new Set([0, 1, 3]);            // grass / flower / reed cat ids

  it('a steep ramp face carries NOTHING — the rock paint owns it outright', () => {
    // 0.04 elevation per tile at zPxPerM 60 -> slope ~0.51 of vertical, right in the
    // shader's wRock ramp. Sea at 0.2 keeps the whole ramp far above the wrack band.
    // No clutter of ANY category: a scree billboard pasted over the painted face
    // reads as floating on the cliff (user report), so past the 0.48 threshold the
    // scatter emits nothing and the analytic rock texture carries the face alone.
    const W = 20, H = 8;
    const field = makeField(W, H, (tx) => Math.min(0.98, 0.36 + tx * 0.04), () => 0.5, 0.2);
    field.globals.zPxPerM = 60;
    const { data, count, seaweedCount } = buildGrassInstances(field, makeManifest());
    expect(seaweedCount).toBe(0);
    let onRamp = 0;
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS;
      const fx = fxOf(data, o, W, H);
      if (fx < 2 || fx > 13) continue;        // interior of the steep band only
      onRamp++;
    }
    expect(onRamp).toBe(0);
  });

  it('a cool high plateau thins the carpet toward the snowline (alpine approach)', () => {
    // metresAS = 20 (past the 16 m alpine fade start, below the 22.5 m snowline) —
    // cool ground thins, warm ground at the SAME altitude keeps its full carpet.
    const h = 0.35 + 20 / 48;
    const W = 30, H = 30;
    const soft = (temp: number): number => {
      const f = makeField(W, H, () => h, () => 0.5, 0.35, () => temp);
      const { data, count } = buildGrassInstances(f, makeManifest());
      let n = 0;
      for (let i = 0; i < count; i++) if (SOFT.has(data[i * FLOATS + 10])) n++;
      return n;
    };
    const warm = soft(0.5), cool = soft(0.35);
    expect(warm).toBeGreaterThan(0);
    const ratio = cool / warm;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.8);
  });

  it('soft cover fades out on the approach to the snowline, not at a hard wall', () => {
    // temp 0.26 -> snow01 ~ 0.198: just under the 0.2 hide line. The fade leaves
    // almost nothing standing there (the shader speckles snow into this zone).
    const W = 30, H = 30;
    const soft = (temp: number): number => {
      const f = makeField(W, H, () => 0.5, () => 0.5, 0.35, () => temp);
      const { data, count } = buildGrassInstances(f, makeManifest());
      let n = 0;
      for (let i = 0; i < count; i++) if (SOFT.has(data[i * FLOATS + 10])) n++;
      return n;
    };
    const temperate = soft(0.5), fringe = soft(0.26);
    expect(temperate).toBeGreaterThan(0);
    expect(fringe / temperate).toBeLessThan(0.15);
  });
});
