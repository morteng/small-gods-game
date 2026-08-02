/**
 * Cohort migration (interaction scaling P3, S3.2 + S3.3) — the statistical
 * tier's young adults move along the road graph toward better prospects.
 *
 * Three things are being pinned here, in descending order of how badly a
 * regression would hurt:
 *
 *   1. CONSERVATION OF SOULS. Every migrant is removed from exactly one cohort
 *      and added to exactly one other, the running belief sums stay exact on
 *      both ends, and `CohortSystem`'s audit EXPLAINS the flow from the ledgered
 *      `souls_migrated` event rather than being weakened to tolerate it.
 *   2. DETERMINISM. Largest-remainder apportionment, sorted folds, a carried
 *      fractional accumulator instead of an rng draw — two runs from the same
 *      state are byte-identical.
 *   3. DIRECTION AND SELF-LIMITING. People move toward the better prospect, and
 *      the flow closes its own gradient instead of draining one town into the
 *      next forever.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { SettlementFluxTally } from '@/sim/settlement-flux';
import {
  addSoul, cohortPopulation, emptySettlementCohorts, transferCohortSouls,
  YOUNG_ADULT_BAND_INDEX, COHORT_BAND_EDGES,
  type SettlementCohorts,
} from '@/sim/cohorts';
import {
  MIGRATION_RATE_PER_DAY, MIGRATION_RATE_PER_GAME_HOUR, GAME_HOURS_PER_DAY,
  settlementProspect, stepCohortMigration, totalCohortSouls,
} from '@/sim/cohort-migration';
import { FERTILE_MIN_AGE, FERTILE_MAX_AGE } from '@/sim/systems/birth-system';
import type { GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

/** A settlement of `n` young adults, `believers` of whom hold player faith. */
function village(poiId: string, n: number, believers = 0, faith = 0.4): SettlementCohorts {
  const sc = emptySettlementCohorts(poiId);
  for (let i = 0; i < n; i++) {
    addSoul(sc, {
      age: 30,
      beliefs: i < believers ? { player: { faith, understanding: 0.2, devotion: 0.1 } } : {},
      needs: { safety: 0.6, prosperity: 0.5, community: 0.8, meaning: 0.5 },
    });
  }
  return sc;
}

function bandCount(sc: SettlementCohorts): number {
  return sc.bands[YOUNG_ADULT_BAND_INDEX].count;
}

