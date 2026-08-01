/**
 * Interaction scaling P1 (S1.1 + S1.2): the per-settlement aggregate store and
 * the cross-settlement visitor flux meter.
 *
 * The load-bearing test here is PARITY: the store exists to retire four
 * duplicate O(N) sweeps that were held together only by a "must not disagree"
 * convention, so it has to agree with the two shipped ones (`residentsByPoi`
 * and `censusBelieversByPoi`) exactly, on a world that exercises both tiers.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { createState } from '@/core/state';
import type { GameMap, Tile, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import {
  buildSettlementAggregates, populationBaseline, SettlementAggregateStore,
} from '@/sim/settlement-aggregates';
import {
  SettlementFluxTally, FLUX_FOLD_WINDOW_TICKS, fluxKey, parseFluxKey,
} from '@/sim/settlement-flux';
import { SettlementAggregateSystem } from '@/sim/systems/settlement-aggregate-system';
import { residentsByPoi } from '@/sim/systems/settlement-growth-system';
import { censusBelieversByPoi } from '@/sim/rival-contention';
import { emptySettlementCohorts, addSoul, type SettlementCohorts } from '@/sim/cohorts';
import { PRAYER_CLAIM_WARNING_TICKS } from '@/sim/rival-claims';
import { BELIEVER_THRESHOLD } from '@/sim/believers';
import { TICKS_PER_DAY } from '@/core/calendar';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';

function miniMap(w = 12, h = 12): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    for (let x = 0; x < w; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function spirit(id: SpiritId): Spirit {
  return { id, name: id, sigil: '◐', color: '#abc', isPlayer: id === 'player', power: 5, manifestation: null };
}

function addNpc(
  world: World, id: string, poi: string | undefined, patch: Partial<NpcProperties>, seed = 7,
): void {
  const props = { ...initNpcProps(id, 'farmer', seed), homePoiId: poi, ...patch } as NpcProperties;
  world.addEntity({ id, kind: 'npc', x: 1, y: 1, properties: props as unknown as Record<string, unknown> });
}

/** A settlement cohort with `count` souls whose belief toward `sid` is `faith`. */
function cohortOf(poiId: string, count: number, sid: SpiritId, faith: number, prosperity = 0.5): SettlementCohorts {
  const sc = emptySettlementCohorts(poiId);
  for (let i = 0; i < count; i++) {
    addSoul(sc, {
      age: 30,
      beliefs: { [sid]: { faith, understanding: 0.2, devotion: 0.3 } },
      needs: { safety: 0.7, prosperity, community: 0.6, meaning: 0.4 },
    });
  }
  return sc;
}

/** A two-settlement world exercising both tiers, an unhomed soul, and a plea. */
function twoTierWorld(now: number): {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  cohorts: Map<string, SettlementCohorts>;
} {
  const world = new World(miniMap());
  const spirits = new Map<SpiritId, Spirit>([
    ['player', spirit('player')],
    ['rival-1', spirit('rival-1')],
  ]);
  // poi-a: two named believers in the player (one durable), one heathen.
  addNpc(world, 'a1', 'poi-a', {
    beliefs: { player: { faith: 0.8, understanding: 0.6, devotion: 0.7 } },
    needs: { safety: 0.9, prosperity: 0.2, community: 0.8, meaning: 0.5 },
  }, 1);
  addNpc(world, 'a2', 'poi-a', {
    beliefs: { player: { faith: 0.4, understanding: 0.1, devotion: 0.05 } },
    needs: { safety: 0.9, prosperity: 0.2, community: 0.8, meaning: 0.5 },
    activity: 'worship', prayerSince: now - PRAYER_CLAIM_WARNING_TICKS - 1,
  }, 2);
  addNpc(world, 'a3', 'poi-a', {
    beliefs: { player: { faith: 0.01, understanding: 0, devotion: 0 } },
    needs: { safety: 0.9, prosperity: 0.2, community: 0.8, meaning: 0.5 },
  }, 3);
  // poi-b: one named believer in the rival, and a belief toward a DEPARTED god.
  addNpc(world, 'b1', 'poi-b', {
    beliefs: {
      'rival-1': { faith: 0.9, understanding: 0.5, devotion: 0.6 },
      'gone-god': { faith: 0.99, understanding: 0.9, devotion: 0.9 },
    },
    needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 },
  }, 4);
  // An unhomed wanderer — buckets under '' (the buildRivalSituation convention).
  addNpc(world, 'w1', undefined, {
    beliefs: { player: { faith: 0.5, understanding: 0.2, devotion: 0.2 } },
    needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 },
  }, 5);

  const cohorts = new Map<string, SettlementCohorts>([
    ['poi-a', cohortOf('poi-a', 10, 'player', 0.6, 0.3)],
    ['poi-b', cohortOf('poi-b', 4, 'rival-1', 0.05, 0.9)],   // sub-threshold: not believers
  ]);
  return { world, spirits, cohorts };
}

