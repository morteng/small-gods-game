import { describe, it, expect } from 'vitest';
import { buildRiparianEntities } from '@/world/riparian-scatter';
import { WaterType, type HydrologyResult } from '@/core/types';

/**
 * Build a synthetic hydrology raster: a 1-cell-wide river column at x=1, flanked by
 * dry land (so every river cell is a shallow margin). The water-surface descends down
 * the column at `slopePerTile` — 0 models a still pool, a steep value a cascade.
 */
function riverColumn(width: number, height: number, slopePerTile: number, flow: number): HydrologyResult {
  const n = width * height;
  const waterType = new Uint8Array(n).fill(WaterType.Dry);
  const surfaceW = new Float32Array(n).fill(-1);
  const flowField = new Float32Array(n);
  const riverMask = new Uint8Array(n);
  const waterMask = new Uint8Array(n);
  const rx = 1; // river column
  for (let y = 0; y < height; y++) {
    const i = y * width + rx;
    waterType[i] = WaterType.River;
    waterMask[i] = 1;
    riverMask[i] = 1;
    flowField[i] = flow;
    // Base kept high enough that the surface stays positive down the whole column
    // (surfaceW < 0 is the dry-land sentinel; a negative would read as no gradient).
    surfaceW[i] = 4.0 - y * slopePerTile; // descends downstream
  }
  return {
    riverMask, flowField,
    drainTo: new Int32Array(n).fill(-1),
    surfaceW, waterMask, waterType,
    flowDirX: new Float32Array(n), flowDirY: new Float32Array(n),
    strahler: new Uint8Array(n), width: new Float32Array(n),
  };
}

/** In-water boulders = granite-boulder entities sitting on the river column (x≈1). */
function countInWaterBoulders(ents: ReturnType<typeof buildRiparianEntities>): number {
  return ents.filter((e) => e.kind === 'granite-boulder' && Math.floor(e.x) === 1).length;
}

/**
 * Build a synthetic hydrology raster: a WIDE river band [1, 1+bandWidth) flanked by dry
 * land, so the band has real margin columns (x=1 and x=bandWidth) AND real interior
 * columns with no land neighbour in between. `channelHalfWidth` is stamped uniformly
 * onto `hydro.width` for every river cell — the per-cell Leopold–Maddock estimate the
 * interior-eligibility gate reads, independent of the raster's own geometric width.
 */
function riverBand(
  width: number, height: number, bandWidth: number, slopePerTile: number, flow: number, channelHalfWidth: number,
): HydrologyResult {
  const n = width * height;
  const waterType = new Uint8Array(n).fill(WaterType.Dry);
  const surfaceW = new Float32Array(n).fill(-1);
  const flowField = new Float32Array(n);
  const riverMask = new Uint8Array(n);
  const waterMask = new Uint8Array(n);
  const widthArr = new Float32Array(n);
  // Leave the top/bottom row dry so the band doesn't touch the MAP EDGE — the margin
  // gate (`landNb`) also treats the map edge as land, which would otherwise misclassify
  // a couple of true interior cells at y=0/y=height-1 as margin.
  for (let y = 1; y < height - 1; y++) {
    for (let rx = 1; rx <= bandWidth; rx++) {
      const i = y * width + rx;
      waterType[i] = WaterType.River;
      waterMask[i] = 1;
      riverMask[i] = 1;
      flowField[i] = flow;
      surfaceW[i] = 4.0 - y * slopePerTile;
      widthArr[i] = channelHalfWidth;
    }
  }
  return {
    riverMask, flowField,
    drainTo: new Int32Array(n).fill(-1),
    surfaceW, waterMask, waterType,
    flowDirX: new Float32Array(n), flowDirY: new Float32Array(n),
    strahler: new Uint8Array(n), width: widthArr,
  };
}

/**
 * Interior boulders = granite-boulder entities that are NOT margin cells in either axis:
 * not on the band's two outer columns (adjacent to the dry banks), AND not within a few
 * rows of the band's dry top/bottom cap (`riverBand` stops one row short of the map edge,
 * so the row right next to that cap is ALSO a `landNb` margin cell — a real river reach
 * has no such vertical cap, this is purely a finite-fixture artifact to exclude).
 */
