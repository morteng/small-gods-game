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
