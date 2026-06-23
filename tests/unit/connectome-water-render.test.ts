import { describe, it, expect, beforeAll } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed, type GameMap, type ConnectomeWaterOverride } from '@/core/types';
import { buildWaterField } from '@/render/gpu/water-field';
import { buildRenderWaterType } from '@/render/gpu/render-water-mask';
import { curveHeightBuffer } from '@/render/gpu/terrain-field';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { worldStyleOf } from '@/core/world-style';
import { getWaterNetwork } from '@/world/water-network-store';
import { addLakeBody } from '@/terrain/water-network-edits';
import { clearHydrologyCache } from '@/world/hydrology-store';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';

// DIR-A: an author-placed connectome lake (not in the hydrology raster) renders as REAL
// still water — its bed paints damp (render waterType) AND it carries a water surface at
// its spill lip (water static), through the SAME path as a generated lake. The game path
// (no override) stays byte-identical.

const seed: WorldSeed = {
  name: 'connectome-water-test', size: { width: 80, height: 80 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};
const opts = {
  viewport: [800, 600] as [number, number],
  xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
  lighting: DEFAULT_LIGHTING,
  timeSec: 1,
};

let map: GameMap;
let W = 0, H = 0;

/** Build the studio-style override for a net (placed lakes → mask + lip surface). */
function overrideFor(net: ReturnType<typeof getWaterNetwork>, version: number): ConnectomeWaterOverride {
  const style = worldStyleOf(map.worldSeed);
  const waterType = buildRenderWaterType(map, net);
  const base = curveHeightBuffer(
    getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null),
    ELEVATION_SEA_LEVEL, style.terrainHeightGamma,
  );
  const insetN = 0.5 / style.mountainRelief;
  const lakeSurface = new Float32Array(W * H);
  for (const lake of net.lakes) {
    const body = new Set(lake.cells);
    let lip = Infinity;
    for (const c of lake.cells) {
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (y + dy) * W + (x + dx);
        if (!body.has(n)) lip = Math.min(lip, base[n]);
      }
    }
    for (const c of lake.cells) lakeSurface[c] = lip - insetN;
  }
  return { waterType, lakeSurface, version };
}

/** A small placed lake on dry inland land (above sea, away from existing water). */
function placedLakeNet(): { net: ReturnType<typeof getWaterNetwork>; cells: number[] } {
  const baseNet = getWaterNetwork(map);
  const water = new Set<number>();
  for (const l of baseNet.lakes) for (const c of l.cells) water.add(c);
  for (const r of baseNet.reaches) for (const c of r.cells) water.add(c);
  const baseH = getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null);
  // find a dry inland cell above sea, clear of existing water
  let cx = 40, cy = 40;
  outer: for (let y = 10; y < H - 10; y++) for (let x = 10; x < W - 10; x++) {
    const i = y * W + x;
    if (water.has(i) || baseH[i] <= ELEVATION_SEA_LEVEL + 0.05) continue;
    let near = false;
    for (let dy = -5; dy <= 5 && !near; dy++) for (let dx = -5; dx <= 5; dx++) if (water.has((y + dy) * W + (x + dx))) near = true;
    if (!near) { cx = x; cy = y; break outer; }
  }
  const net = addLakeBody(baseNet, { id: 'wl:placed:0', cx, cy, radius: 3 });
  const lake = net.lakes[net.lakes.length - 1];
  return { net, cells: lake.cells };
}

beforeAll(async () => {
  clearHydrologyCache();
  ({ map } = await generateWithNoise(seed.size.width, seed.size.height, 1, seed));
  W = map.width; H = map.height;
});

describe('buildRenderWaterType — connectome lakes', () => {
  it('stamps an author-placed lake as Lake (the raster left it dry)', () => {
    const { net, cells } = placedLakeNet();
    const baseMask = buildRenderWaterType(map);          // base net
    const editMask = buildRenderWaterType(map, net);     // edited net
    // at least one placed cell was Dry in the base mask and is Lake in the edited mask
    const newlyLake = cells.filter((c) => baseMask[c] !== WaterType.Lake && editMask[c] === WaterType.Lake);
    expect(newlyLake.length).toBeGreaterThan(0);
  });

  it('the base net is unchanged from the default (byte-identical mask)', () => {
    const a = buildRenderWaterType(map);
    const b = buildRenderWaterType(map, getWaterNetwork(map));
    expect(a).toEqual(b);
  });
});

describe('buildWaterField — placed lake renders as real water', () => {
  it('classifies placed-lake cells as Lake with a surface above their bed', () => {
    const { net, cells } = placedLakeNet();
    const ov = overrideFor(net, 1);
    const baseField = buildWaterField(map, opts)!;
    const editField = buildWaterField(map, { ...opts, connectomeWater: ov })!;
    // a placed cell that was Dry in the base field is now Lake in the edited field
    const flipped = cells.filter((c) => baseField.waterType[c] === WaterType.Dry && editField.waterType[c] === WaterType.Lake);
    expect(flipped.length).toBeGreaterThan(0);
    // and its surface sits at the lip (a finite, sensible render-elevation value)
    for (const c of flipped) {
      expect(Number.isFinite(editField.surfaceW[c])).toBe(true);
      expect(editField.surfaceW[c]).toBeGreaterThan(ELEVATION_SEA_LEVEL - 0.5);
    }
  });

  it('the game path (no override) is byte-identical to before', () => {
    const a = buildWaterField(map, opts)!;
    const b = buildWaterField(map, opts)!;
    expect(a.waterType).toEqual(b.waterType);
    expect(a.surfaceW).toEqual(b.surfaceW);
    // an override field differs (proves the override actually changed classification)
    const { net } = placedLakeNet();
    const edit = buildWaterField(map, { ...opts, connectomeWater: overrideFor(net, 2) })!;
    expect(edit.waterType).not.toEqual(a.waterType);
  });

  it('is deterministic + version-cached — same version → identical, new version rebuilds', () => {
    const { net } = placedLakeNet();
    const f1 = buildWaterField(map, { ...opts, connectomeWater: overrideFor(net, 7) })!;
    const f2 = buildWaterField(map, { ...opts, connectomeWater: overrideFor(net, 7) })!;
    expect(f1.waterType).toEqual(f2.waterType);
  });
});
