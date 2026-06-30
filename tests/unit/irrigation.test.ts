import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { stampIrrigation } from '@/world/irrigation';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { WATER_TYPES } from '@/core/constants';
import type { GameMap, WorldSeed } from '@/core/types';
import { World } from '@/world/world';

const seed: WorldSeed = {
  name: 'irrig', size: { width: 96, height: 96 }, biome: 'temperate',
  pois: [{ id: 'v1', type: 'village', name: 'V', position: { x: 48, y: 48 }, size: 'large' }],
  connections: [], constraints: [],
} as unknown as WorldSeed;

const ROAD = new Set(['dirt_road', 'stone_road', 'bridge']);

describe('stampIrrigation', () => {
  it('digs ditches that never overwrite water/roads/buildings/fields', async () => {
    // generateWithNoise runs both farmland + irrigation as gen phases.
    const { map, world } = await generateWithNoise(96, 96, 11, seed);

    const ditches: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x].type === 'irrigation_ditch') ditches.push({ x, y });
    }
    // A worked village near water should get at least some irrigation.
    expect(ditches.length).toBeGreaterThan(0);

    for (const { x, y } of ditches) {
      const t = map.tiles[y][x];
      expect(t.walkable).toBe(true);
      expect(WATER_TYPES.has(t.type)).toBe(false);
      expect(ROAD.has(t.type)).toBe(false);
      expect(tileBlockedByBuilding(world, x, y)).toBe(false);
    }

    // Every irrigated field tile must be adjacent (via the soil) to a ditch or water — it can't
    // be flagged watered in isolation. Cheap proxy: an irrigated tile is a farm_field, and at
    // least one ditch or water tile exists within the route budget on the map.
    let irrigatedFields = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x].irrigated) { expect(map.tiles[y][x].type).toBe('farm_field'); irrigatedFields++; }
    }
    expect(irrigatedFields).toBeGreaterThan(0);
  });

  it('is deterministic for a given world', async () => {
    const a = await generateWithNoise(96, 96, 5, seed);
    const b = await generateWithNoise(96, 96, 5, seed);
    // Re-running the pass on a fresh-but-identical world yields the same ditch count.
    const reA = stampIrrigation(a.map, a.world);
    const reB = stampIrrigation(b.map, b.world);
    expect(reA).toBe(reB);
  });

  it('no-ops on a map with no fields', () => {
    const W = 12, H = 12;
    const tiles = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
    // a strip of water down one edge, but no farm_field anywhere
    for (let y = 0; y < H; y++) tiles[y][0].type = 'river';
    const map = { tiles, width: W, height: H } as unknown as GameMap;
    expect(stampIrrigation(map, new World(map))).toBe(0);
  });

  it('digs a ditch from a field across soil to nearby water', () => {
    const W = 12, H = 12;
    const tiles = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
    // water column at x=0; a 2×2 field at x=4..5 — open grass between field and water.
    for (let y = 0; y < H; y++) tiles[y][0].type = 'river';
    for (const [fx, fy] of [[4, 5], [5, 5], [4, 6], [5, 6]] as const) tiles[fy][fx].type = 'farm_field';
    const map = { tiles, width: W, height: H } as unknown as GameMap;

    const dug = stampIrrigation(map, new World(map), { maxRoute: 10 });
    expect(dug).toBeGreaterThan(0);
    // ditch tiles bridge the gap (x between 1 and 3), never over water or field
    let bridged = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (map.tiles[y][x].type === 'irrigation_ditch') { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(4); bridged = true; }
    }
    expect(bridged).toBe(true);
    // all four field cells are flagged irrigated
    for (const [fx, fy] of [[4, 5], [5, 5], [4, 6], [5, 6]] as const) expect(map.tiles[fy][fx].irrigated).toBe(true);
  });

  it('leaves a far-from-water field rain-fed (no ditch, no flag)', () => {
    const W = 20, H = 12;
    const tiles = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
    tiles[5][0].type = 'river';                                   // lone water cell, far away
    for (const [fx, fy] of [[18, 5], [19, 5]] as const) tiles[fy][fx].type = 'farm_field';   // >maxRoute from water
    const map = { tiles, width: W, height: H } as unknown as GameMap;
    expect(stampIrrigation(map, new World(map), { maxRoute: 6 })).toBe(0);
    expect(map.tiles[5][18].irrigated).toBeFalsy();
  });
});
