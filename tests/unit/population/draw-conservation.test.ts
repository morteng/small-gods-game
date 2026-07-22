/**
 * P2 living-population — drawCohortSouls conservation. Drawing n souls removes
 * exactly n (bumping drawCount by n), and re-adding every returned observation
 * restores cohortPopulation, every band.count, and every per-spirit belief SUM.
 * drawCount only ever increases.
 */
import { describe, it, expect } from 'vitest';
import {
  emptySettlementCohorts, addSoul, drawCohortSouls, cohortPopulation,
  bandMeanObservation, type SettlementCohorts, type SoulObservation,
} from '@/sim/cohorts';

function seedCohort(): SettlementCohorts {
  const sc = emptySettlementCohorts('village');
  const souls: SoulObservation[] = [
    { age: 8,  beliefs: { player: { faith: 0.2, understanding: 0.1, devotion: 0.0 } }, needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 } },
    { age: 25, beliefs: { player: { faith: 0.7, understanding: 0.3, devotion: 0.2 }, rivalA: { faith: 0.1, understanding: 0, devotion: 0 } }, needs: { safety: 0.6, prosperity: 0.4, community: 0.5, meaning: 0.3 } },
    { age: 30, beliefs: { player: { faith: 0.5, understanding: 0.2, devotion: 0.1 } }, needs: { safety: 0.5, prosperity: 0.5, community: 0.6, meaning: 0.4 } },
    { age: 33, beliefs: { player: { faith: 0.9, understanding: 0.4, devotion: 0.3 } }, needs: { safety: 0.7, prosperity: 0.6, community: 0.5, meaning: 0.6 } },
    { age: 50, beliefs: { rivalA: { faith: 0.6, understanding: 0.2, devotion: 0.1 } }, needs: { safety: 0.4, prosperity: 0.5, community: 0.4, meaning: 0.5 } },
    { age: 70, beliefs: { player: { faith: 0.3, understanding: 0.1, devotion: 0.0 } }, needs: { safety: 0.5, prosperity: 0.3, community: 0.4, meaning: 0.5 } },
  ];
  // Add a few per age so several bands are populated.
  for (let r = 0; r < 4; r++) for (const s of souls) addSoul(sc, structuredClone(s));
  return sc;
}

interface Snap { count: number; belief: Record<string, { f: number; u: number; d: number; c: number }>; }
function snap(sc: SettlementCohorts): Snap[] {
  return sc.bands.map(b => ({
    count: b.count,
    belief: Object.fromEntries(Object.entries(b.belief).map(([k, v]) =>
      [k, { f: v.sumFaith, u: v.sumU, d: v.sumD, c: v.sumContribution }])),
  }));
}

describe('drawCohortSouls conservation', () => {
  it('removes exactly n and bumps drawCount by n', () => {
    const sc = seedCohort();
    const pop0 = cohortPopulation(sc);
    const dc0 = sc.drawCount;
    const drawn = drawCohortSouls(sc, 5);
    expect(drawn.length).toBe(5);
    expect(cohortPopulation(sc)).toBe(pop0 - 5);
    expect(sc.drawCount).toBe(dc0 + 5);
  });

  it('draw → fold restores counts and belief sums exactly; drawCount never decreases', () => {
    const sc = seedCohort();
    const before = snap(sc);
    const dcBefore = sc.drawCount;

    const drawn = drawCohortSouls(sc, 12);
    expect(cohortPopulation(sc)).toBe(24 - 12);
    const dcAfterDraw = sc.drawCount;
    expect(dcAfterDraw).toBe(dcBefore + 12);

    // Fold every drawn soul back (no drift) — the exact inverse.
    for (const obs of drawn) addSoul(sc, obs);

    const after = snap(sc);
    expect(after.map(b => b.count)).toEqual(before.map(b => b.count));
    for (let i = 0; i < before.length; i++) {
      for (const sid of Object.keys(before[i].belief)) {
        expect(after[i].belief[sid].f).toBeCloseTo(before[i].belief[sid].f, 8);
        expect(after[i].belief[sid].u).toBeCloseTo(before[i].belief[sid].u, 8);
        expect(after[i].belief[sid].d).toBeCloseTo(before[i].belief[sid].d, 8);
        expect(after[i].belief[sid].c).toBeCloseTo(before[i].belief[sid].c, 8);
      }
    }
    // Folding uses addSoul, which never touches drawCount.
    expect(sc.drawCount).toBe(dcAfterDraw);
    expect(sc.drawCount).toBeGreaterThanOrEqual(dcBefore);
  });

  it('bandMeanObservation is invariant under removing the mean (exact mean)', () => {
    const sc = seedCohort();
    const band = sc.bands.find(b => b.count > 1)!;
    const m0 = bandMeanObservation(band, ['player', 'rivalA'])!;
    const drawn = drawCohortSouls(sc, 1);
    const m1 = bandMeanObservation(sc.bands.find(b => b.count > 0 && b.ageMin === band.ageMin)!, ['player', 'rivalA'])!;
    // Removing the band mean leaves the mean unchanged.
    for (const sid of Object.keys(m0.beliefs)) {
      if (m1.beliefs[sid]) expect(m1.beliefs[sid].faith).toBeCloseTo(m0.beliefs[sid].faith, 8);
    }
    expect(drawn.length).toBe(1);
  });
});
