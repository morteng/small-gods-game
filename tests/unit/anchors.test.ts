import { describe, it, expect } from 'vitest';
import { outwardFacing, buildingAnchors } from '@/world/anchors';

describe('anchors', () => {
  it('outwardFacing points away from the footprint for an edge cell', () => {
    expect(outwardFacing([1, 2], { w: 3, h: 3 })).toEqual([0, 1]);   // south edge
    expect(outwardFacing([0, 1], { w: 3, h: 3 })).toEqual([-1, 0]);  // west edge
  });

  it('buildingAnchors maps a descriptor door to a world tile + outward facing', () => {
    const desc = { footprint: { w: 3, h: 3 }, door: { x: 1, y: 2 } };
    const a = buildingAnchors(desc, 10, 20);
    const door = a.find(an => an.kind === 'door')!;
    expect(door.x).toBeCloseTo(11.5); // originX + door.x + 0.5 (centred along the wall)
    expect(door.y).toBeCloseTo(23);   // south edge: originY + door.y + 1
    expect(door.facing).toEqual([0, 1]);
    expect(door.main).toBe(true);
  });
});
