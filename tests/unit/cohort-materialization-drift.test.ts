/**
 * MATERIALIZATION IS NOT A BIRTH (interaction scaling P3, S3.3).
 *
 * It makes a soul that has lived in the settlement for YEARS visible, so it must
 * arrive carrying what that settlement's people actually believe RIGHT NOW — not
 * what they believed at worldgen. Before S3.1 the two were the same thing,
 * because cohort belief was inert; now that the statistical tier drifts, a
 * materialized extra seeded from a stale constant would assert something false
 * about the soul it claims to reveal.
 *
 * This is the exact defect class S2c.1 shipped a guard for
 * (`tests/unit/npc-spawn-bands.test.ts`: a spawn seed left stale when the band
 * beside it moved, which broke knight patrols in CI), so it gets the same shape
 * of guard — assert against the LIVE running sums, never against a literal.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { npcProps } from '@/world/npc-helpers';
import {
  addSoul, bandMeanObservation, cohortPopulation, drawCohortSouls,
  emptySettlementCohorts, STAT_SEED_FAITH, YOUNG_ADULT_BAND_INDEX,
  type SettlementCohorts,
} from '@/sim/cohorts';
import { driftSettlementBelief, FIRES_PER_GAME_HOUR } from '@/sim/cohort-drift';
import { makeHarness } from './materialization-harness';

beforeAll(() => loadDefaultPacks());

function seededVillage(poiId: string, n: number, believers: number): SettlementCohorts {
  const sc = emptySettlementCohorts(poiId);
  for (let i = 0; i < n; i++) {
    addSoul(sc, {
      age: 30,
      // The worldgen shape: a believer fraction at the shallow-believer line,
      // the rest heathen.
      beliefs: i < believers ? { player: { faith: STAT_SEED_FAITH, understanding: 0, devotion: 0 } } : {},
      needs: { safety: 0.6, prosperity: 0.5, community: 0.8, meaning: 0.5 },
    });
  }
  return sc;
}

function playerSum(sc: SettlementCohorts): number {
  let n = 0;
  for (const band of sc.bands) n += band.belief.player?.sumFaith ?? 0;
  return n;
}

describe('materialization reads the DRIFTED cohort (S3.3)', () => {
  it('a drawn soul carries the drifted mean, not the seed value', () => {
    const sc = seededVillage('village', 36, 9);
    const seedMean = bandMeanObservation(sc.bands[YOUNG_ADULT_BAND_INDEX], ['player'])!
      .beliefs.player!.faith;

    driftSettlementBelief(sc, { fires: FIRES_PER_GAME_HOUR });
    const driftedMean = bandMeanObservation(sc.bands[YOUNG_ADULT_BAND_INDEX], ['player'])!
      .beliefs.player!.faith;
    expect(driftedMean).not.toBe(seedMean);

    // The drawn soul tracks the LIVE sums — the assertion is against the record,
    // never against a literal, so a future retune moves both together.
    const band = sc.bands[YOUNG_ADULT_BAND_INDEX];
    const expected = band.belief.player!.sumFaith / band.count;
    const [obs] = drawCohortSouls(sc, 1, (b) => b === band);
    expect(obs.beliefs.player!.faith).toBeCloseTo(expected, 12);
    expect(obs.beliefs.player!.faith).not.toBeCloseTo(STAT_SEED_FAITH, 6);
  });

  it('drift then draw then fold still round-trips the running sums exactly', () => {
    const sc = seededVillage('village', 36, 9);
    driftSettlementBelief(sc, { fires: FIRES_PER_GAME_HOUR });
    const popBefore = cohortPopulation(sc);
    const faithBefore = playerSum(sc);

    const drawn = drawCohortSouls(sc, 6);
    expect(drawn).toHaveLength(6);
    expect(cohortPopulation(sc)).toBe(popBefore - 6);
    for (const obs of drawn) addSoul(sc, obs);

    expect(cohortPopulation(sc)).toBe(popBefore);
    expect(playerSum(sc)).toBeCloseTo(faithBefore, 10);
  });

  it('drift changes belief mass and changes NO counts (what the audit watches)', () => {
    const sc = seededVillage('village', 36, 9);
    const countsBefore = sc.bands.map(b => b.count);
    const massBefore = playerSum(sc);
    driftSettlementBelief(sc, { fires: FIRES_PER_GAME_HOUR });
    expect(sc.bands.map(b => b.count)).toEqual(countsBefore);
    expect(playerSum(sc)).not.toBe(massBefore);
  });

  it('the SHIPPED materialization path hands an extra the drifted belief', () => {
    // Through the real MaterializationSystem, not a replica of it: whatever the
    // extras arrive holding must equal the band mean the cohort held at the
    // moment they were drawn.
    const h = makeHarness({ cottages: 12, souls: 40 });
    const sc = h.cohorts.get('village')!;
    const before = new Map(sc.bands.map((b, i) => [i, b.belief.player
      ? b.belief.player.sumFaith / b.count : 0]));
    driftSettlementBelief(sc, { fires: FIRES_PER_GAME_HOUR });
    const after = new Map(sc.bands.map((b, i) => [i, b.belief.player
      ? b.belief.player.sumFaith / b.count : 0]));
    // The fixture's cohort must actually have moved, or this proves nothing.
    expect([...after.values()].some((v, i) => v !== [...before.values()][i])).toBe(true);

    h.materializeFully('village');
    const extras = h.world.query({ kind: 'npc' })
      .filter(e => npcProps(e).materializedTemp === true);
    expect(extras.length).toBeGreaterThan(0);
    const faiths = new Set(extras.map(e => npcProps(e).beliefs.player?.faith ?? 0));
    // Every drawn faith is one of the drifted band means (draws come from
    // several bands), and none is a value from before the drift.
    for (const f of faiths) {
      expect([...after.values()].some(v => Math.abs(v - f) < 1e-9)).toBe(true);
    }
  });
});
