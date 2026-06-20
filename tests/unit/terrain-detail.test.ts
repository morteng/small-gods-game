import { describe, it, expect, beforeEach } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed } from '@/core/types';
import { heightField } from '@/render/gpu/terrain-field';
import { getHeightfield, ELEVATION_SEA_LEVEL, clearHeightfieldCache } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { getHydrologyResult, clearHydrologyCache } from '@/world/hydrology-store';
import { clearRoadDeformationCache } from '@/world/road-deformation';
import {
  makeDetailElevSampler, computeDetailMask, coalescePatches,
} from '@/world/terrain-detail';

const seed: WorldSeed = {
  name: 'detail-test', size: { width: 64, height: 64 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

beforeEach(() => {
  clearHeightfieldCache();
  clearHydrologyCache();
  clearRoadDeformationCache();
});

describe('makeDetailElevSampler', () => {
  it('is byte-identical to the coarse height buffer at INTEGER coords (perfect seam)', async () => {
    const { map } = await generateWithNoise(64, 64, 7, seed);
    const sampler = makeDetailElevSampler(map);
    const coarse = heightField(map); // the exact buffer the coarse mesh lifts
    let maxErr = 0;
    for (let y = 1; y < 63; y++) {
      for (let x = 1; x < 63; x++) {
        const err = Math.abs(sampler(x, y) - coarse[y * 64 + x]);
        if (err > maxErr) maxErr = err;
      }
    }
    expect(maxErr).toBeLessThan(1e-5);
  });

  it('adds GENUINE sub-tile relief — half-tile samples deviate from a bilinear interpolant', async () => {
    const { map } = await generateWithNoise(64, 64, 7, seed);
    const sampler = makeDetailElevSampler(map);
    const coarse = heightField(map);
    // Compare the sampler at tile centres against the pure bilinear midpoint of the
    // four coarse corners. A bilinear-only upsample would make these equal; the
    // analytic residual must push them apart somewhere (real new detail).
    let maxDev = 0;
    for (let y = 1; y < 62; y++) {
      for (let x = 1; x < 62; x++) {
        const c00 = coarse[y * 64 + x], c10 = coarse[y * 64 + x + 1];
        const c01 = coarse[(y + 1) * 64 + x], c11 = coarse[(y + 1) * 64 + x + 1];
        const bilinMid = (c00 + c10 + c01 + c11) / 4;
        const dev = Math.abs(sampler(x + 0.5, y + 0.5) - bilinMid);
        if (dev > maxDev) maxDev = dev;
      }
    }
    // Normalised elevation; a clearly non-trivial sub-tile signal.
    expect(maxDev).toBeGreaterThan(1e-3);
  });

  it('is deterministic — same world ⇒ identical samples', async () => {
    const a = await generateWithNoise(64, 64, 7, seed);
    const sa = makeDetailElevSampler(a.map);
    const b = await generateWithNoise(64, 64, 7, seed);
    const sb = makeDetailElevSampler(b.map);
    for (const [x, y] of [[10.3, 20.7], [33.5, 41.25], [50.9, 12.1]]) {
      expect(sa(x, y)).toBeCloseTo(sb(x, y), 10);
    }
  });
});

describe('computeDetailMask', () => {
  it('flags the coastline band and steep ground, skips the flat deep interior', async () => {
    const { map } = await generateWithNoise(64, 64, 7, seed);
    const mask = computeDetailMask(map);
    // Recompute the base field via the same path the module uses, to classify
    // reference cells (coastline / deep-flat).
    const hf = getHeightfield(map.seed, 64, 64, styledIslandSpec(map.worldSeed), null);

    let hot = 0, cold = 0, coastHotAll = true, deepFlatHotAny = false;
    for (let y = 2; y < 62; y++) {
      for (let x = 2; x < 62; x++) {
        const idx = y * 64 + x;
        if (mask[idx]) hot++; else cold++;
        const e = hf[idx];
        // A cell right at the waterline must be flagged (crisp shore matters).
        if (Math.abs(e - ELEVATION_SEA_LEVEL) < 0.01 && !mask[idx]) coastHotAll = false;
        // A deep, flat-surrounded ocean cell should generally NOT be flagged.
        const xl = hf[idx - 1], xr = hf[idx + 1], yu = hf[idx - 64], yd = hf[idx + 64];
        const flat = Math.abs(xr - xl) + Math.abs(yd - yu) < 0.005;
        if (e < ELEVATION_SEA_LEVEL - 0.12 && flat && mask[idx]) deepFlatHotAny = true;
      }
    }
    expect(hot).toBeGreaterThan(0);             // some detail wanted
    expect(cold).toBeGreaterThan(0);            // but not everywhere (adaptive)
    expect(coastHotAll).toBe(true);             // every waterline cell flagged
    expect(deepFlatHotAny).toBe(false);         // flat abyssal interior skipped
  });

  it('flags river cells (sharp carve)', async () => {
    const { map } = await generateWithNoise(96, 96, 3, { ...seed, size: { width: 96, height: 96 } });
    const wt = getHydrologyResult(map).waterType;
    const mask = computeDetailMask(map);
    let riverCells = 0, riverFlagged = 0;
    for (let i = 0; i < wt.length; i++) {
      if (wt[i] === WaterType.River) { riverCells++; if (mask[i]) riverFlagged++; }
    }
    if (riverCells > 0) expect(riverFlagged).toBe(riverCells); // every river cell flagged
  });
});

describe('coalescePatches', () => {
  it('emits a patch per block containing a hot cell, skips empty blocks', () => {
    const W = 32, H = 32;
    const mask = new Uint8Array(W * H);
    mask[0] = 1;                       // block (0,0)
    mask[20 * W + 20] = 1;             // block (16,16)
    const patches = coalescePatches(mask, W, H, 16);
    expect(patches).toHaveLength(2);
    expect(patches).toContainEqual({ ox: 0, oy: 0, w: 16, h: 16 });
    expect(patches).toContainEqual({ ox: 16, oy: 16, w: 16, h: 16 });
  });

  it('clamps edge blocks to the map bounds', () => {
    const W = 20, H = 20;
    const mask = new Uint8Array(W * H).fill(1);
    const patches = coalescePatches(mask, W, H, 16);
    // 2×2 blocks; the far ones are 4 tiles wide/tall.
    expect(patches).toHaveLength(4);
    expect(patches).toContainEqual({ ox: 16, oy: 16, w: 4, h: 4 });
  });
});
