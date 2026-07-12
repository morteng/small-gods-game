import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateWithNoise } from '@/map/map-generator';
import type { GameMap } from '@/core/types';
import type { RoadEdge } from '@/world/road-graph';
import { WaterType, type WorldSeed } from '@/core/types';
import { heightField } from '@/render/gpu/terrain-field';
import { buildRenderWaterTypeMemo, clearRenderWaterTypeCache } from '@/render/gpu/render-water-mask';
import { clearHeightfieldCache } from '@/world/heightfield';
import { clearHydrologyCache } from '@/world/hydrology-store';
import { clearRoadDeformationCache, getWorldDeformationStore } from '@/world/road-deformation';
import {
  makeDetailElevSampler, computeDetailMask, coalescePatches, RECOMMENDED_SLOPE_GRADE,
} from '@/world/terrain-detail';

const seed: WorldSeed = {
  name: 'detail-test', size: { width: 64, height: 64 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

beforeEach(() => {
  clearHeightfieldCache();
  clearHydrologyCache();
  clearRoadDeformationCache();
  clearRenderWaterTypeCache();
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

  it('stays FINITE at fractional coords on an island-shaped world (coast field)', async () => {
    // Regression: an island spec with a dome reads a coast DISTANCE FIELD by integer
    // index; at fractional coords that was `dist[non-integer]` = undefined ⇒ NaN, so
    // the baked patch heights were NaN (invisible). Exercise the island path here.
    const islandSeed: WorldSeed = {
      name: 'isle', size: { width: 80, height: 80 }, biome: 'temperate',
      island: true, pois: [], connections: [], constraints: [],
    };
    const { map } = await generateWithNoise(80, 80, 5, islandSeed);
    const sampler = makeDetailElevSampler(map);
    let allFinite = true;
    for (let y = 4; y < 76; y += 1) {
      for (let x = 4; x < 76; x += 1) {
        const v = sampler(x + 0.5, y + 0.5);
        if (!Number.isFinite(v)) { allFinite = false; break; }
      }
      if (!allFinite) break;
    }
    expect(allFinite).toBe(true);
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
  it('flags only river/lake carves + banks, skips dry land away from water', async () => {
    const { map } = await generateWithNoise(96, 96, 3, { ...seed, size: { width: 96, height: 96 } });
    const W = map.width, H = map.height;
    // The mask keys off the RENDER classification (smooth connectome rivers + lakes),
    // not the raw raster — so assert flagging against that same source of truth.
    const wt = buildRenderWaterTypeMemo(map);
    const mask = computeDetailMask(map, { bankRadius: 2 });
    const isCarve = (i: number): boolean => wt[i] === WaterType.River || wt[i] === WaterType.Lake;

    let hot = 0, cold = 0, carve = 0, carveFlagged = 0;
    for (let i = 0; i < W * H; i++) {
      if (mask[i]) hot++; else cold++;
      if (isCarve(i)) { carve++; if (mask[i]) carveFlagged++; }
    }
    expect(carveFlagged).toBe(carve);                 // every carve cell flagged
    if (carve > 0) {
      expect(hot).toBeGreaterThan(0);
      expect(cold).toBeGreaterThan(hot);              // SPARSE — most of the map is cold
      // A cell with no river/lake within 3 tiles must be cold (water-only mask).
      let checkedDry = false;
      for (let y = 3; y < H - 3 && !checkedDry; y++) {
        for (let x = 3; x < W - 3; x++) {
          let near = false;
          for (let dy = -3; dy <= 3 && !near; dy++)
            for (let dx = -3; dx <= 3; dx++) if (isCarve((y + dy) * W + (x + dx))) { near = true; break; }
          if (!near) { expect(mask[y * W + x]).toBe(0); checkedDry = true; break; }
        }
      }
      expect(checkedDry).toBe(true);
    }
  });

  it('flags river cells (sharp carve)', async () => {
    const { map } = await generateWithNoise(96, 96, 3, { ...seed, size: { width: 96, height: 96 } });
    const wt = buildRenderWaterTypeMemo(map);
    const mask = computeDetailMask(map);
    let riverCells = 0, riverFlagged = 0;
    for (let i = 0; i < wt.length; i++) {
      if (wt[i] === WaterType.River) { riverCells++; if (mask[i]) riverFlagged++; }
    }
    if (riverCells > 0) expect(riverFlagged).toBe(riverCells); // every river cell flagged
  });

  // ── Coverage guarantee: the detail SAMPLER carves the WHOLE deformation store
  //    (pads, wall foundations, levees), so the MASK must cover every one of them or
  //    their sub-tile relief seams against the coarse grid. Exercised on the real
  //    default world, which actually has settlements + walls. ──
  it('covers EVERY pad/wall/levee carve cell — closes the coarse-grid seam gap', async () => {
    const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8'));
    const { map } = await generateWithNoise(ws.size.width, ws.size.height, 12345, ws);
    const W = map.width;
    // The non-road/river carve cells the sampler renders but the legacy passes ignore.
    const cells: Array<{ x: number; y: number }> = [];
    for (const def of getWorldDeformationStore(map).list()) {
      if (def.source === 'road:cut' || def.source === 'river:incision') continue;
      const x0 = Math.max(0, Math.floor(def.bounds.minX)), y0 = Math.max(0, Math.floor(def.bounds.minY));
      const x1 = Math.min(W - 1, Math.ceil(def.bounds.maxX)), y1 = Math.min(map.height - 1, Math.ceil(def.bounds.maxY));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (def.mask(x, y) > 0) cells.push({ x, y });
    }
    expect(cells.length).toBeGreaterThan(0);                 // this world has walls + pads

    const maskNew = computeDetailMask(map);                  // feature pass ON (default)
    const maskOld = computeDetailMask(map, { featureRadius: -1 }); // legacy water+road only
    let uncoveredNew = 0, uncoveredOld = 0;
    for (const { x, y } of cells) {
      if (!maskNew[y * W + x]) uncoveredNew++;
      if (!maskOld[y * W + x]) uncoveredOld++;
    }
    expect(uncoveredNew).toBe(0);                            // coverage ⊇ every carve
    expect(uncoveredOld).toBeGreaterThan(0);                 // …and the gap was real
  }, 60_000);  // full default-world gen legitimately exceeds the 5 s default

  // ── Roads carve a corridor just like rivers; the fine mesh must follow it too. ──
  const W = 32, H = 32;
  const STRAIGHT = Array.from({ length: 16 }, (_, i) => ({ x: 8 + i, y: 16 }));
  const roadMap = (edges: RoadEdge[]): GameMap =>
    ({ seed: 1234, width: W, height: H, roadGraph: { nodes: [], edges } } as unknown as GameMap);
  const roadEdge = (id: string, polyline: { x: number; y: number }[]): RoadEdge =>
    ({ id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [] } as RoadEdge);
  // Isolate the road branch: feed an all-water-free classification so only roads flag.
  const noWater = new Uint8Array(W * H);

  it('flags road-corridor cells (grade-cut shoulders get the fine mesh)', () => {
    const map = roadMap([roadEdge('e1', STRAIGHT)]);
    const mask = computeDetailMask(map, { waterType: noWater });
    // The carriageway centre is flagged…
    expect(mask[16 * W + 14]).toBe(1);
    // …and a cell far from the road is cold (still sparse).
    expect(mask[2 * W + 2]).toBe(0);
    let hot = 0;
    for (let i = 0; i < W * H; i++) if (mask[i]) hot++;
    expect(hot).toBeGreaterThan(0);
    expect(hot).toBeLessThan(W * H); // SPARSE — not the whole map
  });

  it('with NO road graph the same map is entirely cold (water suppressed)', () => {
    const map = ({ seed: 1234, width: W, height: H } as unknown as GameMap);
    const mask = computeDetailMask(map, { waterType: noWater });
    expect(mask.some((v) => v === 1)).toBe(false);
  });

  it('roadRadius < 0 opts out of road detail', () => {
    const map = roadMap([roadEdge('e1', STRAIGHT)]);
    const mask = computeDetailMask(map, { waterType: noWater, roadRadius: -1 });
    expect(mask.some((v) => v === 1)).toBe(false);
  });

  it('is deterministic for roads — same graph ⇒ identical mask', () => {
    const a = computeDetailMask(roadMap([roadEdge('e1', STRAIGHT)]), { waterType: noWater });
    const b = computeDetailMask(roadMap([roadEdge('e1', STRAIGHT)]), { waterType: noWater });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  // ── Steep-slope flagging is OPT-IN (default off): noise-dominated terrain makes it
  //    flood or sprinkle rather than select real faces, so it must not fire by default. ──
  it('does NOT flag steep slopes by default (opt-in only)', async () => {
    const { map } = await generateWithNoise(96, 96, 3, { ...seed, size: { width: 96, height: 96 } });
    const W = map.width, H = map.height;
    const dryNoWater = new Uint8Array(W * H);
    // Water + roads + deformation features all suppressed → the ONLY thing that could
    // flag is slope. (featureRadius must be off too: a generated world legitimately
    // carries deformation footprints — R5 boulder settle pads — that the feature pass
    // correctly flags.)
    const dflt = computeDetailMask(map, { waterType: dryNoWater, roadRadius: -1, featureRadius: -1 });
    const off = computeDetailMask(map, { waterType: dryNoWater, roadRadius: -1, featureRadius: -1, slopeGrade: Infinity });
    expect(Array.from(dflt)).toEqual(Array.from(off));   // default === explicitly-off
    expect(off.some((v) => v === 1)).toBe(false);        // nothing flagged
  });

  it('flags steep ground when slope detail is opted in', async () => {
    const { map } = await generateWithNoise(96, 96, 3, { ...seed, size: { width: 96, height: 96 } });
    const W = map.width, H = map.height;
    const dryNoWater = new Uint8Array(W * H);
    const on = computeDetailMask(map, { waterType: dryNoWater, roadRadius: -1, slopeGrade: RECOMMENDED_SLOPE_GRADE });
    let hot = 0;
    for (let i = 0; i < on.length; i++) if (on[i]) hot++;
    expect(hot).toBeGreaterThan(0);        // the opt-in pass does flag steep cells
    expect(hot).toBeLessThan(W * H);       // …but not the entire map
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
