import { describe, it, expect, beforeEach } from 'vitest';
import { islandFalloff, coastReliefAt, clearCoastFieldCache, applyIslandMask, shapeCoastElevation, DEFAULT_ISLAND } from '@/terrain/island-mask';
import { generateTerrainFields } from '@/terrain/terrain-generator';
import { classifyBiomes } from '@/terrain/terrain-generator';

describe('islandFalloff', () => {
  const W = 64, H = 64;

  it('is ~0 at the map centre (interior untouched)', () => {
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    expect(islandFalloff(cx, cy, W, H)).toBeCloseTo(0, 5);
  });

  it('is 1 (fully sunk) at the corners', () => {
    expect(islandFalloff(0, 0, W, H)).toBe(1);
    expect(islandFalloff(W - 1, H - 1, W, H)).toBe(1);
  });

  it('is 1 at edge midpoints with the default spec (end = 1.0)', () => {
    expect(islandFalloff((W - 1) / 2, 0, W, H)).toBe(1); // top edge midpoint, d = 1
    expect(islandFalloff(0, (H - 1) / 2, W, H)).toBe(1); // left edge midpoint
  });

  // The round baseline (warp off) — monotonicity/symmetry are properties of the
  // round disc; the warped DEFAULT breaks both on purpose (that's C2's point).
  const ROUND = { shape: 'euclidean' as const, start: 0.62, end: 1.0, coastWarp: 0 };

  it('is monotonic from centre to edge along an axis (round)', () => {
    let prev = -1;
    for (let x = Math.floor((W - 1) / 2); x < W; x++) {
      const f = islandFalloff(x, (H - 1) / 2, W, H, ROUND);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('is deterministic and symmetric (round)', () => {
    expect(islandFalloff(10, 20, W, H, ROUND)).toBe(islandFalloff(10, 20, W, H, ROUND));
    expect(islandFalloff(10, 20, W, H, ROUND)).toBeCloseTo(islandFalloff(W - 1 - 10, 20, W, H, ROUND), 10);
    expect(islandFalloff(10, 20, W, H, ROUND)).toBeCloseTo(islandFalloff(10, H - 1 - 20, W, H, ROUND), 10);
  });

  it('square shape leaves a wider interior than euclidean (corners aside)', () => {
    // At an off-axis interior point, square (max-axis) distance < euclidean.
    const sq = islandFalloff(40, 40, W, H, { shape: 'square', start: 0.62, end: 1.0 });
    const eu = islandFalloff(40, 40, W, H, { shape: 'euclidean', start: 0.62, end: 1.0 });
    expect(sq).toBeLessThanOrEqual(eu);
  });

  it('handles 1-wide axes without NaN (centred, no divide-by-zero)', () => {
    expect(Number.isFinite(islandFalloff(0, 5, 1, 16))).toBe(true);
    expect(Number.isFinite(islandFalloff(5, 0, 16, 1))).toBe(true);
  });
});

describe('islandFalloff coastline warp (C2)', () => {
  const W = 96, H = 96, seed = 31;
  const ROUND = { shape: 'euclidean' as const, start: 0.62, end: 1.0, coastWarp: 0 };
  const WARPED = { shape: 'euclidean' as const, start: 0.62, end: 1.0, coastWarp: 0.16, coastWarpFreq: 0.03 };

  // Cells where the round falloff is mid-range = the coast band the warp acts on.
  const coastCells: Array<[number, number]> = [];
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const r = islandFalloff(x, y, W, H, ROUND);
    if (r > 0.05 && r < 0.95) coastCells.push([x, y]);
  }

  it('warp = 0 reproduces the round falloff exactly', () => {
    for (const [x, y] of coastCells.slice(0, 40)) {
      expect(islandFalloff(x, y, W, H, ROUND, seed)).toBe(islandFalloff(x, y, W, H, ROUND, 0));
    }
  });

  it('warp reshapes the coast (outline differs from the round disc)', () => {
    let moved = 0;
    for (const [x, y] of coastCells) {
      if (Math.abs(islandFalloff(x, y, W, H, WARPED, seed) - islandFalloff(x, y, W, H, ROUND)) > 0.02) moved++;
    }
    // A large share of the coast band shifts — it's no longer a clean circle.
    expect(moved).toBeGreaterThan(coastCells.length * 0.3);
  });

  it('keeps a CLOSED ocean frame at any amplitude (border never warps)', () => {
    const huge = { shape: 'euclidean' as const, start: 0.62, end: 1.0, coastWarp: 0.4, coastWarpFreq: 0.05 };
    for (let x = 0; x < W; x++) {
      expect(islandFalloff(x, 0, W, H, huge, seed)).toBe(1);          // top row
      expect(islandFalloff(x, H - 1, W, H, huge, seed)).toBe(1);      // bottom row
    }
    for (let y = 0; y < H; y++) {
      expect(islandFalloff(0, y, W, H, huge, seed)).toBe(1);          // left col
      expect(islandFalloff(W - 1, y, W, H, huge, seed)).toBe(1);      // right col
    }
  });

  it('different seeds → different coastline', () => {
    let diff = 0;
    for (const [x, y] of coastCells) {
      if (Math.abs(islandFalloff(x, y, W, H, WARPED, 1) - islandFalloff(x, y, W, H, WARPED, 2)) > 0.02) diff++;
    }
    expect(diff).toBeGreaterThan(coastCells.length * 0.2);
  });

  it('is deterministic for a fixed seed', () => {
    for (const [x, y] of coastCells.slice(0, 40)) {
      expect(islandFalloff(x, y, W, H, WARPED, seed)).toBe(islandFalloff(x, y, W, H, WARPED, seed));
    }
  });
});

describe('applyIslandMask', () => {
  beforeEach(() => clearCoastFieldCache());

  it('sinks border cells toward 0 and raises the interior via coast relief', () => {
    const W = 32, H = 32;
    const elev = new Float32Array(W * H).fill(0.6);
    applyIslandMask(elev, W, H);
    expect(elev[0]).toBeCloseTo(0, 5); // corner fully sunk
    // Coast relief lifts the deep interior up to ~the full plateau (`dome`);
    // the centre is the deepest cell, so it sits on the plateau.
    const dome = DEFAULT_ISLAND.dome ?? 0;
    const centre = elev[Math.floor(H / 2) * W + Math.floor(W / 2)];
    expect(centre).toBeGreaterThan(0.6 + dome * 0.8);
    expect(centre).toBeLessThanOrEqual(0.6 + dome + 1e-6);
  });

  it('with no dome the interior is left intact', () => {
    const W = 32, H = 32;
    const elev = new Float32Array(W * H).fill(0.8);
    applyIslandMask(elev, W, H, { ...DEFAULT_ISLAND, dome: 0 });
    const centre = elev[Math.floor(H / 2) * W + Math.floor(W / 2)];
    expect(centre).toBeCloseTo(0.8, 5);
  });

  it('returns the same array instance (mutates in place)', () => {
    const elev = new Float32Array(16 * 16).fill(0.5);
    expect(applyIslandMask(elev, 16, 16)).toBe(elev);
  });
});

describe('coastReliefAt (C1 — coast-distance relief replaces the dome)', () => {
  const W = 80, H = 64, seed = 7;
  beforeEach(() => clearCoastFieldCache());

  it('is ~0 along the shore and rises to the plateau inland', () => {
    const plateau = DEFAULT_ISLAND.dome ?? 0;
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    // A cell just inside the macro coast (falloff just below the sea threshold)
    // carries little relief; the deep centre sits at the full plateau.
    const centre = coastReliefAt(Math.round(cx), Math.round(cy), W, H, DEFAULT_ISLAND, seed);
    expect(centre).toBeGreaterThan(plateau * 0.95);
    expect(centre).toBeLessThanOrEqual(plateau + 1e-9);
    // Near a horizontal edge but still land: clearly less relief than the centre.
    const nearShore = coastReliefAt(Math.round(cx), 6, W, H, DEFAULT_ISLAND, seed);
    expect(nearShore).toBeLessThan(centre * 0.6);
  });

  it('rises monotonically from shore to centre along the vertical axis', () => {
    const cx = Math.round((W - 1) / 2);
    let prev = -1;
    for (let y = 2; y <= Math.round((H - 1) / 2); y += 2) {
      const r = coastReliefAt(cx, y, W, H, DEFAULT_ISLAND, seed);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
  });

  it('has NO central bullseye — a broad interior plateau, not a single peak', () => {
    const plateau = DEFAULT_ISLAND.dome ?? 0;
    const cx = Math.round((W - 1) / 2), cy = Math.round((H - 1) / 2);
    const centre = coastReliefAt(cx, cy, W, H, DEFAULT_ISLAND, seed);
    // A cell well off-centre but still deep interior is essentially as high as
    // the centre (the old dome would have been markedly lower here).
    const offCentre = coastReliefAt(cx + 10, cy + 6, W, H, DEFAULT_ISLAND, seed);
    expect(offCentre).toBeGreaterThan(plateau * 0.9);
    expect(Math.abs(centre - offCentre)).toBeLessThan(plateau * 0.1);
  });

  it('is 0 everywhere with no dome configured', () => {
    expect(coastReliefAt(40, 32, W, H, { ...DEFAULT_ISLAND, dome: 0 }, seed)).toBe(0);
  });

  it('is seed-invariant for a ROUND spec, seed-dependent once the coast warps', () => {
    const ROUND = { ...DEFAULT_ISLAND, coastWarp: 0 };
    expect(coastReliefAt(20, 16, W, H, ROUND, 1)).toBe(coastReliefAt(20, 16, W, H, ROUND, 99999));
    // With the warped default the relief tracks the (seed-dependent) coastline.
    expect(coastReliefAt(20, 16, W, H, DEFAULT_ISLAND, 1))
      .not.toBe(coastReliefAt(20, 16, W, H, DEFAULT_ISLAND, 99999));
  });

  it('seam still sinks the border to ocean (falloff unchanged)', () => {
    // Border corner: falloff = 1 → fully sunk regardless of relief.
    expect(shapeCoastElevation(0.6, 0, 0, W, H, DEFAULT_ISLAND, seed)).toBeCloseTo(0, 6);
  });
});

describe('island mask in generateTerrainFields → ocean frame', () => {
  const W = 64, H = 64, seed = 1234;

  it('off by default: terrain reaches the border (some non-ocean edge tiles)', () => {
    const fields = generateTerrainFields({ seed, width: W, height: H, elevationScale: 0.06 });
    let landEdge = 0;
    for (let x = 0; x < W; x++) if (fields.elevation[x] >= 0.35) landEdge++;
    // Without a mask the top row is just noise — at least some of it should be land.
    expect(landEdge).toBeGreaterThan(0);
  });

  it('on: every border tile is below sea level (a closed ocean frame)', () => {
    const fields = generateTerrainFields({
      seed, width: W, height: H, elevationScale: 0.06, seaLevel: 0.35, island: DEFAULT_ISLAND,
    });
    const below = (i: number) => fields.elevation[i] < 0.35;
    for (let x = 0; x < W; x++) {
      expect(below(x)).toBe(true);                 // top row
      expect(below((H - 1) * W + x)).toBe(true);   // bottom row
    }
    for (let y = 0; y < H; y++) {
      expect(below(y * W)).toBe(true);             // left col
      expect(below(y * W + (W - 1))).toBe(true);   // right col
    }
  });

  it('on: border biomes classify as ocean, interior keeps land', () => {
    const cfg = { seed, width: W, height: H, elevationScale: 0.06, seaLevel: 0.35, island: DEFAULT_ISLAND };
    const fields = generateTerrainFields(cfg);
    const bm = classifyBiomes(fields, cfg);
    const oceanish = new Set(['ocean', 'deep_ocean']);
    for (let x = 0; x < W; x++) expect(oceanish.has(bm.biomes[x])).toBe(true);
    // The interior should still contain non-ocean land somewhere.
    let land = 0;
    for (let i = 0; i < bm.biomes.length; i++) if (!oceanish.has(bm.biomes[i])) land++;
    expect(land).toBeGreaterThan(W * H * 0.1);
  });
});

describe('C1 — island interior reads as land, not a mountain bullseye', () => {
  beforeEach(() => clearCoastFieldCache());
  const W = 96, H = 80;
  const OCEAN = new Set(['ocean', 'deep_ocean']);
  const HIGH = new Set(['mountain', 'peak']);
  const SOFT = new Set([
    'temperate_grassland', 'temperate_forest', 'tropical_grassland', 'savanna',
    'tropical_forest', 'beach', 'scrubland', 'boreal_forest', 'tundra', 'desert', 'swamp',
  ]);

  const biomesFor = (seed: number) => {
    const cfg = {
      seed, width: W, height: H,
      elevationScale: 6 / Math.max(W, H), moistureScale: 8 / Math.max(W, H),
      seaLevel: 0.35, island: DEFAULT_ISLAND,
    };
    return classifyBiomes(generateTerrainFields(cfg), cfg).biomes;
  };

  // The live failure C1 fixes: a tall central dome pushed the whole interior to
  // mountain biome, burying settlements. Coast-distance relief plateaus below the
  // mountain threshold, so the interior is walkable land with mountains only in
  // ridge zones. Guarded across seeds since worldgen seeds randomly.
  for (const seed of [1, 42, 1234, 99999]) {
    it(`seed ${seed}: interior is predominantly walkable land, not mountain`, () => {
      const biomes = biomesFor(seed);
      let land = 0, high = 0, soft = 0;
      for (const b of biomes) {
        if (OCEAN.has(b)) continue;
        land++;
        if (HIGH.has(b)) high++;
        if (SOFT.has(b)) soft++;
      }
      expect(land).toBeGreaterThan(W * H * 0.1);
      expect(high / land).toBeLessThan(0.4);  // NOT a mountain-dominated interior
      expect(soft / land).toBeGreaterThan(0.3); // plenty of buildable/walkable land
    });
  }
});
