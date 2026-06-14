// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { runTurtle } from '@/assetgen/geometry/flora/turtle';

const opts = { angleDeg: 45, step: 1, radius: 1, taper: 0.5 };

describe('flora 3D turtle', () => {
  it('draws one tapered limb per F, stacked along +z', () => {
    const { limbs } = runTurtle('FF', opts);
    expect(limbs).toHaveLength(2);
    expect(limbs[0].a).toEqual([0, 0, 0]);
    expect(limbs[0].b[2]).toBeCloseTo(1);
    expect(limbs[1].a[2]).toBeCloseTo(1);
    expect(limbs[1].b[2]).toBeCloseTo(2);
    // radius tapers each segment
    expect(limbs[0].r0).toBeCloseTo(1);
    expect(limbs[0].r1).toBeCloseTo(0.5);
    expect(limbs[1].r0).toBeCloseTo(0.5);
  });

  it('branches with [] and drops a leaf when a branch closes', () => {
    const { limbs, leaves } = runTurtle('F[+F]F', { ...opts, leafR: 0.2 });
    expect(limbs).toHaveLength(3);
    expect(leaves).toHaveLength(1); // one ']' tip
  });

  it('a yaw turn bends the heading off the z axis', () => {
    const { limbs } = runTurtle('F+F', opts);
    // second limb is no longer purely vertical
    const d = limbs[1];
    const horiz = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
    expect(horiz).toBeGreaterThan(0.1);
  });
});
