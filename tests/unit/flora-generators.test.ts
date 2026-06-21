// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRng } from '@/core/rng';
import { growProctree } from '@/assetgen/geometry/flora/proctree';
import { growSpaceColonization } from '@/assetgen/geometry/flora/space-colonization';
import {
  buildFlora, FLORA_GENERATORS, CROWN_SILHOUETTES, type CrownSilhouette,
} from '@/assetgen/geometry/flora/generators';
import type { FloraSkeleton } from '@/assetgen/geometry/flora/turtle';

const finite = (s: FloraSkeleton): boolean =>
  s.limbs.every((l) => [...l.a, ...l.b, l.r0, l.r1].every(Number.isFinite)) &&
  s.leaves.every((lf) => [...lf.at, lf.r].every(Number.isFinite));

const maxZ = (s: FloraSkeleton): number =>
  Math.max(0, ...s.limbs.flatMap((l) => [l.a[2], l.b[2]]), ...s.leaves.map((lf) => lf.at[2]));

describe('proctree generator', () => {
  it('grows a branching, foliated, finite skeleton', () => {
    const s = growProctree({}, createRng(7));
    expect(s.limbs.length).toBeGreaterThan(10); // recursive branches, not one stick
    expect(s.leaves.length).toBeGreaterThan(0);
    expect(finite(s)).toBe(true);
  });

  it('is deterministic for a fixed seed and varies with it', () => {
    const a = growProctree({}, createRng(11));
    const b = growProctree({}, createRng(11));
    const c = growProctree({}, createRng(12));
    expect(a.limbs).toEqual(b.limbs);
    expect(a.limbs).not.toEqual(c.limbs);
  });

  it('drop pulls the crown downward (weeping reaches below its branch points)', () => {
    const upright = growProctree({ drop: 0.05, climb: 0.4 }, createRng(3));
    const weeping = growProctree({ drop: 0.9, climb: 0.05 }, createRng(3));
    // A weeping crown's lowest leaf sits lower (relative to height) than an upright one's.
    const lowFrac = (s: FloraSkeleton): number => {
      const h = maxZ(s) || 1;
      return Math.min(...s.leaves.map((l) => l.at[2])) / h;
    };
    expect(lowFrac(weeping)).toBeLessThan(lowFrac(upright));
  });
});

describe('space-colonization generator', () => {
  it('grows a connected, foliated, finite skeleton', () => {
    const s = growSpaceColonization({}, createRng(5));
    expect(s.limbs.length).toBeGreaterThan(10);
    expect(s.leaves.length).toBeGreaterThan(0);
    expect(finite(s)).toBe(true);
  });

  it('conical envelopes taper narrower at the top than rounded ones', () => {
    const widthNearTop = (env: 'conical' | 'rounded'): number => {
      const s = growSpaceColonization({ envelope: env }, createRng(9));
      const h = maxZ(s) || 1;
      const high = s.limbs.filter((l) => l.b[2] > 0.8 * h);
      return Math.max(0, ...high.map((l) => Math.hypot(l.b[0], l.b[1])));
    };
    expect(widthNearTop('conical')).toBeLessThan(widthNearTop('rounded'));
  });

  it('is deterministic for a fixed seed', () => {
    const a = growSpaceColonization({ envelope: 'rounded' }, createRng(4));
    const b = growSpaceColonization({ envelope: 'rounded' }, createRng(4));
    expect(a.limbs).toEqual(b.limbs);
  });
});

describe('buildFlora dispatcher', () => {
  it('every generator × crown produces a finite skeleton fitted to the target height', () => {
    for (const generator of FLORA_GENERATORS) {
      for (const crownShape of CROWN_SILHOUETTES) {
        const s = buildFlora({ generator, recipe: 'oak', crownShape, heightTiles: 6, baseRadius: 0.12, rng: createRng(2) });
        expect(finite(s), `${generator}/${crownShape}`).toBe(true);
        expect(s.limbs.length, `${generator}/${crownShape}`).toBeGreaterThan(0);
        expect(maxZ(s), `${generator}/${crownShape}`).toBeCloseTo(6, 4);
      }
    }
  });

  it('different crown shapes yield distinct silhouettes (the core complaint fix)', () => {
    const sig = (crownShape: CrownSilhouette): string => {
      const s = buildFlora({ generator: 'proctree', recipe: 'oak', crownShape, heightTiles: 6, baseRadius: 0.12, rng: createRng(1) });
      return `${s.limbs.length}|${s.leaves.length}`;
    };
    const shapes: CrownSilhouette[] = ['rounded', 'columnar', 'weeping', 'spreading'];
    const sigs = new Set(shapes.map(sig));
    expect(sigs.size).toBeGreaterThan(1);
  });
});