describe('buildSettlementAggregates — parity with the shipped sweeps', () => {
  it('population agrees with residentsByPoi on both tiers', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const agg = buildSettlementAggregates(world, spirits, { now, cohorts });
    const residents = residentsByPoi(world, cohorts);

    for (const [poiId, expected] of residents) {
      const a = agg.get(poiId);
      expect(a, `no aggregate for ${poiId}`).toBeDefined();
      expect(a!.population.named + a!.population.statistical).toBe(expected);
    }
    // residentsByPoi SKIPS unhomed named souls; the aggregate keeps them in the
    // '' bucket so per-settlement counts still balance globally.
    expect(residents.has('')).toBe(false);
    expect(agg.get('')!.population.named).toBe(1);
    const total = [...agg.values()].reduce((n, a) => n + a.population.named + a.population.statistical, 0);
    expect(total).toBe([...residents.values()].reduce((n, v) => n + v, 0) + 1);
  });

  it('believer counts agree with censusBelieversByPoi, spirit by spirit', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const agg = buildSettlementAggregates(world, spirits, { now, cohorts });
    const census = censusBelieversByPoi(world, spirits, cohorts);

    // Every census entry is reproduced.
    for (const [poiId, perSpirit] of census) {
      for (const [sid, n] of perSpirit) {
        expect(agg.get(poiId)?.believers[sid]?.count ?? 0, `${poiId}/${sid}`).toBe(n);
      }
    }
    // ...and the aggregate invents none: every non-zero count is in the census.
    for (const [poiId, a] of agg) {
      for (const [sid, stats] of Object.entries(a.believers)) {
        if (stats.count === 0) continue;
        expect(census.get(poiId)?.get(sid) ?? 0, `${poiId}/${sid}`).toBe(stats.count);
      }
    }
  });

  it('drops beliefs toward a spirit that is no longer live (as the census does)', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const agg = buildSettlementAggregates(world, spirits, { now, cohorts });
    expect(agg.get('poi-b')!.believers['gone-god']).toBeUndefined();
    expect(agg.get('poi-b')!.believers['rival-1'].count).toBe(1);
  });
});

