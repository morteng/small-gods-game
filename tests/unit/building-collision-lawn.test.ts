// tests/unit/building-collision-lawn.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { tileBlockedByBuilding } from '@/world/building-collision';
import type { GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('building collision with a structure sub-rect (lawn)', () => {
  it('keeps full-footprint buildings solid except the door (default)', () => {
    const w = new World(emptyMap());
    // tavern: 3x3 body covering the whole footprint, door on south → cell (1,2).
    const rb = synthesizeBlueprint('tavern')!;
    w.addEntity(blueprintEntity('t1', rb, 5, 5));
    expect(tileBlockedByBuilding(w, 5, 5)).toBe(true);    // a wall cell
    expect(tileBlockedByBuilding(w, 6, 7)).toBe(false);   // door (south-centre, local 1,2)
  });

  it('makes lawn (outside the structure) walkable, structure solid, door open', () => {
    const w = new World(emptyMap());
    // cottage: 3x3 plot with a 2x2 body at (0,0), door on south → cell (1,1).
    // Footprint cells outside the 2x2 body are walkable lawn.
    const rb = synthesizeBlueprint('cottage')!;
    w.addEntity(blueprintEntity('c1', rb, 10, 10));
    // structure cell (0,0) → solid
    expect(tileBlockedByBuilding(w, 10, 10)).toBe(true);
    // lawn cells (2,*) and (*,2) → walkable
    expect(tileBlockedByBuilding(w, 12, 10)).toBe(false);
    expect(tileBlockedByBuilding(w, 10, 12)).toBe(false);
    expect(tileBlockedByBuilding(w, 12, 12)).toBe(false);
    // door cell inside structure → open
    expect(tileBlockedByBuilding(w, 11, 11)).toBe(false);
  });
});
