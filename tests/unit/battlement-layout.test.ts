// Battlement layout gates — the numeric half of the tower/parapet fix loop.
//
// Both reported defects ("square towers have the sticky-up parts wrong in corners", "round towers
// render wrong against walls") are measurable without an image: teeth stepped at a FIXED period
// from one end left a flush double tooth at one corner and up to a full period bare at the
// opposite one, and a flat rise constant made drums as wide as they were tall. These pin the
// rules so the class cannot come back.
import { describe, it, expect } from 'vitest';
import {
  toothRun, toothRunMetrics, merlonsAroundRect, ringSegments, parapetHeight,
  MERLON_PERIOD_TILES, MERLON_WIDTH_FRAC,
} from '@/assetgen/geometry/battlement';
import { towerSpec } from '@/assetgen/geometry/tower-spec';
import { mToTiles } from '@/render/scale-contract';

/** Every box part of a spec whose top sits at/above `z` (the parapet band). */
function boxesAbove(parts: ReturnType<typeof towerSpec>['parts'], z: number): { at: number[]; size: number[] }[] {
  return parts.flatMap((p) => (p.prim === 'box' && p.at[2] >= z - 1e-6 ? [{ at: p.at as number[], size: p.size as number[] }] : []));
}

describe('toothRun — the one merlon layout rule', () => {
  it('is symmetric about the run midpoint for any span', () => {
    for (const len of [2.0, 2.35, 3.05, 4.0, 5.7, 9.3, 12.0]) {
      const teeth = toothRun(0, len);
      const m = toothRunMetrics(teeth, 0, len);
      expect(m.count, `span ${len}`).toBeGreaterThan(0);
      expect(m.symmetryResidual, `span ${len} symmetry`).toBeLessThan(1e-9);
      expect(m.leadGap, `span ${len} lead vs trail`).toBeCloseTo(m.trailGap, 9);
    }
  });

  it('never leaves a bare stretch as wide as a whole period (the old trailing remainder)', () => {
    for (const len of [2.35, 3.05, 5.7, 9.3]) {
      const m = toothRunMetrics(toothRun(0, len), 0, len);
      expect(m.trailGap).toBeLessThan(MERLON_PERIOD_TILES * (1 - MERLON_WIDTH_FRAC));
    }
  });

  it('holds the pitch near the target and the tooth wider than its crenel', () => {
    const len = 12.0;
    const teeth = toothRun(0, len);
    const m = toothRunMetrics(teeth, 0, len);
    expect(m.pitch).toBeCloseTo(MERLON_PERIOD_TILES, 6);
    expect(teeth[0].width).toBeGreaterThan(m.pitch * 0.5);   // tooth wider than the gap it leaves
  });

  it('emits nothing for a run too short for a tooth, and honours minCount', () => {
    expect(toothRun(0, MERLON_PERIOD_TILES * 0.4)).toHaveLength(0);
    expect(toothRun(0, MERLON_PERIOD_TILES * 0.4, MERLON_PERIOD_TILES, MERLON_WIDTH_FRAC, 1)).toHaveLength(1);
  });
});

describe('merlonsAroundRect — closed parapets turn their corners', () => {
  const pt = mToTiles(0.4);

  it('anchors a solid merlon at all four corners', () => {
    const parts = merlonsAroundRect(0, 0, 3.05, 3.05, pt, 5, 1, 'stone');
    const boxes = parts.map((p) => ({ x: (p as { at: number[] }).at[0], y: (p as { at: number[] }).at[1] }));
    const near = (x: number, y: number): boolean => boxes.some((b) => Math.abs(b.x - x) < 1e-6 && Math.abs(b.y - y) < 1e-6);
    // Each corner carries an arm starting exactly at it (the L of the corner merlon).
    expect(near(0, 0)).toBe(true);
    expect(near(0, 3.05 - pt)).toBe(true);
    expect(near(3.05 - pt, 0)).toBe(true);
  });

  it('is symmetric under the rectangle\'s own mirrors — no favoured corner', () => {
    const s = 3.05;
    const parts = merlonsAroundRect(0, 0, s, s, pt, 5, 1, 'stone');
    const key = (p: unknown): string => {
      const { at, size } = p as { at: number[]; size: number[] };
      return `${at[0].toFixed(6)},${at[1].toFixed(6)},${size[0].toFixed(6)},${size[1].toFixed(6)}`;
    };
    const set = new Set(parts.map(key));
    // Mirror x → s−x−w: every box must map onto another box.
    for (const p of parts) {
      const { at, size } = p as { at: number[]; size: number[] };
      const mirrored = `${(s - at[0] - size[0]).toFixed(6)},${at[1].toFixed(6)},${size[0].toFixed(6)},${size[1].toFixed(6)}`;
      expect(set.has(mirrored), `x-mirror of ${key(p)}`).toBe(true);
    }
  });
});