function countInteriorBoulders(ents: ReturnType<typeof buildRiparianEntities>, bandWidth: number, height: number): number {
  return ents.filter((e) => {
    if (e.kind !== 'granite-boulder') return false;
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    if (tx <= 1 || tx >= bandWidth) return false;
    if (ty <= 3 || ty >= height - 4) return false;
    return true;
  }).length;
}

describe('riparian-scatter — riffle-scored in-water boulders', () => {
  const W = 3, H = 160, FLOW = 2000, SEED = 4242;

  it('clusters boulders on a steep reach, keeps a flat pool nearly clear', () => {
    const steep = countInWaterBoulders(buildRiparianEntities(riverColumn(W, H, 0.02, FLOW), W, H, SEED));
    const flat = countInWaterBoulders(buildRiparianEntities(riverColumn(W, H, 0.0, FLOW), W, H, SEED));

    // A cascade (slope 0.02 ≫ REF 0.012) reads bouldery; a still pool only gets the
    // sparse ambient floor. The steep reach should carry many-fold more.
    expect(steep).toBeGreaterThan(flat * 4);
    expect(flat).toBeLessThan(H * 0.05); // pool stays clear (< ~5% of cells)
    expect(steep).toBeGreaterThan(H * 0.15); // riffle clusters (> ~15% of cells)
  });

  it('tags in-water boulders waterPlaced so the corridor sweep spares them', () => {
    const ents = buildRiparianEntities(riverColumn(W, H, 0.02, FLOW), W, H, SEED);
    const boulders = ents.filter((e) => e.kind === 'granite-boulder' && Math.floor(e.x) === 1);
    expect(boulders.length).toBeGreaterThan(0);
    expect(boulders.every((e) => e.tags?.includes('waterPlaced'))).toBe(true);
  });

  it('is deterministic — same raster + seed re-scatters identically', () => {
    const a = buildRiparianEntities(riverColumn(W, H, 0.02, FLOW), W, H, SEED);
    const b = buildRiparianEntities(riverColumn(W, H, 0.02, FLOW), W, H, SEED);
    expect(a.map((e) => `${e.kind}@${e.x.toFixed(3)},${e.y.toFixed(3)}`))
      .toEqual(b.map((e) => `${e.kind}@${e.x.toFixed(3)},${e.y.toFixed(3)}`));
  });
});

describe('riparian-scatter — interior boulders scale by local channel half-width', () => {
  const BAND_W = 9, MAP_W = 12, H = 80, FLOW = 2000, SEED = 777;

  it('a wide, genuinely wide-channel cascade gets interior boulders, not just margin ones', () => {
    const ents = buildRiparianEntities(riverBand(MAP_W, H, BAND_W, 0.02, FLOW, 3.5), MAP_W, H, SEED);
    expect(countInteriorBoulders(ents, BAND_W, H)).toBeGreaterThan(0);
  });

  it('a wide RASTER band with a NARROW hydrology half-width stays interior-clear (no rock wall)', () => {
    // Same geometric band width + same cascade slope as above, but the hydrology says this
    // reach is only brook-wide (half-width well under INTERIOR_WIDTH_MIN) — interior
    // eligibility must key off the half-width, not the raster's own cell span.
    const ents = buildRiparianEntities(riverBand(MAP_W, H, BAND_W, 0.02, FLOW, 0.5), MAP_W, H, SEED);
    expect(countInteriorBoulders(ents, BAND_W, H)).toBe(0);
  });

  it('a wide, calm (flat) reach stays interior-clear even at full channel half-width', () => {
    // High half-width, but no riffle (slope 0) — the calm-pool gate still applies to the
    // interior, matching the margin gate's documented intent.
    const ents = buildRiparianEntities(riverBand(MAP_W, H, BAND_W, 0.0, FLOW, 3.5), MAP_W, H, SEED);
    expect(countInteriorBoulders(ents, BAND_W, H)).toBe(0);
  });
});

