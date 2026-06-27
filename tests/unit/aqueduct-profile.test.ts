import { describe, it, expect } from 'vitest';
import { planAqueductProfile, type AqueductProfileOptions } from '@/world/connectome/aqueduct-profile';
import type { SpanPoint } from '@/world/connectome/road-span';

const P = (...xy: Array<[number, number]>): SpanPoint[] => xy.map(([x, y]) => ({ x, y }));

/** A terrain sampler from an east-running height array (metres), with reliefM = 1 so elevAt
 *  returns metres directly. Out-of-array x clamps to the ends; y is ignored. */
function eastTerrain(heightsM: number[]): AqueductProfileOptions['elevAt'] {
  return (x: number) => heightsM[Math.max(0, Math.min(heightsM.length - 1, x))];
}

describe('planAqueductProfile — the aqueduct as the inverted river', () => {
  it('hugs gently-descending ground as a SURFACE channel (no cut, no deck)', () => {
    // Ground drops 0.5 m/tile; with maxGrade 0.3 (max fall 0.6 m/tile) the water-line can follow it.
    const elevAt = (x: number) => 10 - 0.5 * x;
    const prof = planAqueductProfile(P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]), {
      elevAt, reliefM: 1, maxGrade: 0.3,
    })!;
    expect(prof).not.toBeNull();
    expect(prof.stations.every((s) => s.mode === 'surface')).toBe(true);
    expect(prof.maxCutM).toBeCloseTo(0, 6);
    expect(prof.maxElevatedM).toBeCloseTo(0, 6);
    expect(prof.totalFallM).toBeCloseTo(2.5, 6);          // 10 → 7.5
    expect(prof.feasible).toBe(true);
    expect(prof.segments).toHaveLength(1);
    expect(prof.segments[0].mode).toBe('surface');
    expect(prof.segments[0].dir).toBe('east');
    expect(prof.segments[0].runTiles).toBeCloseTo(5, 6);
  });

  it('CUTS through a rise the gentle grade cannot climb (the channel trenches the hill)', () => {
    // A hill at x=2..4 the near-flat water-line (maxGrade 0.05) cannot rise to meet.
    const elevAt = eastTerrain([10, 10, 14, 16, 14, 10, 9.5]);
    const prof = planAqueductProfile(P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]), {
      elevAt, reliefM: 1, maxGrade: 0.05,
    })!;
    expect(prof.stations.map((s) => s.mode)).toEqual([
      'surface', 'surface', 'cut', 'cut', 'cut', 'surface', 'surface',
    ]);
    expect(prof.maxCutM).toBeCloseTo(6.003, 2);           // deepest at x=3 (ground 16, line ≈ 9.997)
    expect(prof.maxElevatedM).toBeCloseTo(0, 6);
    expect(prof.feasible).toBe(true);
    const cut = prof.segments.find((s) => s.mode === 'cut')!;
    expect(cut.from).toEqual({ x: 2, y: 0 });
    expect(cut.to).toEqual({ x: 4, y: 0 });
    expect(cut.runTiles).toBeCloseTo(2, 6);
  });

  it('rides a DECK across a valley the gentle grade cannot descend into (arches over the gap)', () => {
    // A deep dip at x=2..4; the water-line eases down at maxGrade only, so the ground falls away
    // below it — the classic aqueduct-on-arches across a valley.
    const elevAt = eastTerrain([20, 19.9, 5, 5, 5, 19.8, 19.7]);
    const prof = planAqueductProfile(P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]), {
      elevAt, reliefM: 1, maxGrade: 0.05,
    })!;
    expect(prof.stations.map((s) => s.mode)).toEqual([
      'surface', 'surface', 'elevated', 'elevated', 'elevated', 'surface', 'surface',
    ]);
    expect(prof.maxElevatedM).toBeGreaterThan(14);
    expect(prof.maxCutM).toBeCloseTo(0, 6);
    expect(prof.feasible).toBe(true);
    const deck = prof.segments.find((s) => s.mode === 'elevated')!;
    expect(deck.from).toEqual({ x: 2, y: 0 });
    expect(deck.to).toEqual({ x: 4, y: 0 });
  });

  it('the water-line NEVER rises and ALWAYS keeps falling (gravity + flow invariants)', () => {
    const elevAt = eastTerrain([30, 10, 25, 8, 26, 9, 20, 12]);   // jagged, to stress the band
    const path = P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0]);
    const maxGrade = 0.05, minGrade = 0.001;
    const prof = planAqueductProfile(path, { elevAt, reliefM: 1, maxGrade, minGrade })!;
    const stepFallM = (g: number) => g * 2;   // 2 m per cardinal tile (METRES_PER_TILE)
    for (let i = 1; i < prof.stations.length; i++) {
      const drop = prof.stations[i - 1].waterM - prof.stations[i].waterM;
      expect(drop).toBeGreaterThanOrEqual(stepFallM(minGrade) - 1e-9);   // always flowing
      expect(drop).toBeLessThanOrEqual(stepFallM(maxGrade) + 1e-9);      // never steeper than max
    }
  });

  it('flags a source NOT above the sink as infeasible (gravity flow impossible)', () => {
    const elevAt = eastTerrain([5, 6, 7]);   // climbs
    const prof = planAqueductProfile(P([0, 0], [1, 0], [2, 0]), { elevAt, reliefM: 1 })!;
    expect(prof.feasible).toBe(false);
    expect(prof.reason).toMatch(/source not above sink/);
  });

  it('flags a rise too tall to trench as infeasible (route should go around)', () => {
    const elevAt = eastTerrain([10, 10, 30, 10, 9.5]);   // a 20 m spike past the 8 m cut cap
    const prof = planAqueductProfile(P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), {
      elevAt, reliefM: 1, maxGrade: 0.05, cutDepthMaxM: 8,
    })!;
    expect(prof.feasible).toBe(false);
    expect(prof.reason).toMatch(/cut .* exceeds cap/);
    expect(prof.maxCutM).toBeGreaterThan(8);
  });

  it('splits an L-bend into one cardinal-colinear piece per leg (sharing the corner)', () => {
    const elevAt: AqueductProfileOptions['elevAt'] = (x, y) => 20 - (x + y) * 0.3;   // descends along the path
    const prof = planAqueductProfile(P([0, 0], [1, 0], [2, 0], [2, 1], [2, 2]), {
      elevAt, reliefM: 1, maxGrade: 0.3,
    })!;
    expect(prof.stations.every((s) => s.mode === 'surface')).toBe(true);
    expect(prof.segments.map((s) => s.dir)).toEqual(['east', 'south']);
    for (const s of prof.segments) {
      const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y;
      expect(dx === 0 || dy === 0).toBe(true);   // each piece is a straight cardinal line
    }
    // The corner tile (2,0) is the east leg's head AND the south leg's foot.
    expect(prof.segments[0].to).toEqual({ x: 2, y: 0 });
    expect(prof.segments[1].from).toEqual({ x: 2, y: 0 });
  });

  it('covers every station with exactly one segment (no tile dropped at a mode boundary)', () => {
    const elevAt = eastTerrain([20, 19.9, 5, 19.8, 5, 19.7, 19.6]);   // alternating dip/rise islands
    const path = P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]);
    const prof = planAqueductProfile(path, { elevAt, reliefM: 1, maxGrade: 0.05 })!;
    // Reconstruct the tile sequence from the segments and compare to the stations.
    const covered = new Set<string>();
    for (const s of prof.segments) {
      const dx = Math.sign(s.to.x - s.from.x), dy = Math.sign(s.to.y - s.from.y);
      let x = s.from.x, y = s.from.y;
      covered.add(`${x},${y}`);
      while (x !== s.to.x || y !== s.to.y) { x += dx; y += dy; covered.add(`${x},${y}`); }
    }
    for (const st of prof.stations) expect(covered.has(`${st.x},${st.y}`)).toBe(true);
  });

  it('is deterministic — same inputs ⇒ identical profile', () => {
    const elevAt = eastTerrain([12, 11, 9, 14, 8, 7]);
    const mk = () => planAqueductProfile(P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]), {
      elevAt, reliefM: 1, maxGrade: 0.05,
    });
    expect(JSON.stringify(mk())).toEqual(JSON.stringify(mk()));
  });

  it('returns null for a path of fewer than two distinct tiles', () => {
    expect(planAqueductProfile(P([2, 2]), { elevAt: () => 0, reliefM: 1 })).toBeNull();
    expect(planAqueductProfile(P([2, 2], [2, 2]), { elevAt: () => 0, reliefM: 1 })).toBeNull();
  });
});