describe('buildSettlementAggregates — record contents', () => {
  const now = TICKS_PER_DAY;

  it('keeps need pressure DIRECTIONAL: four axes, never a scalar', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    const a = buildSettlementAggregates(world, spirits, { now, cohorts }).get('poi-a')!;
    // poi-a is prosperity-starved but safe: those two must not read the same.
    expect(a.needPressure.prosperity).toBeGreaterThan(a.needPressure.safety);
    // Pressure is UNMET need — the named trio sit at safety 0.9, the ten cohort
    // souls at 0.7, so the weighted pressure is 1 − the population-weighted mean.
    const expectedSafety = 1 - (3 * 0.9 + 10 * 0.7) / 13;
    expect(a.needPressure.safety).toBeCloseTo(expectedSafety, 10);
    const expectedProsperity = 1 - (3 * 0.2 + 10 * 0.3) / 13;
    expect(a.needPressure.prosperity).toBeCloseTo(expectedProsperity, 10);
  });

  it('an empty settlement reads zero pressure, not NaN', () => {
    const world = new World(miniMap());
    const cohorts = new Map([['poi-x', emptySettlementCohorts('poi-x')]]);
    const a = buildSettlementAggregates(world, new Map(), { cohorts }).get('poi-x')!;
    expect(a.population).toEqual({ named: 0, statistical: 0 });
    expect(a.needPressure).toEqual({ safety: 0, prosperity: 0, community: 0, meaning: 0 });
  });

  it('counts prayer pressure only for pleas past the warning window', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    expect(buildSettlementAggregates(world, spirits, { now, cohorts }).get('poi-a')!.prayerPressure).toBe(1);
    // Without `now` a plea has no age, so nothing is at risk.
    expect(buildSettlementAggregates(world, spirits, { cohorts }).get('poi-a')!.prayerPressure).toBe(0);
  });

  it('mean faith is over the WHOLE population — non-believers dilute', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    const a = buildSettlementAggregates(world, spirits, { now, cohorts }).get('poi-a')!;
    const namedFaith = 0.8 + 0.4 + 0.01;
    expect(a.believers['player'].meanFaith).toBeCloseTo((namedFaith + 10 * 0.6) / 13, 10);
    expect(a.believers['player'].count).toBe(2 + 10);       // faith ≥ BELIEVER_THRESHOLD
    expect(a.believers['player'].durable).toBe(1);          // only a1 clears isDurable
    expect(0.01).toBeLessThan(BELIEVER_THRESHOLD);
  });

  it('NO baseline ⇒ NO trend field (an unknown trend is not growth)', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    const a = buildSettlementAggregates(world, spirits, { now, cohorts }).get('poi-a')!;
    expect('populationTrend' in a).toBe(false);
  });

  it('an explicit baseline yields a signed trend, including for a vanished settlement', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    const baseline = new Map([['poi-a', 10], ['poi-b', 5]]);
    const agg = buildSettlementAggregates(world, spirits, { now, cohorts, baseline });
    expect(agg.get('poi-a')!.populationTrend).toBe(13 - 10);
    expect(agg.get('poi-b')!.populationTrend).toBe(5 - 5);
    // A settlement absent from the baseline reads its whole population as growth
    // — correct, because the baseline explicitly said it had none.
    expect(agg.get('')!.populationTrend).toBe(1);
  });

  it('is deterministic and poiId-sorted', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    const a = buildSettlementAggregates(world, spirits, { now, cohorts });
    const b = buildSettlementAggregates(world, spirits, { now, cohorts });
    expect([...a.keys()]).toEqual(['', 'poi-a', 'poi-b']);
    expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
  });

  it('populationBaseline totals both tiers', () => {
    const { world, spirits, cohorts } = twoTierWorld(now);
    const base = populationBaseline(buildSettlementAggregates(world, spirits, { now, cohorts }));
    expect(base.get('poi-a')).toBe(13);
    expect(base.get('poi-b')).toBe(5);
  });
});

describe('SettlementFluxTally', () => {
  it('records cross-settlement visitors and ignores local bustle', () => {
    const t = new SettlementFluxTally();
    t.noteVisitor('poi-b', 'poi-a');
    t.noteVisitor('poi-b', 'poi-a');
    t.noteVisitor('poi-a', 'poi-a');   // local bustle: not flux
    t.noteVisitor('', 'poi-a');        // unhomed: no source settlement
    expect(t.rawFlow('poi-b', 'poi-a')).toBe(2);
    expect(t.activePairs()).toBe(1);
    expect(t.entries()).toEqual([[fluxKey('poi-b', 'poi-a'), 2]]);
  });

  it('round-trips through its snapshot, sorted', () => {
    const t = new SettlementFluxTally();
    t.sinceTick = 42;
    t.noteVisitor('poi-z', 'poi-a');
    t.noteVisitor('poi-b', 'poi-a');
    const s = t.serialize();
    expect(s.flows.map(([k]) => k)).toEqual([fluxKey('poi-b', 'poi-a'), fluxKey('poi-z', 'poi-a')]);
    const back = SettlementFluxTally.fromSnapshot(s);
    expect(back.sinceTick).toBe(42);
    expect(back.serialize()).toEqual(s);
  });

  it('parseFluxKey inverts fluxKey', () => {
    expect(parseFluxKey(fluxKey('poi-b', 'poi-a'))).toEqual({ srcPoiId: 'poi-b', dstPoiId: 'poi-a' });
    expect(parseFluxKey('nonsense')).toBeNull();
  });
});