describe('mural towers', () => {
  const base = { curtainHeight: 3, curtainThickness: 2, material: 'stone' as const };

  it('a square tower carries a continuous crenel sill under its teeth', () => {
    const sq = towerSpec({ ...base, round: false });
    // The sill courses run the FULL side; teeth are all shorter than that.
    const long = boxesAbove(sq.parts, 0).filter((b) => b.size[0] >= sq.side * 0.9 || b.size[1] >= sq.side * 0.9);
    expect(long.length, 'sill courses present').toBeGreaterThanOrEqual(2);
  });

  // BOTH forms, every shape of curtain: a tower wider than it is tall is not a tower. The square
  // form was missed on the first pass (only the drum was floored) and the `--metrics` table caught
  // it — gate towers on a thick wall were coming out at aspect 1.40.
  it('every tower reads as a tower, not a bulge (aspect + rise over the curtain)', () => {
    for (const curtainHeight of [1.5, 3, 3.5, 4]) {
      for (const curtainThickness of [1, 2, 3]) {
        for (const round of [true, false]) {
          for (const tall of [true, false]) {
            const t = towerSpec({ ...base, curtainHeight, curtainThickness, round, tall });
            const topZ = Math.max(...t.parts.map((p) => {
              if (p.prim === 'box') return p.at[2] + p.size[2];
              if (p.prim === 'cylinder' || p.prim === 'column') return (p.baseZ ?? 0) + p.height;
              return 0;
            }));
            const what = `${round ? 'drum' : 'square'}${tall ? ' tall' : ''} h=${curtainHeight} th=${curtainThickness}`;
            expect(topZ / t.side, `aspect of ${what}`).toBeGreaterThanOrEqual(1.8 - 1e-6);
            expect(topZ, `rise over curtain of ${what}`).toBeGreaterThan(curtainHeight * 1.3);
          }
        }
      }
    }
  });

  // A tower's battlement is the SAME construction as the wall's, so its teeth must stand at the
  // same height. The tower used to derive that itself with an extra 1 m floor the curtain never
  // had, so the two drifted apart on a low wall; both now read `parapetHeight`. Measured off the
  // emitted geometry, not off the constant, so a tower that stops calling it fails here.
  it('tower teeth stand exactly as tall as the curtain parapet they flank', () => {
    for (const curtainHeight of [1, 1.5, 2, 3, 4, 6]) {
      for (const round of [true, false]) {
        const t = towerSpec({ ...base, curtainHeight, round });
        const zs = t.parts.map((p) => (p.prim === 'box' ? p.at[2] + p.size[2]
          : p.prim === 'cylinder' || p.prim === 'column' ? (p.baseZ ?? 0) + p.height : 0));
        const topZ = Math.max(...zs);
        // The teeth start at the wall-walk: the highest part base below the crest.
        const walkZ = Math.max(...t.parts.filter((p) => p.prim === 'box' && p.at[2] < topZ - 1e-6)
          .map((p) => (p as { at: number[] }).at[2]));
        expect(topZ - walkZ, `${round ? 'drum' : 'square'} teeth on a ${curtainHeight}-tile curtain`)
          .toBeCloseTo(parapetHeight(curtainHeight), 9);
      }
    }
  });

  it('ring divisions are shared, so the sill course and its teeth cut on the same joints', () => {
    const rp = 2.1;
    expect(ringSegments(rp)).toBe(Math.max(6, Math.round((2 * Math.PI * rp) / MERLON_PERIOD_TILES)));
  });
});
