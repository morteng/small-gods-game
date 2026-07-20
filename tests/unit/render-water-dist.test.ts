import { describe, it, expect, beforeAll } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed, type GameMap } from '@/core/types';
import {
  getRenderWaterDist, getRenderWaterMask, clearRenderWaterDistCache, WATER_DIST_CAP,
} from '@/world/render-water';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { getWaterNetwork } from '@/world/water-network-store';
import { referenceFlow, reachHalfWidths } from '@/terrain/river-network';
import { canStandAtPoint, EMERGENT_BAND_TILES } from '@/world/water-habitat';

// The CONTINUOUS render-water distance is the sub-tile view of the SAME drawn-water
// truth as the cell mask: same network, same per-vertex half-widths. These tests pin
// the two views to each other on a real generated world, then pin the point-habitat
// contract on synthetic distances.

const seed: WorldSeed = {
  name: 'render-water-dist-test', size: { width: 80, height: 80 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

let map: GameMap;

beforeAll(async () => {
  clearRenderWaterDistCache();
  ({ map } = await generateWithNoise(80, 80, 12345, seed));
});

describe('getRenderWaterDist — continuous signed distance to the drawn water', () => {
  it('is clamped to ±WATER_DIST_CAP everywhere', () => {
    const dist = getRenderWaterDist(map);
    for (let y = 0; y < map.height; y += 7) {
      for (let x = 0; x < map.width; x += 7) {
        const d = dist(x + 0.31, y + 0.77);
        expect(d).toBeGreaterThanOrEqual(-WATER_DIST_CAP);
        expect(d).toBeLessThanOrEqual(WATER_DIST_CAP);
      }
    }
  });

  it('is negative ON every reach centreline vertex (the middle of the drawn stream)', () => {
    const dist = getRenderWaterDist(map);
    const net = getWaterNetwork(map);
    let checked = 0;
    for (const reach of net.reaches) {
      for (const p of reach.centerline) {
        if (p.x < 1 || p.y < 1 || p.x > map.width - 2 || p.y > map.height - 2) continue;
        expect(dist(p.x, p.y)).toBeLessThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);   // the world genuinely has rivers
  });

  it('tracks the per-vertex half-width: on the centreline, depth ≈ the channel half-width', () => {
    const dist = getRenderWaterDist(map);
    const net = getWaterNetwork(map);
    const refFlow = referenceFlow(net);
    let checked = 0;
    for (const reach of net.reaches) {
      const hw = reachHalfWidths(reach, refFlow);
      reach.centerline.forEach((p, i) => {
        if (p.x < 2 || p.y < 2 || p.x > map.width - 3 || p.y > map.height - 3) return;
        // ≤ because a wider neighbouring segment / lake can only deepen the union.
        expect(dist(p.x, p.y)).toBeLessThanOrEqual(-hw[i] * 0.75 + 0.02);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('agrees with the cell mask on interior water and interior dry ground', () => {
    const dist = getRenderWaterDist(map);
    const isWater = getRenderWaterMask(map);
    const wt = buildRenderWaterTypeMemo(map);
    let wetChecked = 0, dryChecked = 0;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        const n4Wet = isWater(x - 1, y) && isWater(x + 1, y) && isWater(x, y - 1) && isWater(x, y + 1);
        const n4Dry = !isWater(x - 1, y) && !isWater(x + 1, y) && !isWater(x, y - 1) && !isWater(x, y + 1);
        const t = wt[y * map.width + x];
        // INTERIOR area water (lake/ocean surrounded by water) must read submerged. River
        // cells are excluded: the stamp is the CEILING quantization of the swath (a cell is
        // stamped when its centre is within max(0.5, halfWidth)), so a stamped stream cell's
        // centre can legitimately sit on drawn-dry ground — that gap is this field's point.
        if (isWater(x, y) && n4Wet && (t === WaterType.Lake || t === WaterType.Ocean)) {
          expect(dist(x + 0.5, y + 0.5)).toBeLessThan(0);
          wetChecked++;
        }
        // Interior dry ground (no wet neighbour) at least half a tile from any drawn water.
        if (!isWater(x, y) && n4Dry) {
          expect(dist(x + 0.5, y + 0.5)).toBeGreaterThan(-0.5);
          dryChecked++;
        }
      }
    }
    expect(wetChecked).toBeGreaterThan(5);
    expect(dryChecked).toBeGreaterThan(100);
  });

  it('memoises per (seed, dims): repeated calls return the same closure result', () => {
    const a = getRenderWaterDist(map);
    const b = getRenderWaterDist(map);
    expect(a(40.25, 40.75)).toBe(b(40.25, 40.75));
  });
});

describe('canStandAtPoint — the habitat contract at continuous resolution', () => {
  const grassMap = {
    tiles: [[{ type: 'grass' }], [{ type: 'grass' }]],
  } as unknown as GameMap;
  const deepMap = {
    tiles: [[{ type: 'deep_water' }]],
  } as unknown as GameMap;

  it('dry ground holds anything', () => {
    const dry = () => 1.2;
    expect(canStandAtPoint(grassMap, 'tussock-grass', [], 0.5, 0.5, dry)).toBe(true);
    expect(canStandAtPoint(grassMap, 'boulder', [], 0.5, 0.5, dry)).toBe(true);
  });

  it('LAND species never stand under the drawn water — even barely under', () => {
    const barelyWet = () => -0.05;
    expect(canStandAtPoint(grassMap, 'tussock-grass', [], 0.5, 0.5, barelyWet)).toBe(false);
    expect(canStandAtPoint(grassMap, 'heather', [], 0.5, 0.5, barelyWet)).toBe(false);
    expect(canStandAtPoint(grassMap, 'boulder', [], 0.5, 0.5, barelyWet)).toBe(false);
  });

  it('EMERGENT species wade the fringe but not past the band, and never deep tiles', () => {
    const fringe = () => -(EMERGENT_BAND_TILES - 0.1);
    const past = () => -(EMERGENT_BAND_TILES + 0.1);
    expect(canStandAtPoint(grassMap, 'common-reed', [], 0.5, 0.5, fringe)).toBe(true);
    expect(canStandAtPoint(grassMap, 'common-reed', [], 0.5, 0.5, past)).toBe(false);
    expect(canStandAtPoint(deepMap, 'common-reed', [], 0.5, 0.5, fringe)).toBe(false);
  });

  it('water-placed riffle boulders are deliberate and stay', () => {
    const deep = () => -2;
    expect(canStandAtPoint(grassMap, 'boulder', ['waterPlaced'], 0.5, 0.5, deep)).toBe(true);
  });
});
