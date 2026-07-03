import { describe, it, expect } from 'vitest';
import { reconcileBuildingsWithWater } from '@/world/building-water-reconcile';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { World } from '@/world/world';
import type { Entity, GameMap, Tile } from '@/core/types';

// Minimal map factory: a `type` grid → tiles. 'g' = grass (dry, buildable),
// '~' = river (water). Mirrors the ASCII-grid style used by land-snap.test.ts.
function tilesFrom(rows: string[]): Tile[][] {
  return rows.map((row, y) =>
    [...row].map((ch, x): Tile => ({
      type: ch === '~' ? 'river' : 'grass',
      walkable: ch !== '~',
      state: 'realized' as const,
      x, y,
    })),
  );
}

function addBuilding(world: World, id: string, x: number, y: number, w: number, h: number): Entity {
  const e: Entity = {
    id, kind: 'shrine', x, y,
    tags: ['building', 'religious'],
    properties: { category: 'building', footprint: { w, h }, poiId: 'swamp_shrine' },
  };
  world.addEntity(e);
  return e;
}

/** True when every cell of the [x,x+w) x [y,y+h) footprint is a non-water tile. */
function footprintDry(tiles: Tile[][], x: number, y: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (tiles[y + dy]?.[x + dx]?.type === 'river') return false;
    }
  }
  return true;
}

describe('reconcileBuildingsWithWater', () => {
  // Reproduces the wet-seat case (#22): a building was placed on valid dry ground,
  // but a LATER terrain carve (an authored river reaching for a POI the building
  // already occupies — see road-graph.ts's "rivers ignore the building obstacle by
  // design") floods part of its footprint. The building is valid at placement time
  // but not after every carve has run — this is the reconciliation that must catch it.
  it('nudges a building whose footprint was flooded post-placement to the nearest dry ground', () => {
    const tiles = tilesFrom([
      'gggggggggg',
      'gggggggggg',
      'gg~~gggggg',   // shrine's 2x2 footprint (2,2)-(3,3) is half water...
      'gg~~gggggg',   // ...half water: exactly the swamp_shrine repro (2 of 4 cells wet)
      'gggggggggg',
      'gggggggggg',
    ]);
    const world = new World({ tiles } as unknown as GameMap);
    addBuilding(world, 'swamp_shrine_bld_0', 2, 2, 2, 2);

    const moves = reconcileBuildingsWithWater(world, tiles);

    expect(moves).toHaveLength(1);
    expect(moves[0].id).toBe('swamp_shrine_bld_0');
    const moved = world.registry.get('swamp_shrine_bld_0')!;
    expect(moved.x).toBe(moves[0].x);
    expect(moved.y).toBe(moves[0].y);
    expect(footprintDry(tiles, moved.x, moved.y, 2, 2)).toBe(true);
    // The registry's tile index follows the move — the OLD cells no longer resolve
    // to this building (World's two-index-layer gotcha: mutate via updateEntity only).
    for (const [ox, oy] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
      const at = world.registry.getAtTile(ox, oy);
      expect(at.some((e) => e.id === 'swamp_shrine_bld_0')).toBe(false);
    }
  });

  it('leaves a dry-footprint building untouched (no-op on the common case)', () => {
    const tiles = tilesFrom(['gggg', 'gggg', 'gggg', 'gggg']);
    const world = new World({ tiles } as unknown as GameMap);
    addBuilding(world, 'cottage_0', 1, 1, 2, 2);

    const moves = reconcileBuildingsWithWater(world, tiles);

    expect(moves).toHaveLength(0);
    const e = world.registry.get('cottage_0')!;
    expect(e.x).toBe(1);
    expect(e.y).toBe(1);
  });

  it('leaves a flooded building in place when no dry ground is reachable within range', () => {
    const tiles = tilesFrom(Array.from({ length: 6 }, () => '~~~~~~'));
    const world = new World({ tiles } as unknown as GameMap);
    addBuilding(world, 'stranded_0', 2, 2, 2, 2);

    const moves = reconcileBuildingsWithWater(world, tiles);

    expect(moves).toHaveLength(0);
    const e = world.registry.get('stranded_0')!;
    expect(e.x).toBe(2);
    expect(e.y).toBe(2);
  });

  it('does not relocate a flooded building onto ground already claimed by another building', () => {
    const tiles = tilesFrom([
      'gg~~gg',
      'gg~~gg',
      'gggggg',
      'gggggg',
    ]);
    const world = new World({ tiles } as unknown as GameMap);
    addBuilding(world, 'flooded_0', 2, 0, 2, 2);
    // Claim the two dry patches nearest the flooded footprint — the reconciler must
    // skip both and keep searching rather than overlapping a neighbour.
    addBuilding(world, 'blocker_0', 0, 0, 2, 2);
    addBuilding(world, 'blocker_1', 4, 0, 2, 2);

    const moves = reconcileBuildingsWithWater(world, tiles);

    expect(moves).toHaveLength(1);
    const { x: dx, y: dy } = moves[0];
    expect(footprintDry(tiles, dx, dy, 2, 2)).toBe(true);
    // Must not overlap either blocker's footprint — no OTHER building may cover
    // any cell of the new footprint.
    for (let cy = dy; cy < dy + 2; cy++) {
      for (let cx = dx; cx < dx + 2; cx++) {
        expect(tileBlockedByBuilding(world, cx, cy, 'flooded_0')).toBe(false);
      }
    }
  });
});
