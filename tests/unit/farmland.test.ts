import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { stampFarmland } from '@/world/farmland';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { WATER_TYPES } from '@/core/constants';
import type { Entity, WorldSeed } from '@/core/types';

const seed: WorldSeed = {
  name: 'farm-patch', size: { width: 96, height: 96 }, biome: 'temperate',
  pois: [{ id: 'v1', type: 'village', name: 'V', position: { x: 48, y: 48 }, size: 'large' }],
  connections: [], constraints: [],
} as unknown as WorldSeed;

const ROAD = new Set(['dirt_road', 'stone_road', 'bridge']);

describe('stampFarmland', () => {
  it('paints farm_field around farm buildings, never over water/roads/buildings', async () => {
    // generateWithNoise now stamps farmland as a gen phase, so the world ships with fields.
    // Seed 23 puts the village on farmable ground (2 farms / ~32 fields). We avoid the old
    // seed 42: it drops the large village onto a river floodplain (seat ~90% under water),
    // a degenerate world whose farm count teeters on the exact river path — it flips 0↔3 on
    // any river-geometry change and tested flood luck, not the farm-placement invariants below.
    const { map, world } = await generateWithNoise(96, 96, 23, seed);
    expect((world.query({ tag: 'farm' }) as Entity[]).length).toBeGreaterThan(0);
    const fields: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x].type === 'farm_field') fields.push({ x, y });
    }
    expect(fields.length).toBeGreaterThan(0);

    for (const { x, y } of fields) {
      const t = map.tiles[y][x];
      expect(t.walkable).toBe(true);                         // fields are walkable ground
      expect(WATER_TYPES.has(t.type)).toBe(false);
      expect(ROAD.has(t.type)).toBe(false);
      expect(tileBlockedByBuilding(world, x, y)).toBe(false);  // never under a building
      // Every field sits within reach of some farm (it's that farm's land).
      const nearFarm = (world.query({ tag: 'farm' }) as Entity[])
        .some((f) => Math.abs(f.x - x) <= 12 && Math.abs(f.y - y) <= 12);
      expect(nearFarm).toBe(true);
    }
  }, 30_000);

  it('is deterministic for a given world', async () => {
    const a = await generateWithNoise(96, 96, 7, seed);
    const b = await generateWithNoise(96, 96, 7, seed);
    expect(stampFarmland(a.map, a.world)).toBe(stampFarmland(b.map, b.world));
  }, 30_000);

  it('no-ops on a world with no farms', async () => {
    const noPoi = { ...seed, pois: [] } as unknown as WorldSeed;
    const { map, world } = await generateWithNoise(64, 64, 1, noPoi);
    expect(stampFarmland(map, world)).toBe(0);
  });
});
