/**
 * CohortDynamicsSystem (interaction scaling P3) — the statistical tier's laws
 * wired to the live sim: drift then migration, once per GAME_HOUR, off the
 * aggregate sweep's numbers and the road graph.
 *
 * The wiring is where a mean-field layer most easily goes silently wrong: a
 * system that reads a store nobody filled, or a road query that returns nothing,
 * produces a perfectly quiet no-op. Every test here therefore asserts something
 * MOVED as well as that it moved correctly.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { GAME_HOUR_HZ } from '@/core/calendar';
import { CohortDynamicsSystem } from '@/sim/systems/cohort-dynamics-system';
import { SettlementFluxTally } from '@/sim/settlement-flux';
import {
  buildSettlementAggregates, SettlementAggregateStore,
} from '@/sim/settlement-aggregates';
import {
  addSoul, cohortPopulation, emptySettlementCohorts, YOUNG_ADULT_BAND_INDEX,
  type SettlementCohorts,
} from '@/sim/cohorts';
import { applyCohortTithe } from '@/sim/cohorts';
import type { GameMap, WorldSeed } from '@/core/types';

/** Two POIs, one road edge — the smallest world migration can happen in. */
function twoTownMap(): GameMap {
  const worldSeed = {
    name: 'test', size: { width: 32, height: 32 }, biome: 'plains',
    pois: [
      { id: 'alpha', name: 'Alpha', type: 'village', position: { x: 4, y: 4 }, size: 'medium', npcs: [{ name: 'a', role: 'farmer' }] },
      { id: 'beta', name: 'Beta', type: 'village', position: { x: 20, y: 4 }, size: 'medium', npcs: [{ name: 'b', role: 'farmer' }] },
    ],
    connections: [], constraints: [],
  } as unknown as WorldSeed;
  const roadGraph = {
    nodes: [
      { id: 'n_alpha', x: 4, y: 4, kind: 'poi', poiRef: 'alpha' },
      { id: 'n_beta', x: 20, y: 4, kind: 'poi', poiRef: 'beta' },
    ],
    edges: [
      { id: 'e0', a: 'n_alpha', b: 'n_beta', polyline: [], feature: 'road', class: 'track', surface: 'dirt', bridgeCells: [] },
    ],
  };
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed, roadGraph, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function village(poiId: string, n: number, believers: number, faith = 0.4): SettlementCohorts {
  const sc = emptySettlementCohorts(poiId);
  for (let i = 0; i < n; i++) {
    addSoul(sc, {
      age: 30,
      beliefs: i < believers ? { player: { faith, understanding: 0.1, devotion: 0.05 } } : {},
      needs: { safety: 0.6, prosperity: 0.5, community: 0.8, meaning: 0.5 },
    });
  }
  return sc;
}

function faithMass(sc: SettlementCohorts): number {
  let n = 0;
  for (const band of sc.bands) n += band.belief.player?.sumFaith ?? 0;
  return n;
}

interface Rig {
  world: World;
  cohorts: Map<string, SettlementCohorts>;
  store: SettlementAggregateStore;
  flux: SettlementFluxTally;
  log: EventLog;
  sys: CohortDynamicsSystem;
  sweep(now: number): void;
  tick(now: number): void;
}

function rig(): Rig {
  const map = twoTownMap();
  const world = new World(map);
  const clock = new SimClock();
  const log = new EventLog(clock);
  const cohorts = new Map<string, SettlementCohorts>([
    ['alpha', village('alpha', 72, 18)],
    ['beta', village('beta', 72, 18)],
  ]);
  const store = new SettlementAggregateStore();
  const flux = new SettlementFluxTally();
  const sys = new CohortDynamicsSystem(() => cohorts, () => store, () => map, () => flux);
  const ctx = (now: number) => ({
    world, spirits: new Map(), log, clock, rng: createRng(5), dt: 1000, now,
  });
  return {
    world, cohorts, store, flux, log, sys,
    sweep(now) { store.replace(buildSettlementAggregates(world, new Map(), { now, cohorts }), now); },
    tick(now) { sys.tick(ctx(now) as never); },
  };
}

describe('CohortDynamicsSystem', () => {
  it('runs at the day-keyed observer cadence and carries no scrub-ghost state', () => {
    const sys = new CohortDynamicsSystem(() => null, () => null, () => null);
    expect(sys.name).toBe('cohort_dynamics');
    expect(sys.tickHz).toBe(GAME_HOUR_HZ);
    // Deliberately NOT a SerializableSystem: the drift's memory is the cohorts
    // and the migration's is `SettlementCohorts.migrationFrac`, both of which
    // ride the Snapshot with `state.cohorts`. Nothing else to restore.
    expect('serialize' in sys).toBe(false);
  });

  it('drifts belief without moving a single soul', () => {
    const r = rig();
    r.sweep(0);
    const popBefore = cohortPopulation(r.cohorts.get('alpha')!);
    const massBefore = faithMass(r.cohorts.get('alpha')!);
    r.tick(1_000_000);
    expect(cohortPopulation(r.cohorts.get('alpha')!)).toBe(popBefore);
    expect(faithMass(r.cohorts.get('alpha')!)).not.toBe(massBefore);
  });

  it('is a no-op with no aggregate sweep to read — but drift still runs', () => {
    // Migration needs a prospect signal and refuses to invent one (the
    // explicit-baseline rule). Belief drift needs nothing but the cohorts.
    const r = rig();
    const massBefore = faithMass(r.cohorts.get('alpha')!);
    r.tick(1_000_000);                       // never swept
    expect(faithMass(r.cohorts.get('alpha')!)).not.toBe(massBefore);
    expect(r.flux.activePairs()).toBe(0);
  });

  it('moves young adults out of the taxed settlement, conserving souls and ledgering the flow', () => {
    const r = rig();
    // The one live differentiator on the shipped world: the lord's tithe, which
    // `applyCohortTithe` presses onto the statistical tier's prosperity.
    for (let i = 0; i < 200; i++) applyCohortTithe(r.cohorts.get('alpha')!, 0.8, 0.1);
    const totalBefore = cohortPopulation(r.cohorts.get('alpha')!) + cohortPopulation(r.cohorts.get('beta')!);
    const alphaBefore = r.cohorts.get('alpha')!.bands[YOUNG_ADULT_BAND_INDEX].count;

    let now = 0;
    for (let hour = 0; hour < 200; hour++) {
      now += 1_000_000;
      r.sweep(now);
      r.tick(now);
    }

    const alphaAfter = r.cohorts.get('alpha')!.bands[YOUNG_ADULT_BAND_INDEX].count;
    expect(alphaAfter).toBeLessThan(alphaBefore);
    expect(cohortPopulation(r.cohorts.get('alpha')!) + cohortPopulation(r.cohorts.get('beta')!))
      .toBe(totalBefore);

    // Every move is metered on the cross-settlement flux and ledgered.
    expect(r.flux.rawFlow('alpha', 'beta')).toBe(alphaBefore - alphaAfter);
    let ledgered = 0;
    for (const { event } of r.log.since(0)) {
      if (event.type === 'souls_migrated') {
        expect(event.srcPoiId).toBe('alpha');
        expect(event.dstPoiId).toBe('beta');
        ledgered += event.count;
      }
    }
    expect(ledgered).toBe(alphaBefore - alphaAfter);
  });

  it('is deterministic: two identical rigs land byte-identical', () => {
    const run = () => {
      const r = rig();
      for (let i = 0; i < 200; i++) applyCohortTithe(r.cohorts.get('alpha')!, 0.8, 0.1);
      let now = 0;
      for (let hour = 0; hour < 40; hour++) {
        now += 1_000_000;
        r.sweep(now);
        r.tick(now);
      }
      return JSON.stringify([...r.cohorts.entries()].sort());
    };
    expect(run()).toBe(run());
  });
});
