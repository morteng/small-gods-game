import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets/index';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { toCollision } from '@/blueprint/compile/to-collision';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { blueprintEntity } from '@/blueprint/entity';
import { structureBox } from '@/blueprint/footprint';
import { yawForOrientation, type Orientation } from '@/blueprint/orientation';

const oriented = (preset: string, o: Orientation) => {
  const base = synthesizeBlueprint(preset, [], 1)!;
  return o ? { ...base, orientation: o } : base;
};

describe('orientation — compile path rotates geometry, collision, anchors together', () => {
  it('toGeometry carries the orientation yaw (and omits it when canonical)', () => {
    expect(toGeometry(oriented('cottage', 0)).yaw).toBeUndefined();
    expect(toGeometry(oriented('cottage', 1)).yaw).toBeCloseTo(yawForOrientation(1));
    expect(toGeometry(oriented('cottage', 3)).yaw).toBeCloseTo(yawForOrientation(3));
  });

  it('a canonical blueprint is byte-identical (no orientation field leaks into the cache key)', () => {
    const base = synthesizeBlueprint('cottage', [], 1)!;
    // No `orientation` property at all on a canonically-placed blueprint.
    expect('orientation' in base).toBe(false);
    expect(JSON.stringify(toCollision(base))).toBe(JSON.stringify(toCollision({ ...base })));
  });

  it('odd quarter-turns swap the collision footprint dims; even keep them', () => {
    const c0 = toCollision(oriented('manor', 0)).footprint;
    const c1 = toCollision(oriented('manor', 1)).footprint;
    const c2 = toCollision(oriented('manor', 2)).footprint;
    expect(c1).toEqual({ w: c0.h, h: c0.w });
    expect(c2).toEqual(c0);
  });

  it('blocked-cell count is invariant under rotation (a rigid turn moves cells, never adds/drops)', () => {
    for (const o of [1, 2, 3] as Orientation[]) {
      expect(toCollision(oriented('parish-church', o)).blocked.length)
        .toBe(toCollision(oriented('parish-church', 0)).blocked.length);
    }
  });

  it('the main door anchor facing rotates CW through the quarter-turns', () => {
    const main = (o: Orientation) => {
      const a = toAnchors(oriented('cottage', o), 0, 0);
      return (a.find(x => x.main) ?? a[0]).facing;
    };
    const f0 = main(0);
    // Canonical cottage door faces south [0,1]; one CW turn → west, two → north, three → east.
    expect(f0).toEqual([0, 1]);
    expect(main(1)).toEqual([-1, 0]);
    expect(main(2).map(v => v + 0)).toEqual([0, -1]);
    expect(main(3).map(v => v + 0)).toEqual([1, 0]);
  });

  it('the door anchor sits on the footprint face its facing points to, for every turn', () => {
    // The door always lies on the side its (rotated) facing points to, relative to the
    // footprint centre, and stays centred on the perpendicular axis — proving the cell
    // rotation and the facing rotation share one sense.
    for (const o of [0, 1, 2, 3] as Orientation[]) {
      const fp = toCollision(oriented('cottage', o)).footprint;
      const cx = fp.w / 2, cy = fp.h / 2;
      const a = toAnchors(oriented('cottage', o), 0, 0);
      const door = a.find(x => x.main) ?? a[0];
      const [fx, fy] = door.facing;
      // Offset of the door from centre projected on the facing direction must be positive.
      const proj = (door.x - cx) * fx + (door.y - cy) * fy;
      expect(proj).toBeGreaterThan(0);
      // ...and it sits on the centre line of the perpendicular axis (|perp offset| ~ 0).
      const perp = (door.x - cx) * -fy + (door.y - cy) * fx;
      expect(Math.abs(perp)).toBeLessThan(1e-9);
    }
  });

  it('the placed entity footprint and sort offset use the ROTATED extent', () => {
    const e0 = blueprintEntity('a', oriented('manor', 0), 10, 10);
    const e1 = blueprintEntity('b', oriented('manor', 1), 10, 10);
    const fp0 = e0.properties!.footprint as { w: number; h: number };
    const fp1 = e1.properties!.footprint as { w: number; h: number };
    expect(fp1).toEqual({ w: fp0.h, h: fp0.w });
    expect(e1.properties!.sortYOffset).toBe(fp1.h);
  });

  it('structureBox rotates with orientation (renderer + visual-claim track the silhouette)', () => {
    const b0 = structureBox(oriented('manor', 0));
    const b1 = structureBox(oriented('manor', 1));
    // A 90° turn swaps the box span.
    expect(b1.w).toBe(b0.h);
    expect(b1.h).toBe(b0.w);
  });

  it('orientation survives a save/load round-trip (enumerable on the stored blueprint)', () => {
    const e = blueprintEntity('persisted', oriented('cottage', 3), 12, 7);
    // structuredClone mirrors the snapshot/save path (the connectome is non-enumerable and
    // re-attached elsewhere; orientation is a plain enumerable number on rb, so it rides along).
    const restored = structuredClone(e);
    const rb = (restored.properties!.blueprint as { rb: ReturnType<typeof oriented> }).rb;
    expect(rb.orientation).toBe(3);
    // ...and re-deriving geometry/collision from the restored rb yields the SAME rotated result.
    expect(toGeometry(rb).yaw).toBeCloseTo(yawForOrientation(3));
    expect(toCollision(rb).footprint).toEqual(toCollision(oriented('cottage', 3)).footprint);
  });
});
