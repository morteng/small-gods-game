// tests/unit/building-collision-lawn.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { tileBlockedByBuilding } from '@/world/building-collision';
import type { GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('building collision with a structure sub-rect (lawn)', () => {
  it('keeps full-footprint buildings solid except the door (default)', () => {
    const w = new World(emptyMap());
    const d = synthesizeFromPreset('tavern')!;        // no structure → full footprint
    w.addEntity(buildingEntity('t1', d, 5, 5));
    expect(tileBlockedByBuilding(w, 5, 5)).toBe(true);                 // a wall cell
    expect(tileBlockedByBuilding(w, 5 + d.door.x, 5 + d.door.y)).toBe(false); // door
  });

  it('makes lawn (outside the structure) walkable, structure solid, door open', () => {
    const w = new World(emptyMap());
    const d = { ...synthesizeFromPreset('tavern')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 }, door: { x: 1, y: 1 } };
    w.addEntity(buildingEntity('c1', d, 10, 10));
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
