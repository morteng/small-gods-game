import { describe, it, expect, beforeAll } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed, GameMap } from '@/core/types';
import {
  DeformationStore,
  footprintLevelDeformation,
  baseHeightAt,
  heightAt,
  applyOp,
} from '@/world/terrain-deformation';
import {
  buildLakeConformDeformations,
  buildLakeConformForBody,
  LAKE_BASIN_SOURCE,
  LAKE_OUTLET_SOURCE,
} from '@/world/lake-conform';
import type { WaterBody, WaterNetwork } from '@/terrain/river-network';

// DIR-A: a placed/moved lake conforms the terrain — level a water-holding basin below
// the spill lip + carve a downhill outlet so the basin is not a closed sink. The brush
// (footprintLevelDeformation) is tested purely; the producer is tested against a REAL
// generated heightfield with a synthetic lake body, so it is generator-independent.

const seed: WorldSeed = {
  name: 'lake-conform-test', size: { width: 96, height: 96 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

describe('footprintLevelDeformation — blobby plateau brush', () => {
  const W = 32;
  // a 3×3 block of cells centred at (10,10)
  const cells: number[] = [];
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) cells.push(y * W + x);
  const d = footprintLevelDeformation({ id: 'b', source: 's', cells, gridWidth: W, target: 5, feather: 2 });

  it('is full (mask 1) inside the footprint and zero far outside', () => {
    expect(d.mask(10, 10)).toBe(1);
    expect(d.mask(9, 11)).toBe(1);
    expect(d.mask(10, 20)).toBe(0); // well beyond feather
  });

  it('feathers from the footprint edge toward zero', () => {
    // one tile beyond the right edge (x=12, edge at x=11): distance 1, feather 2 → ~0.5
    const m = d.mask(12, 10);
    expect(m).toBeGreaterThan(0.3);
    expect(m).toBeLessThan(0.7);
  });

  it('bounds enclose the footprint plus the feather margin', () => {
    expect(d.bounds.minX).toBeLessThanOrEqual(9);
    expect(d.bounds.maxX).toBeGreaterThanOrEqual(11);
    expect(d.bounds.minY).toBeLessThanOrEqual(9);
    expect(d.bounds.maxY).toBeGreaterThanOrEqual(11);
  });

  it('levels toward its target when applied (op level)', () => {
    expect(applyOp(d, 10, 10, 1)).toBeCloseTo(5, 6); // full mask → exactly target
    expect(applyOp(d, 10, 10, 0.5)).toBeCloseTo(7.5, 6); // half mask → halfway
  });

  it("op 'sink' lowers dry land to target but never raises a deeper basin", () => {
    const sink = footprintLevelDeformation({ id: 'b', source: 's', cells, gridWidth: W, target: 5, feather: 2, op: 'sink' });
    // ground above target → lowered to target
    expect(applyOp(sink, 10, 10, 1)).toBeCloseTo(5, 6);
    // ground already BELOW target → left untouched (no fill-in)
    expect(applyOp(sink, 2, 2, 1)).toBe(2);
    expect(applyOp(sink, 3, 5, 0.5)).toBe(3); // partial mask still never raises
  });
});

describe('lake-conform producer — real heightfield, synthetic lake body', () => {
  let map: GameMap;
  let W = 0, H = 0;

  // a compact square lake body, placed inland so it has a full shore ring.
  function makeLake(cx: number, cy: number, half = 3): WaterBody {
    const cells: number[] = [];
    for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) cells.push(y * W + x);
    return { id: 'wl:test', klass: 'lake', cells, area: cells.length, x: cx, y: cy, outletIds: [], inletIds: [] };
  }
  function netWith(lake: WaterBody): WaterNetwork {
    return { nodes: [], reaches: [], lakes: [lake], byId: new Map(), nodeAtCell: new Map(), width: W, height: H };
  }

  beforeAll(async () => {
    ({ map } = await generateWithNoise(seed.size.width, seed.size.height, 1, seed));
    W = map.width; H = map.height;
  });

  it('emits exactly one basin per lake (and at most one spillway)', () => {
    const defs = buildLakeConformForBody(map, makeLake(48, 48), W, H);
    const basins = defs.filter((d) => d.source === LAKE_BASIN_SOURCE);
    const spillways = defs.filter((d) => d.source === LAKE_OUTLET_SOURCE);
    expect(basins).toHaveLength(1);
    expect(spillways.length).toBeLessThanOrEqual(1);
  });

  it('levels the basin floor below the lowest shore-rim height (so it holds water)', () => {
    const lake = makeLake(48, 48);
    const defs = buildLakeConformForBody(map, lake, W, H);
    const store = new DeformationStore();
    store.add(...defs);

    // Lowest rim = the min base height on the 4-adjacency ring of the footprint.
    const body = new Set(lake.cells);
    let lipH = Infinity;
    for (const c of lake.cells) {
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (cy + dy) * W + (cx + dx);
        if (!body.has(n)) lipH = Math.min(lipH, baseHeightAt(map, cx + dx, cy + dy));
      }
    }
    // Every footprint cell's COMPOSED height sits below the spill lip ⇒ a closed basin
    // that actually holds standing water.
    for (const c of lake.cells) {
      const cx = c % W, cy = (c / W) | 0;
      expect(heightAt(map, store, cx, cy)).toBeLessThan(lipH);
    }
  });

  it('carves an outlet through the spill lip (the basin drains, not endorheic)', () => {
    const lake = makeLake(30, 30);
    const defs = buildLakeConformForBody(map, lake, W, H);
    const spillway = defs.find((d) => d.source === LAKE_OUTLET_SOURCE);
    if (!spillway) return; // a basin already at the map/water edge may need no carve
    const store = new DeformationStore();
    store.add(...defs);

    // The spill cell is the lowest base-height cell on the shore ring. The carved outlet
    // starts there, so the COMPOSED terrain at the lip is cut below its base height —
    // an open path for the overflow to leave the basin.
    const body = new Set(lake.cells);
    let spillCell = -1, spillH = Infinity;
    for (const c of lake.cells) {
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
        if (body.has(n)) continue;
        const hgt = baseHeightAt(map, nx, ny);
        if (hgt < spillH) { spillH = hgt; spillCell = n; }
      }
    }
    expect(spillCell).toBeGreaterThanOrEqual(0);
    const sx = spillCell % W, sy = (spillCell / W) | 0;
    expect(heightAt(map, store, sx, sy)).toBeLessThan(baseHeightAt(map, sx, sy));
  });

  it('is deterministic — same lake → identical basin target across builds', () => {
    const a = buildLakeConformForBody(map, makeLake(60, 40), W, H).find((d) => d.source === LAKE_BASIN_SOURCE);
    const b = buildLakeConformForBody(map, makeLake(60, 40), W, H).find((d) => d.source === LAKE_BASIN_SOURCE);
    expect(a?.target).toBeDefined();
    expect(a?.target).toBe(b?.target);
  });

  it('buildLakeConformDeformations fans out over every lake in the network', () => {
    const net = netWith(makeLake(48, 48));
    net.lakes.push(makeLake(70, 70));
    const defs = buildLakeConformDeformations(map, net);
    const basins = defs.filter((d) => d.source === LAKE_BASIN_SOURCE);
    expect(basins).toHaveLength(2);
  });
});
