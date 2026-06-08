// tests/unit/pathfinding-lawn.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { findPath } from '@/sim/pathfinding';
import type { GameMap, Tile } from '@/core/types';

function makeMap(width: number, height: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  return {
    tiles, width, height, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

describe('pathfinding across a cottage yard', () => {
  it('routes a mortal through the walkable lawn ring', () => {
    const map = makeMap(20, 20);
    const world = new World(map);

    // Cottage: 3×3 plot with a 2×2 structure (body) at plot-local (0,0).
    // Lawn occupies plot-local column 2 (x=10) and row 2 (y=10) — fully walkable.
    const rb = synthesizeBlueprint('cottage')!;
    // Building placed at world tile (8,8), so it occupies (8..10, 8..10).
    world.addEntity(blueprintEntity('c1', rb, 8, 8));

    // Start: north of the plot (8,6). Goal: SE lawn corner (10,10) == plot-local (2,2).
    // (10,10) is outside the 2×2 structure, so it should be walkable lawn.
    const result = findPath(map, 8, 6, 10, 10, world);
    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThan(0);
  });
});