describe('riparian-scatter — lush bank ground cover', () => {
  const W = 5, H = 80, FLOW = 800, SEED = 99;
  const GROUND = new Set(['heather', 'common-reed', 'carex-sedge']);

  it('places ground-layer entities from the wetland undergrowth pool on the bank rings, tagged waterPlaced', () => {
    const ents = buildRiparianEntities(riverColumn(W, H, 0.0, FLOW), W, H, SEED);
    const ground = ents.filter((e) => GROUND.has(e.kind));
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.every((e) => e.tags?.includes('waterPlaced'))).toBe(true);
    // Confined to the bank rings (dist 1-2 either side of the river column at x=1).
    expect(ground.every((e) => Math.floor(e.x) >= 0 && Math.floor(e.x) <= 3)).toBe(true);
  });

  it('never places the art-less `reeds` placeholder kind — the real `common-reed` species carries the role', () => {
    const ents = buildRiparianEntities(riverColumn(W, H, 0.02, FLOW), W, H, SEED);
    expect(ents.some((e) => e.kind === 'reeds')).toBe(false);
  });
});

describe('riparian-scatter — the bank assemblage is a function of the adjacent biome (WCV 97)', () => {
  const W = 5, H = 120, FLOW = 800, SEED = 31;
  const hydro = () => riverColumn(W, H, 0.0, FLOW);
  /** Every cell tagged with one biome — the bank cells then all read that biome. */
  const allBiome = (b: string): string[] => new Array(W * H).fill(b);
  const kindsFor = (b: string | null): Set<string> =>
    new Set(buildRiparianEntities(hydro(), W, H, SEED, b === null ? null : allBiome(b)).map((e) => e.kind));

  it('a TEMPERATE bank keeps the willow gallery — and now gains common-alder in the pool', () => {
    const k = kindsFor('temperate_forest');
    expect([...k].some((x) => x === 'white-willow' || x === 'weeping-willow' || x === 'common-alder')).toBe(true);
    expect(k.has('tamarisk')).toBe(false);
  });

  it('a DESERT bank is tamarisk + esparto, never willows', () => {
    const k = kindsFor('desert');
    expect([...k].some((x) => x === 'tamarisk' || x === 'esparto-grass')).toBe(true);
    expect(k.has('white-willow')).toBe(false);
    expect(k.has('weeping-willow')).toBe(false);
  });

  it('a SWAMP bank is reed/bulrush/sedge-heavy under alder', () => {
    const k = kindsFor('swamp');
    expect([...k].some((x) => x === 'common-reed' || x === 'bulrush' || x === 'carex-sedge')).toBe(true);
    expect(k.has('tamarisk')).toBe(false);
  });

  it('a MOUNTAIN bank is sparse downy-birch, not a willow gallery', () => {
    const k = kindsFor('mountain');
    expect(k.has('weeping-willow')).toBe(false);
    expect(k.has('tamarisk')).toBe(false);
    // Sparse by design: fewer bank trees than the temperate reach on the same raster.
    const trees = (b: string): number => buildRiparianEntities(hydro(), W, H, SEED, allBiome(b))
      .filter((e) => e.kind === 'downy-birch' || e.kind === 'white-willow' || e.kind === 'weeping-willow'
        || e.kind === 'black-poplar' || e.kind === 'weeping-ash' || e.kind === 'common-alder').length;
    expect(trees('mountain')).toBeLessThan(trees('temperate_forest'));
  });

  it('desert / swamp / temperate banks emit genuinely DIFFERENT assemblages', () => {
    const d = kindsFor('desert'), s = kindsFor('swamp'), t = kindsFor('temperate_forest');
    expect([...d]).not.toEqual([...s]);
    expect([...d]).not.toEqual([...t]);
  });

  it('INVARIANT: the STONE set is biome-INDEPENDENT — boulder-deformation re-derives it with no biome map', () => {
    // `boulder-deformation.ts` re-runs this scatter WITHOUT biomes to settle each big bank
    // boulder into a level pad; if a biome could shift the stone rolls the pads would drift
    // off their rocks. Stones must be identical across every biome context, including null.
    const stones = (b: string | null): string[] =>
      buildRiparianEntities(hydro(), W, H, SEED, b === null ? null : allBiome(b))
        .filter((e) => e.kind === 'granite-boulder' || e.kind === 'field-stone')
        .map((e) => `${e.kind}@${e.x.toFixed(4)},${e.y.toFixed(4)}`);
    const base = stones(null);
    expect(base.length).toBeGreaterThan(0);
    for (const b of ['temperate_forest', 'desert', 'swamp', 'mountain']) {
      expect(stones(b)).toEqual(base);
    }
  });
});
