import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';
import type { GameMap } from '@/core/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function gridTiles(w: number, h: number) {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' as const });
    }
    tiles.push(row);
  }
  return tiles;
}

describe('descriptor building indexing', () => {
  it('registers every footprint cell in the registry tile index', () => {
    const world = new World(emptyMap());
    const d = synthesizeFromPreset('cottage')!;       // 3x3
    world.addEntity(buildingEntity('b1', d, 5, 5));
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const at = world.registry.getAtTile(5 + dx, 5 + dy).map(e => e.id);
        expect(at, `cell ${5 + dx},${5 + dy}`).toContain('b1');
      }
    }
    expect(world.registry.getAtTile(8, 8).map(e => e.id)).not.toContain('b1');
  });
});

describe('placeSettlement produces descriptor entities', () => {
  it('every placed building carries a descriptor and is tagged building', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-v', type: 'village', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('village'), tiles, world.registry, [], new Random(1234), 'medieval', world,
    );
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(e.tags).toContain('building');
      const d = e.properties?.descriptor as BuildingDescriptor | undefined;
      expect(d, e.id).toBeDefined();
      expect(d!.footprint.w).toBeGreaterThan(0);
    }
  });

  it('leaves each building door tile walkable but the rest of the footprint solid', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-v', type: 'village', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('village'), tiles, world.registry, [], new Random(7), 'medieval', world,
    );
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      const d = e.properties!.descriptor as BuildingDescriptor;
      const fp = d.footprint;
      const doorTile = tiles[e.y + d.door.y][e.x + d.door.x];
      expect(doorTile.walkable, `${e.id} door`).toBe(true);
      // find a non-door footprint cell and confirm it is solid
      let checkedSolid = false;
      for (let dy = 0; dy < fp.h && !checkedSolid; dy++) {
        for (let dx = 0; dx < fp.w && !checkedSolid; dx++) {
          if (dx === d.door.x && dy === d.door.y) continue;
          expect(tiles[e.y + dy][e.x + dx].walkable, `${e.id} solid cell`).toBe(false);
          checkedSolid = true;
        }
      }
      expect(checkedSolid, `${e.id} had a non-door cell`).toBe(true);
    }
  });

  it('is deterministic for a fixed seed (replay parity)', () => {
    const run = () => {
      const world = new World(emptyMap());
      const tiles = gridTiles(40, 40);
      const poi = { id: 'poi-v', type: 'village', position: { x: 20, y: 20 } } as never;
      return placeSettlement(poi, getZoneRule('village'), tiles, world.registry, [],
        new Random(99), 'medieval', world).entities.map(e => `${e.kind}@${e.x},${e.y}`);
    };
    expect(run()).toEqual(run());
  });
});
