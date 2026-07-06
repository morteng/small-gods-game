import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { wheelWaterOrientation } from '@/blueprint/wheel-orientation';
import { rotateFacing } from '@/blueprint/orientation';

// The watermill authors its wheel on the WEST flank; wheelWaterOrientation should rotate the
// whole asset so that flank points at the nearest water, and no-op when it already does.
describe('wheelWaterOrientation', () => {
  beforeAll(() => ensureBuildingTypesRegistered());

  const mill = () => {
    const rb = synthesizeBlueprint('watermill');
    if (!rb) throw new Error('watermill preset missing');
    return rb;
  };
  // A single water tile at (wx,wy).
  const waterAt = (wx: number, wy: number) => (x: number, y: number) => x === wx && y === wy;

  // Footprint origin (10,10), 2×2 → centre (11,11). The wheel's canonical face is west (-1,0).
  it('turns the west wheel toward water on the EAST side (180°)', () => {
    const o = wheelWaterOrientation(mill(), 10, 10, waterAt(14, 11));
    expect(o).toBe(2);
    // west face (-1,0) rotated by o must point east (+x).
    expect(rotateFacing(-1, 0, o!).map(v => v + 0)).toEqual([1, 0]);
  });

  it('turns the west wheel toward water on the SOUTH side (270°)', () => {
    const o = wheelWaterOrientation(mill(), 10, 10, waterAt(11, 15));
    expect(o).toBe(3);
    expect(rotateFacing(-1, 0, o!).map(v => v + 0)).toEqual([0, 1]);
  });

  it('turns the west wheel toward water on the NORTH side (90°)', () => {
    const o = wheelWaterOrientation(mill(), 10, 10, waterAt(11, 6));
    expect(o).toBe(1);
    expect(rotateFacing(-1, 0, o!).map(v => v + 0)).toEqual([0, -1]);
  });

  it('no-ops (null) when the wheel already faces the water (WEST)', () => {
    expect(wheelWaterOrientation(mill(), 10, 10, waterAt(7, 11))).toBeNull();
  });

  it('returns null when no water is in range', () => {
    expect(wheelWaterOrientation(mill(), 10, 10, () => false)).toBeNull();
  });

  it('returns null for a blueprint with no waterwheel', () => {
    const cottage = synthesizeBlueprint('cottage');
    expect(cottage).toBeTruthy();
    expect(wheelWaterOrientation(cottage!, 10, 10, () => true)).toBeNull();
  });
});