describe('cohort migration (S3.2)', () => {
  it('migrates the YOUNG-ADULT band, derived from the shipped band edges', () => {
    expect(YOUNG_ADULT_BAND_INDEX).toBeGreaterThanOrEqual(0);
    expect(COHORT_BAND_EDGES[YOUNG_ADULT_BAND_INDEX]).toBe(FERTILE_MIN_AGE);
    expect(COHORT_BAND_EDGES[YOUNG_ADULT_BAND_INDEX + 1]).toBe(FERTILE_MAX_AGE);
  });

  it('the rate is denominated per fiction DAY and divided by the day', () => {
    // The S2c discipline: a rate that means "per day" says so, so a tick-rate
    // change carries instead of silently becoming a 360× artifact.
    expect(GAME_HOURS_PER_DAY).toBe(24);
    expect(MIGRATION_RATE_PER_GAME_HOUR).toBeCloseTo(MIGRATION_RATE_PER_DAY / 24, 12);
  });

  it('prospect ranks a prosperous, uncrowded settlement above a taxed, packed one', () => {
    const roomy = settlementProspect({
      poiId: 'a', population: 36, prosperitySatisfaction: 0.5, carryingCapacity: 72,
    });
    const packed = settlementProspect({
      poiId: 'b', population: 72, prosperitySatisfaction: 0.5, carryingCapacity: 72,
    });
    const taxed = settlementProspect({
      poiId: 'c', population: 36, prosperitySatisfaction: 0.25, carryingCapacity: 72,
    });
    expect(roomy).toBeGreaterThan(packed);
    expect(roomy).toBeGreaterThan(taxed);
    // No capacity signal ⇒ reads as exactly at capacity, so it neither pulls nor
    // sheds on the crowding term (it never drives a flow on its own).
    expect(settlementProspect({
      poiId: 'd', population: 40, prosperitySatisfaction: 0.5, carryingCapacity: 0,
    })).toBe(0.5 - 1);
  });

  it('a fractional rate accumulates instead of flooring to zero forever', () => {
    // A "small rate" over a small band is well under one soul per game hour. The
    // accumulator is what makes a small rate a rate at all rather than a no-op.
    const src = village('src', 40);
    const dst = village('dst', 40);
    const cohorts = new Map([['src', src], ['dst', dst]]);
    const prospects = new Map([['src', 0], ['dst', 0.5]]);
    const step = () => stepCohortMigration({
      cohorts, prospects, neighboursOf: (id) => (id === 'src' ? ['dst'] : []),
    });
    expect(step()).toEqual([]);                       // owes a fraction, moves nobody
    expect(src.migrationFrac).toBeGreaterThan(0);
    let moved = 0;
    for (let hour = 0; hour < 48 && moved === 0; hour++) {
      const flows = step();
      moved += flows.reduce((n, f) => n + f.count, 0);
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('splits leavers across destinations by largest remainder, deterministically', () => {
    const make = () => {
      const src = village('src', 200);
      src.migrationFrac = 0.999;                      // on the brink, so one hour lands leavers
      const cohorts = new Map([
        ['src', src], ['n1', village('n1', 10)], ['n2', village('n2', 10)],
      ]);
      return { src, cohorts };
    };
    const prospects = new Map([['src', 0], ['n1', 0.9], ['n2', 0.3]]);
    const neighboursOf = (id: string) => (id === 'src' ? ['n1', 'n2'] : []);
    const a = make();
    const b = make();
    const flowsA = stepCohortMigration({ cohorts: a.cohorts, prospects, neighboursOf });
    const flowsB = stepCohortMigration({ cohorts: b.cohorts, prospects, neighboursOf });
    expect(flowsA).toEqual(flowsB);
    expect(a.src.migrationFrac).toBe(b.src.migrationFrac);
    expect(flowsA.length).toBeGreaterThan(0);
    // The stronger gradient takes at least as many as the weaker one.
    const to = (poi: string) => flowsA.filter(f => f.dstPoiId === poi).reduce((n, f) => n + f.count, 0);
    expect(to('n1')).toBeGreaterThanOrEqual(to('n2'));
  });

  it('never sends anyone downhill or to itself', () => {
    const cohorts = new Map([['rich', village('rich', 60)], ['poor', village('poor', 60)]]);
    cohorts.get('rich')!.migrationFrac = 0.999;
    const prospects = new Map([['rich', 0.8], ['poor', 0.1]]);
    const flows = stepCohortMigration({
      cohorts, prospects, neighboursOf: (id) => (id === 'rich' ? ['poor', 'rich'] : ['rich']),
    });
    expect(flows.filter(f => f.srcPoiId === 'rich')).toEqual([]);
  });
});

describe('transferCohortSouls — conservation (S3.3)', () => {
  it('conserves souls and carries belief with the migrants', () => {
    const src = village('src', 20, 20, 0.5);
    const dst = village('dst', 20, 0);
    const before = cohortPopulation(src) + cohortPopulation(dst);
    const srcFaithBefore = src.bands[YOUNG_ADULT_BAND_INDEX].belief.player!.sumFaith;

    const moved = transferCohortSouls(src, dst, YOUNG_ADULT_BAND_INDEX, 5, ['player']);
    expect(moved).toBe(5);
    expect(cohortPopulation(src) + cohortPopulation(dst)).toBe(before);
    expect(bandCount(src)).toBe(15);
    expect(bandCount(dst)).toBe(25);

    // Belief travelled: the destination gained exactly what the source lost, and
    // the source's per-soul mean is unchanged (the band-mean representative).
    const srcAfter = src.bands[YOUNG_ADULT_BAND_INDEX].belief.player!;
    const dstAfter = dst.bands[YOUNG_ADULT_BAND_INDEX].belief.player!;
    expect(srcAfter.sumFaith + dstAfter.sumFaith).toBeCloseTo(srcFaithBefore, 10);
    expect(srcAfter.sumFaith / 15).toBeCloseTo(srcFaithBefore / 20, 10);
    expect(dstAfter.sumFaith).toBeGreaterThan(0);
  });

  it('never draws more than the band holds, and leaves `drawCount` alone', () => {
    const src = village('src', 3);
    const dst = village('dst', 0);
    const drawCountBefore = src.drawCount;
    expect(transferCohortSouls(src, dst, YOUNG_ADULT_BAND_INDEX, 99, [])).toBe(3);
    expect(bandCount(src)).toBe(0);
    expect(bandCount(dst)).toBe(3);
    // `drawCount` is the MATERIALIZATION id anchor — a migration mints no entity,
    // so bumping it would silently renumber every future materialized soul.
    expect(src.drawCount).toBe(drawCountBefore);
  });

  it('the whole-world soul total is invariant under a full migration step', () => {
    const cohorts = new Map([
      ['a', village('a', 40)], ['b', village('b', 40)], ['c', village('c', 40)],
    ]);
    for (const sc of cohorts.values()) sc.migrationFrac = 0.999;
    const before = totalCohortSouls(cohorts);
    const prospects = new Map([['a', 0], ['b', 0.6], ['c', 0.9]]);
    const flows = stepCohortMigration({
      cohorts, prospects,
      neighboursOf: (id) => ['a', 'b', 'c'].filter(x => x !== id),
    });
    for (const f of flows) {
      transferCohortSouls(
        cohorts.get(f.srcPoiId)!, cohorts.get(f.dstPoiId)!,
        YOUNG_ADULT_BAND_INDEX, f.count, ['player'],
      );
    }
    expect(totalCohortSouls(cohorts)).toBe(before);
  });
});

describe('CohortSystem ledger (S3.3)', () => {
  it('explains a migration from the ledgered event instead of reporting a violation', () => {
    const world = new World(emptyMap());
    const clock = new SimClock();
    const log = new EventLog(clock);
    const cohorts = new Map([['src', village('src', 40)], ['dst', village('dst', 40)]]);
    const sys = new CohortSystem(() => cohorts);
    const tick = (now: number) => sys.tick({
      world, spirits: new Map(), log, clock, rng: createRng(3), dt: 1000, now,
    });
    const violations = () => {
      let v = 0;
      for (const e of log.since(0)) if (e.event.type === 'system_error') v++;
      return v;
    };

    tick(0);                                       // adopt the stat baseline
    const moved = transferCohortSouls(
      cohorts.get('src')!, cohorts.get('dst')!, YOUNG_ADULT_BAND_INDEX, 4, ['player'],
    );
    log.append({ type: 'souls_migrated', srcPoiId: 'src', dstPoiId: 'dst', count: moved });
    tick(1_000_000);

    expect(violations()).toBe(0);
    expect(sys.ledgerCounters().cohortMigrations).toBe(4);
    // A NAMED soul changing homePoiId is a different flow in a different tier —
    // collapsing them would make the ledger unable to say which tier moved.
    expect(sys.ledgerCounters().migrations).toBe(0);
  });

  it('STILL reports a violation when souls move with no ledgered event', () => {
    // The audit must not have been weakened into uselessness by learning the new
    // flow: an unexplained statistical-tier movement is still a violation.
    const world = new World(emptyMap());
    const clock = new SimClock();
    const log = new EventLog(clock);
    const cohorts = new Map([['src', village('src', 40)], ['dst', village('dst', 40)]]);
    const sys = new CohortSystem(() => cohorts);
    const tick = (now: number) => sys.tick({
      world, spirits: new Map(), log, clock, rng: createRng(3), dt: 1000, now,
    });
    tick(0);
    transferCohortSouls(
      cohorts.get('src')!, cohorts.get('dst')!, YOUNG_ADULT_BAND_INDEX, 4, ['player'],
    );
    tick(1_000_000);                               // no souls_migrated appended
    let violations = 0;
    for (const e of log.since(0)) if (e.event.type === 'system_error') violations++;
    expect(violations).toBeGreaterThan(0);
  });
});

describe('flux metering (S3.2)', () => {
  it('a migrant registers on the same cross-settlement meter a market visitor does', () => {
    const flux = new SettlementFluxTally();
    flux.noteMigrant('src', 'dst');
    flux.noteMigrant('src', 'dst');
    expect(flux.rawFlow('src', 'dst')).toBe(2);
    // Self-flow is not flux — the same rule `noteVisitor` already enforces.
    flux.noteMigrant('src', 'src');
    expect(flux.activePairs()).toBe(1);
  });
});