describe('SettlementAggregateStore — the flux fold', () => {
  it('defers on an uninitialized tally, then folds one full window to a per-day rate', () => {
    const store = new SettlementAggregateStore();
    const tally = new SettlementFluxTally();
    tally.noteVisitor('poi-b', 'poi-a');

    // sinceTick = -1: the first call only anchors the window (RoadUseTally rule).
    expect(store.foldFlux(tally, 1000)).toBe(false);
    expect(tally.sinceTick).toBe(1000);
    expect(tally.rawFlow('poi-b', 'poi-a')).toBe(1);       // counts survive the anchor

    // Short of a full window: still no fold.
    expect(store.foldFlux(tally, 1000 + FLUX_FOLD_WINDOW_TICKS - 1)).toBe(false);
    expect(store.fluxFor('poi-b', 'poi-a')).toBe(0);

    tally.noteVisitor('poi-b', 'poi-a');
    tally.noteVisitor('poi-b', 'poi-a');
    expect(store.foldFlux(tally, 1000 + FLUX_FOLD_WINDOW_TICKS)).toBe(true);
    // Exactly one game-day of window ⇒ the seeded EMA is the raw count itself.
    expect(store.fluxFor('poi-b', 'poi-a')).toBeCloseTo(3, 10);
    expect(tally.activePairs()).toBe(0);                   // window reset
    expect(tally.sinceTick).toBe(1000 + FLUX_FOLD_WINDOW_TICKS);
  });

  it('decays a pair that stops trading instead of freezing its old rate', () => {
    const store = new SettlementAggregateStore();
    const tally = new SettlementFluxTally();
    store.foldFlux(tally, 0);
    for (let i = 0; i < 4; i++) tally.noteVisitor('poi-b', 'poi-a');
    store.foldFlux(tally, FLUX_FOLD_WINDOW_TICKS);
    const seeded = store.fluxFor('poi-b', 'poi-a');
    store.foldFlux(tally, 2 * FLUX_FOLD_WINDOW_TICKS);     // a silent day
    expect(store.fluxFor('poi-b', 'poi-a')).toBeLessThan(seeded);
    expect(store.fluxFor('poi-b', 'poi-a')).toBeGreaterThan(0);
  });

  it('sums directed flows into per-settlement in/out rates', () => {
    const store = new SettlementAggregateStore();
    const tally = new SettlementFluxTally();
    store.foldFlux(tally, 0);
    tally.noteVisitor('poi-b', 'poi-a');
    tally.noteVisitor('poi-c', 'poi-a');
    tally.noteVisitor('poi-a', 'poi-c');
    store.foldFlux(tally, FLUX_FOLD_WINDOW_TICKS);
    expect(store.fluxInFor('poi-a')).toBeCloseTo(2, 10);
    expect(store.fluxOutFor('poi-a')).toBeCloseTo(1, 10);
    expect(store.fluxInFor('poi-c')).toBeCloseTo(1, 10);
  });

  it('round-trips aggregates + EMAs through its snapshot', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const store = new SettlementAggregateStore();
    store.replace(buildSettlementAggregates(world, spirits, { now, cohorts }), now);
    const tally = new SettlementFluxTally();
    store.foldFlux(tally, 0);
    tally.noteVisitor('poi-b', 'poi-a');
    store.foldFlux(tally, FLUX_FOLD_WINDOW_TICKS);

    const s = store.serialize();
    const back = SettlementAggregateStore.fromSnapshot(s);
    expect(back.serialize()).toEqual(s);
    expect(back.computedTick).toBe(now);
    expect(back.get('poi-a')!.population.named).toBe(3);
    expect(back.fluxFor('poi-b', 'poi-a')).toBeCloseTo(1, 10);
    // A hand-built / pre-P1 store restores empty rather than throwing.
    const empty = new SettlementAggregateStore();
    expect(empty.computedTick).toBe(-1);
    expect(empty.size()).toBe(0);
  });
});

