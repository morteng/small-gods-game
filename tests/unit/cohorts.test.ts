import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import {
  COHORT_BAND_EDGES, COHORT_BAND_COUNT, UNHOMED_COHORT_ID,
  bandIndexForAge, emptySettlementCohorts, addSoul, removeSoul,
  beliefContribution, cohortPopulation, censusCohorts,
  type SoulObservation,
} from '@/sim/cohorts';
import { ADULT_AGE, SENESCENCE_START, MAX_AGE, TICKS_PER_YEAR } from '@/sim/mortality';
import { FERTILE_MIN_AGE, FERTILE_MAX_AGE } from '@/sim/systems/birth-system';
import type { GameMap, Entity, NpcNeeds, SpiritBelief } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, poiId: string | undefined, ageYears: number): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  const e: Entity = { id, kind: 'npc', x: 2, y: 2, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
const needs = (v: number): NpcNeeds => ({ safety: v, prosperity: v, community: v, meaning: v });
const soul = (age: number, faith: number, u = 0, d = 0, n = 0.5): SoulObservation =>
  ({ age, beliefs: { player: { faith, understanding: u, devotion: d } }, needs: needs(n) });

describe('cohort bands', () => {
  it('band edges align with the shipped lifecycle constants', () => {
    expect(COHORT_BAND_EDGES).toEqual([0, ADULT_AGE, FERTILE_MIN_AGE, FERTILE_MAX_AGE, SENESCENCE_START, 75, MAX_AGE]);
    expect(COHORT_BAND_COUNT).toBe(6);
  });

  it('classifies ages onto bands, open-ended at both extremes', () => {
    expect(bandIndexForAge(0)).toBe(0);
    expect(bandIndexForAge(ADULT_AGE - 0.01)).toBe(0);
    expect(bandIndexForAge(ADULT_AGE)).toBe(1);
    expect(bandIndexForAge(FERTILE_MIN_AGE)).toBe(2);
    expect(bandIndexForAge(FERTILE_MAX_AGE - 0.01)).toBe(2);
    expect(bandIndexForAge(FERTILE_MAX_AGE)).toBe(3);
    expect(bandIndexForAge(SENESCENCE_START)).toBe(4);
    expect(bandIndexForAge(75)).toBe(5);
    // A soul can outlive MAX_AGE by up to one mortality check — stays in the last band.
    expect(bandIndexForAge(MAX_AGE + 1)).toBe(5);
    expect(bandIndexForAge(-0.5)).toBe(0); // clock quirk safety: clamps to band 0
  });
});

describe('cohort ledger arithmetic', () => {
  it('addSoul then removeSoul of the same soul returns the band to zero', () => {
    const sc = emptySettlementCohorts('village');
    const s = soul(30, 0.8, 0.6, 0.5, 0.7);
    addSoul(sc, s);
    expect(cohortPopulation(sc)).toBe(1);
    removeSoul(sc, s);
    expect(cohortPopulation(sc)).toBe(0);
    const band = sc.bands[bandIndexForAge(30)];
    expect(band.belief['player'].sumFaith).toBeCloseTo(0, 12);
    expect(band.belief['player'].sumContribution).toBeCloseTo(0, 12);
    expect(band.belief['player'].believerCount).toBe(0);
    expect(band.belief['player'].durableCount).toBe(0);
  });

  it('running sums stay exact under add/remove (the remaining soul, not a mean)', () => {
    const sc = emptySettlementCohorts('village');
    const a = soul(30, 0.8, 0.6, 0.5, 0.9);
    const b = soul(32, 0.1, 0.0, 0.0, 0.3);
    addSoul(sc, a);
    addSoul(sc, b);
    const band = sc.bands[bandIndexForAge(30)];
    expect(band.count).toBe(2);
    expect(band.belief['player'].believerCount).toBe(1); // only a ≥ BELIEVER_THRESHOLD
    expect(band.belief['player'].durableCount).toBe(1);  // only a passes isDurable
    removeSoul(sc, b);
    expect(band.count).toBe(1);
    expect(band.belief['player'].sumFaith).toBeCloseTo(0.8, 12);
    expect(band.belief['player'].sumU).toBeCloseTo(0.6, 12);
    expect(band.belief['player'].sumD).toBeCloseTo(0.5, 12);
    expect(band.belief['player'].sumContribution).toBeCloseTo(beliefContribution(a.beliefs['player']), 12);
    expect(band.needs.safety).toBeCloseTo(0.9, 9);
  });

  it('beliefContribution matches the SpiritSystem power formula', () => {
    const b: SpiritBelief = { faith: 0.5, understanding: 0.3, devotion: 0.2 };
    expect(beliefContribution(b)).toBeCloseTo(0.5 * (1 + 2 * 0.3) * (1 + 2 * 0.2), 12);
  });
});

describe('censusCohorts', () => {
  it('buckets every living soul exactly once, unhomed included', () => {
    const world = new World(emptyMap());
    addNpc(world, 'a', 'village', 30);
    addNpc(world, 'b', 'village', 8);
    addNpc(world, 'c', 'hamlet', 60);
    addNpc(world, 'd', undefined, 40);
    const { cohorts, homes } = censusCohorts(world, 0);
    expect(homes.size).toBe(4);
    expect(cohortPopulation(cohorts.get('village')!)).toBe(2);
    expect(cohorts.get('village')!.bands[0].count).toBe(1); // the 8-year-old
    expect(cohortPopulation(cohorts.get('hamlet')!)).toBe(1);
    expect(cohortPopulation(cohorts.get(UNHOMED_COHORT_ID)!)).toBe(1);
  });

  it('is independent of World insertion order (replay-stable float sums)', () => {
    const build = (ids: string[]) => {
      const world = new World(emptyMap());
      for (const id of ids) addNpc(world, id, 'village', 20 + id.charCodeAt(0) % 20);
      return JSON.stringify([...censusCohorts(world, 0).cohorts.entries()]);
    };
    expect(build(['a', 'b', 'c', 'd'])).toBe(build(['d', 'b', 'a', 'c']));
  });
});
