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
  it('keeps structure cells solid except the door (tavern)', () => {
    const w = new World(emptyMap());
    // tavern (v6): 3x2 body on a 3x3 plot, door on the body's south wall → cell (1,1).
    const rb = synthesizeBlueprint('tavern')!;
    w.addEntity(blueprintEntity('t1', rb, 5, 5));
    expect(tileBlockedByBuilding(w, 5, 5)).toBe(true);    // a wall cell
    expect(tileBlockedByBuilding(w, 6, 6)).toBe(false);   // door (south-centre of the body)
    expect(tileBlockedByBuilding(w, 6, 7)).toBe(false);   // yard strip below the body
  });

  it('makes lawn (outside the structure) walkable, structure solid, door open', () => {
    const w = new World(emptyMap());
    // cottage: 3x3 plot with a 3x2 body at (0,0); the y=2 row is walkable lawn. Door on
    // south at t=0.35 → cell (1,1). L2b makes the body length seed-derived (1–2 bays); seed 1
    // yields the 2-bay 3x2 form this test documents (seed 0 would be a shorter 2x2 cot).
    const rb = synthesizeBlueprint('cottage', [], 1)!;
    w.addEntity(blueprintEntity('c1', rb, 10, 10));
    // structure cells → solid
    expect(tileBlockedByBuilding(w, 10, 10)).toBe(true);
    expect(tileBlockedByBuilding(w, 12, 10)).toBe(true);
    // lawn row (y=2) → walkable
    expect(tileBlockedByBuilding(w, 10, 12)).toBe(false);
    expect(tileBlockedByBuilding(w, 12, 12)).toBe(false);
    // door cell inside structure → open
    expect(tileBlockedByBuilding(w, 11, 11)).toBe(false);
  });
});