describe('SettlementAggregateSystem', () => {
  function ctxFor(world: World, spirits: Map<SpiritId, Spirit>, now: number) {
    const clock = new SimClock();
    clock.setNow(now);
    return { world, spirits, log: new EventLog(clock), clock, rng: createRng(1), dt: 0, now };
  }

  it('sweeps on the game-hour cadence and fills the store', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const store = new SettlementAggregateStore();
    const flux = new SettlementFluxTally();
    const sys = new SettlementAggregateSystem(() => store, () => cohorts, () => flux);
    expect(sys.tickHz).toBeCloseTo(1 / 3600, 12);

    sys.tick(ctxFor(world, spirits, now));
    expect(store.computedTick).toBe(now);
    expect(store.get('poi-a')!.population).toEqual({ named: 3, statistical: 10 });
    // First sweep: no baseline existed, so no trend is claimed.
    expect('populationTrend' in store.get('poi-a')!).toBe(false);
  });

  it('the SECOND sweep measures a trend against the first', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const store = new SettlementAggregateStore();
    const sys = new SettlementAggregateSystem(() => store, () => cohorts, () => null);
    sys.tick(ctxFor(world, spirits, now));
    addNpc(world, 'a4', 'poi-a', {}, 9);
    sys.tick(ctxFor(world, spirits, now * 2));
    expect(store.get('poi-a')!.populationTrend).toBe(1);
    expect(store.get('poi-b')!.populationTrend).toBe(0);
  });

  it('hydrate(undefined) resets the trend baseline (no scrub ghost)', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const store = new SettlementAggregateStore();
    const sys = new SettlementAggregateSystem(() => store, () => cohorts, () => null);
    sys.tick(ctxFor(world, spirits, now));
    expect((sys.serialize() as { baseline: unknown }).baseline).not.toBeNull();

    sys.hydrate(undefined);
    expect((sys.serialize() as { baseline: unknown }).baseline).toBeNull();
    sys.tick(ctxFor(world, spirits, now * 2));
    // A reset baseline means the next sweep claims NO trend, rather than
    // inheriting the discarded future's population.
    expect('populationTrend' in store.get('poi-a')!).toBe(false);
  });

  it('round-trips its baseline through serialize/hydrate, sorted', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const store = new SettlementAggregateStore();
    const sys = new SettlementAggregateSystem(() => store, () => cohorts, () => null);
    sys.tick(ctxFor(world, spirits, now));
    const dump = sys.serialize() as { baseline: [string, number][] };
    expect(dump.baseline.map(([k]) => k)).toEqual(['', 'poi-a', 'poi-b']);

    const other = new SettlementAggregateSystem(() => store, () => cohorts, () => null);
    other.hydrate(structuredClone(dump));
    expect(other.serialize()).toEqual(dump);
  });

  it('writes nothing to the sim — Phase 1 is pure measurement', () => {
    const now = TICKS_PER_DAY;
    const { world, spirits, cohorts } = twoTierWorld(now);
    const before = JSON.stringify(world.query({}));
    const cohortsBefore = JSON.stringify([...cohorts]);
    const spiritsBefore = JSON.stringify([...spirits]);
    const sys = new SettlementAggregateSystem(
      () => new SettlementAggregateStore(), () => cohorts, () => new SettlementFluxTally());
    sys.tick(ctxFor(world, spirits, now));
    expect(JSON.stringify(world.query({}))).toBe(before);
    expect(JSON.stringify([...cohorts])).toBe(cohortsBefore);
    expect(JSON.stringify([...spirits])).toBe(spiritsBefore);
  });
});

describe('GameState wiring', () => {
  it('a fresh state carries an empty, un-swept store and tally', () => {
    const s = createState();
    expect(s.settlementAggregates.computedTick).toBe(-1);
    expect(s.settlementAggregates.size()).toBe(0);
    expect(s.settlementFlux.sinceTick).toBe(-1);
    expect(s.settlementFlux.activePairs()).toBe(0);
  });
});
