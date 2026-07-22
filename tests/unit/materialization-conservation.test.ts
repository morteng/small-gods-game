/**
 * P2 MaterializationSystem — CONSERVATION. Focusing a settlement draws its
 * cohort souls into real entities; leaving folds them back. Without drift the
 * cohort is restored EXACTLY (counts + per-spirit belief sums); with drift the
 * cohort reflects the drifted belief exactly (no leak). Combined named+stat
 * population per settlement is invariant across the cycle.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { cohortPopulation, type SettlementCohorts } from '@/sim/cohorts';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { makeHarness } from './materialization-harness';

beforeAll(() => loadDefaultPacks());

function sums(sc: SettlementCohorts) {
  let pop = 0, faith = 0, contribution = 0;
  for (const b of sc.bands) {
    pop += b.count;
    const pb = b.belief['player'];
    if (pb) { faith += pb.sumFaith; contribution += pb.sumContribution; }
  }
  return { pop, faith, contribution };
}
function matCount(world: ReturnType<typeof makeHarness>['world']): number {
  return queryNpcs(world).filter(e => npcProps(e).materializedTemp === true).length;
}

describe('MaterializationSystem conservation', () => {
  it('materializes on focus and folds back exactly (no drift)', () => {
    const h = makeHarness({ cottages: 12, souls: 40 });
    const sc = h.cohorts.get('village')!;
    const before = sums(sc);
    expect(before.pop).toBe(40);

    h.materializeFully('village');
    const live = h.liveCount('village');
    expect(live).toBeGreaterThan(0);
    expect(matCount(h.world)).toBe(live);
    // Souls left the cohort into entities — combined stays 40.
    expect(cohortPopulation(sc) + live).toBe(40);

    h.foldFully();
    expect(h.liveCount('village')).toBe(0);
    expect(matCount(h.world)).toBe(0);
    const after = sums(sc);
    expect(after.pop).toBe(before.pop);
    expect(after.faith).toBeCloseTo(before.faith, 6);
    expect(after.contribution).toBeCloseTo(before.contribution, 6);
  });

  it('banks accrued belief when a materialized soul drifts', () => {
    const h = makeHarness({ cottages: 12, souls: 40 });
    const sc = h.cohorts.get('village')!;
    const before = sums(sc);

    h.materializeFully('village');
    // Drift one live extra's faith upward.
    const extra = queryNpcs(h.world).find(e => npcProps(e).materializedTemp === true)!;
    const DELTA = 0.4;
    npcProps(extra).beliefs['player'].faith += DELTA;

    h.foldFully();
    const after = sums(sc);
    expect(after.pop).toBe(before.pop);                       // count still conserved
    expect(after.faith).toBeCloseTo(before.faith + DELTA, 6); // drift banked, exactly
  });

  it('reaches the derived target = min(cap, residentCap, cohortPop)', () => {
    // 4 cottages ⇒ residentCap 20 < cohortPop 40 ⇒ target 20.
    const h = makeHarness({ cottages: 4, souls: 40 });
    h.materializeFully('village');
    expect(h.liveCount('village')).toBe(20);
    expect(cohortPopulation(h.cohorts.get('village')!)).toBe(20);
  });
});
