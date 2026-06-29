import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';
import type { GameMap } from '@/core/types';

/** Footprint-local door cell of a placed building (first door, or origin). */
function doorOf(e: { properties?: Record<string, unknown> }): { x: number; y: number } {
  const cell = blueprintOf(e as never)?.collision.doorCells[0] ?? '0,0';
  const [x, y] = cell.split(',').map(Number);
  return { x, y };
}

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

describe('blueprint building indexing', () => {
  it('registers every footprint cell in the registry tile index', () => {
    const world = new World(emptyMap());
    const rb = synthesizeBlueprint('cottage')!;       // 3x3
    world.addEntity(blueprintEntity('b1', rb, 5, 5));
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const at = world.registry.getAtTile(5 + dx, 5 + dy).map(e => e.id);
        expect(at, `cell ${5 + dx},${5 + dy}`).toContain('b1');
      }
    }
    expect(world.registry.getAtTile(8, 8).map(e => e.id)).not.toContain('b1');
  });
});

describe('placeSettlement produces blueprint entities', () => {
  it('every placed building carries a blueprint and is tagged building', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-v', type: 'village', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('village'), tiles, world.registry, [], new Random(1234), 'medieval', world,
    );
    expect(entities.length).toBeGreaterThan(0);
    // result.entities now carries civic props too (S5) — restrict to buildings.
    for (const e of entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
      expect(e.tags).toContain('building');
      const stored = blueprintOf(e);
      expect(stored, e.id).toBeDefined();
      expect(stored!.rb.footprint.w).toBeGreaterThan(0);
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
    for (const e of entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
      // Open structures (a market stall) have NO threshold door — the door-walkability
      // invariant only applies to buildings that actually carve a door cell.
      if ((blueprintOf(e)!.collision.doorCells.length ?? 0) === 0) continue;
      // The PLACED extent (orientation-rotated) — matches the rotated blocked set + door cell.
      const fp = blueprintOf(e)!.collision.footprint;
      const door = doorOf(e);
      const doorTile = tiles[e.y + door.y][e.x + door.x];
      expect(doorTile.walkable, `${e.id} door`).toBe(true);
      // find a non-door, structure footprint cell and confirm it is solid
      const blocked = new Set(blueprintOf(e)!.collision.blocked);
      let checkedSolid = false;
      for (let dy = 0; dy < fp.h && !checkedSolid; dy++) {
        for (let dx = 0; dx < fp.w && !checkedSolid; dx++) {
          if (dx === door.x && dy === door.y) continue;
          if (!blocked.has(`${dx},${dy}`)) continue;   // skip lawn cells (kept walkable)
          expect(tiles[e.y + dy][e.x + dx].walkable, `${e.id} solid cell`).toBe(false);
          checkedSolid = true;
        }
      }
      expect(checkedSolid, `${e.id} had a non-door structure cell`).toBe(true);
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

describe('placeSettlement selects presets by era', () => {
  it('places yurts for a primordial village', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-camp', type: 'village', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('village'), tiles, world.registry, [], new Random(2024), 'primordial', world,
    );
    expect(entities.length).toBeGreaterThan(0);
    const presets = entities.map(e => blueprintOf(e)?.rb.preset);
    expect(presets).toContain('yurt');
    expect(presets).not.toContain('cottage');
  });

  it('places nothing for a zero-count fallback rule', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-lake', type: 'lake', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('lake'), tiles, world.registry, [], new Random(3), 'medieval', world,
    );
    expect(entities).toEqual([]);
  });
});
