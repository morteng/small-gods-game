/**
 * Two-tier population P1 — the belief economy reads statistical cohorts.
 *
 * Covers: worldgen seeding (deterministic, disjoint from the named tier),
 * aggregation reads (SpiritSystem power, believer counts, rival situation),
 * tile realization from aggregate cohort belief (user ruling 2), the housing-
 * derived birth throttle + growth resident counts (spec §5.2), snapshot
 * round-trip, the CohortSystem statistical-tier conservation audit, and the
 * Fate-trigger exemption for statistical claims (user ruling 3).
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent, type AppendedEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { initNpcProps, queryNpcs, npcProps } from '@/world/npc-helpers';
import {
  apportion, seedStatisticalCohorts, cohortPopulation, cohortBelievers,
  cohortContributionTotals, totalCohortBelievers, dominantCohortBelief,
  beliefContribution, emptySettlementCohorts,
  FICTION_POP_BY_SIZE, STAT_BELIEVER_FRAC, STAT_SEED_FAITH,
  type SettlementCohorts,
} from '@/sim/cohorts';
import { SpiritSystem, POWER_REGEN_RATE } from '@/sim/spirit-system';
import { countPlayerBelievers, countDurableBelievers, PLAYER_SPIRIT_ID } from '@/sim/believers';
import { buildRivalSituation } from '@/sim/rival-claims';
import { PerceptionSystem, cohortPerceptionReach, perceptionReach } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { BirthSystem, HOUSING_SLACK } from '@/sim/systems/birth-system';
import { residentsByPoi } from '@/sim/systems/settlement-growth-system';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { FateTrigger } from '@/game/fate/fate-trigger';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity, WorldSeed, Tile } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

// ── harness ──────────────────────────────────────────────────────────────────

function makeMap(w = 32, h = 32, worldSeed: WorldSeed | null = null): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

function seed(name: string, pois: WorldSeed['pois']): WorldSeed {
  return {
    name, size: { width: 32, height: 32 }, biome: 'plains',
    pois, connections: [], constraints: [],
  } as WorldSeed;
}

const villager = { name: 'Someone', role: 'farmer' };

function addAdult(
  world: World, id: string, poiId: string,
  opts: { age?: number; faith?: number; devotion?: number } = {},
): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -(opts.age ?? 30) * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  // initNpcProps seeds a role-scaled default player belief — make belief
  // EXPLICIT here so "heathen" fixtures are actually heathen.
  p.beliefs = {};
  if (opts.faith !== undefined) {
    p.beliefs[PLAYER_SPIRIT_ID] = {
      faith: opts.faith, understanding: 0, devotion: opts.devotion ?? 0,
    };
  }
  const e: Entity = { id, kind: 'npc', x: 2, y: 2, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function playerSpirit(power = 10): Spirit {
  return { id: PLAYER_SPIRIT_ID, name: 'P', sigil: 'x', color: '#fff', isPlayer: true, power, manifestation: null };
}

function rivalSpirit(id: SpiritId, settlements: string[]): Spirit {
  return {
    id, name: id, sigil: 'r', color: '#f00', isPlayer: false, power: 50, manifestation: null,
    ai: { policy: 'opportunist', cooldowns: {}, personality: { aggression: 0.5, patience: 0.5, generosity: 0.5 } as never, settlements },
  };
}

function ctxFor(world: World, seedN = 1, now = 0) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  return { world, spirits: new Map<SpiritId, Spirit>(), log, clock, rng: createRng(seedN), dt: 1000, now };
}

/** A hand-built statistical settlement: `n` souls in the fertile band, of which
 *  `believers` shallowly believe in `sid` (exact running sums). */
function statSettlement(poiId: string, n: number, believers: number, sid: SpiritId, opts: { durable?: number } = {}): SettlementCohorts {
  const sc = emptySettlementCohorts(poiId);
  const band = sc.bands[2]; // 18–45
  band.count = n;
  if (believers > 0) {
    band.belief[sid] = {
      sumFaith: believers * STAT_SEED_FAITH,
      sumU: 0, sumD: 0,
      sumContribution: believers * beliefContribution({ faith: STAT_SEED_FAITH, understanding: 0, devotion: 0 }),
      believerCount: believers,
      durableCount: opts.durable ?? 0,
    };
  }
  return sc;
}

// ── apportion ────────────────────────────────────────────────────────────────

describe('apportion (largest remainder)', () => {
  it('sums to the total and starves zero-weight slots', () => {
    const out = apportion(30, [0.32, 0.06, 0.40, 0, 0.09, 0.03]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(30);
    expect(out[3]).toBe(0);
    expect(out[2]).toBeGreaterThan(out[1]); // proportionality
  });
  it('is deterministic and handles degenerate inputs', () => {
    expect(apportion(10, [1, 1])).toEqual(apportion(10, [1, 1]));
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
  });
});

// ── worldgen seeding ─────────────────────────────────────────────────────────

describe('seedStatisticalCohorts', () => {
  const cradlePois = seed('w', [
    { id: 'cradle', type: 'village', position: { x: 5, y: 5 }, npcs: [villager] },
    { id: 'peak', type: 'mountain' }, // uninhabited — no cohorts
  ]);

  function cradleWorld(): { world: World; spirits: Map<SpiritId, Spirit> } {
    const world = new World(makeMap());
    for (let i = 0; i < 6; i++) addAdult(world, `c${i}`, 'cradle', { faith: 0.18 });
    const spirits = new Map<SpiritId, Spirit>([[PLAYER_SPIRIT_ID, playerSpirit()]]);
    return { world, spirits };
  }

  it('seeds fiction target minus named residents — tiers disjoint by construction', () => {
    const { world, spirits } = cradleWorld();
    const cohorts = seedStatisticalCohorts(world, cradlePois, spirits, 0);
    const sc = cohorts.get('cradle')!;
    expect(cohortPopulation(sc)).toBe(FICTION_POP_BY_SIZE.small - 6);
    expect(cohorts.has('peak')).toBe(false);       // no authored npcs → no cohorts
    expect(queryNpcs(world)).toHaveLength(6);       // named tier untouched
  });

  it('leans a conservative believer fraction toward the dominant spirit with exact sums', () => {
    const { world, spirits } = cradleWorld();
    const cohorts = seedStatisticalCohorts(world, cradlePois, spirits, 0);
    const sc = cohorts.get('cradle')!;
    const statPop = FICTION_POP_BY_SIZE.small - 6;
    const expected = Math.round(statPop * STAT_BELIEVER_FRAC);
    expect(cohortBelievers(sc, PLAYER_SPIRIT_ID)).toBe(expected);
    const totals = cohortContributionTotals(cohorts);
    const per = beliefContribution({ faith: STAT_SEED_FAITH, understanding: 0, devotion: 0 });
    expect(totals.get(PLAYER_SPIRIT_ID)).toBeCloseTo(expected * per, 12);
    // Believers live only in adult bands.
    expect(sc.bands[0].belief[PLAYER_SPIRIT_ID]).toBeUndefined();
  });

  it('a rival-held settlement with no named believers leans toward that rival', () => {
    const world = new World(makeMap());
    const spirits = new Map<SpiritId, Spirit>([
      [PLAYER_SPIRIT_ID, playerSpirit()],
      ['rival-1', rivalSpirit('rival-1', ['fort'])],
    ]);
    const ws = seed('w', [{ id: 'fort', type: 'village', position: { x: 9, y: 9 }, npcs: [villager] }]);
    const cohorts = seedStatisticalCohorts(world, ws, spirits, 0);
    const sc = cohorts.get('fort')!;
    expect(cohortBelievers(sc, 'rival-1')).toBeGreaterThan(0);
    expect(cohortBelievers(sc, PLAYER_SPIRIT_ID)).toBe(0);
    expect(dominantCohortBelief(sc)?.spiritId).toBe('rival-1');
  });

  it('an unheld settlement with no believing residents seeds heathen', () => {
    const world = new World(makeMap());
    addAdult(world, 'h1', 'hamlet'); // no beliefs
    const ws = seed('w', [{ id: 'hamlet', type: 'village', position: { x: 3, y: 3 }, npcs: [villager] }]);
    const cohorts = seedStatisticalCohorts(world, ws, new Map(), 0);
    const sc = cohorts.get('hamlet')!;
    expect(cohortPopulation(sc)).toBe(FICTION_POP_BY_SIZE.small - 1);
    expect(dominantCohortBelief(sc)).toBeNull();
  });

  it('is deterministic and independent of named-entity insertion order (no rng)', () => {
    const run = (order: number[]) => {
      const world = new World(makeMap());
      for (const i of order) addAdult(world, `c${i}`, 'cradle', { faith: 0.18 });
      const spirits = new Map<SpiritId, Spirit>([[PLAYER_SPIRIT_ID, playerSpirit()]]);
      return JSON.stringify([...seedStatisticalCohorts(world, cradlePois, spirits, 0).entries()]);
    };
    expect(run([0, 1, 2, 3, 4, 5])).toBe(run([5, 3, 1, 0, 4, 2]));
  });
});

// ── the belief economy reads cohorts ─────────────────────────────────────────

describe('SpiritSystem reads the statistical tier (P1)', () => {
  it('adds cohort sumContribution to power regen with the identical formula', () => {
    const world = new World(makeMap());
    addAdult(world, 'n1', 'town', { faith: 0.5 });
    const cohorts = new Map([['town', statSettlement('town', 30, 10, PLAYER_SPIRIT_ID)]]);
    const ctx = ctxFor(world);
    ctx.spirits.set(PLAYER_SPIRIT_ID, playerSpirit(10));
    new SpiritSystem(() => cohorts).tick(ctx as never);
    const named = 0.5; // faith 0.5, u=d=0
    const stat = 10 * beliefContribution({ faith: STAT_SEED_FAITH, understanding: 0, devotion: 0 });
    expect(ctx.spirits.get(PLAYER_SPIRIT_ID)!.power).toBeCloseTo(10 + (named + stat) * POWER_REGEN_RATE, 12);
  });

  it('P0 equivalence: an empty statistical tier changes nothing', () => {
    const run = (sys: SpiritSystem) => {
      const world = new World(makeMap());
      addAdult(world, 'n1', 'town', { faith: 0.5 });
      const ctx = ctxFor(world);
      ctx.spirits.set(PLAYER_SPIRIT_ID, playerSpirit(10));
      sys.tick(ctx as never);
      return ctx.spirits.get(PLAYER_SPIRIT_ID)!.power;
    };
    expect(run(new SpiritSystem(() => new Map()))).toBe(run(new SpiritSystem()));
  });

  it('is replay-stable: Map insertion order does not change the float fold', () => {
    const a = statSettlement('aaa', 10, 3, PLAYER_SPIRIT_ID);
    const b = statSettlement('bbb', 10, 7, PLAYER_SPIRIT_ID);
    const run = (m: Map<string, SettlementCohorts>) => {
      const ctx = ctxFor(new World(makeMap()));
      ctx.spirits.set(PLAYER_SPIRIT_ID, playerSpirit(0));
      new SpiritSystem(() => m).tick(ctx as never);
      return ctx.spirits.get(PLAYER_SPIRIT_ID)!.power;
    };
    expect(run(new Map([['aaa', a], ['bbb', b]]))).toBe(run(new Map([['bbb', b], ['aaa', a]])));
  });
});

describe('believer counts read both tiers', () => {
  it('countPlayerBelievers/countDurableBelievers = named + statistical, never double-counted', () => {
    const world = new World(makeMap());
    addAdult(world, 'n1', 'town', { faith: 0.5, devotion: 0.5 }); // durable named believer
    addAdult(world, 'n2', 'town');                                 // heathen named
    const cohorts = new Map([['town', statSettlement('town', 30, 10, PLAYER_SPIRIT_ID, { durable: 2 })]]);
    expect(countPlayerBelievers(world)).toBe(1);
    expect(countPlayerBelievers(world, cohorts)).toBe(1 + 10);
    expect(countDurableBelievers(world, cohorts)).toBe(1 + 2);
    expect(totalCohortBelievers(cohorts, PLAYER_SPIRIT_ID)).toBe(10);
  });
});

describe('buildRivalSituation reads the statistical tier', () => {
  it('folds aggregate believers into both follower maps', () => {
    const world = new World(makeMap());
    addAdult(world, 'n1', 'town', { faith: 0.5 });
    const town = statSettlement('town', 40, 5, PLAYER_SPIRIT_ID);
    town.bands[2].belief['rival-1'] = {
      sumFaith: 7 * STAT_SEED_FAITH, sumU: 0, sumD: 0,
      sumContribution: 7 * STAT_SEED_FAITH, believerCount: 7, durableCount: 0,
    };
    const cohorts = new Map([['town', town]]);
    const spirits = new Map<SpiritId, Spirit>([
      [PLAYER_SPIRIT_ID, playerSpirit()],
      ['rival-1', rivalSpirit('rival-1', ['town'])],
    ]);
    const sit = buildRivalSituation(world, spirits, 'rival-1', { cohorts });
    expect(sit.playerFollowersInSettlement['town']).toBe(1 + 5);
    expect(sit.rivalFollowersInSettlement['town']).toBe(7);
    const bare = buildRivalSituation(world, spirits, 'rival-1', {});
    expect(bare.playerFollowersInSettlement['town']).toBe(1); // opt-in, not ambient
  });
});

// ── tile realization (user ruling 2) ─────────────────────────────────────────

describe('PerceptionSystem: aggregate cohort belief realizes tiles', () => {
  it('pins the cohort reach formula (named formula at population means + log2 crowd term)', () => {
    const stats = { spiritId: PLAYER_SPIRIT_ID, believerCount: 15, meanFaith: 0.05, meanUnderstanding: 0 };
    expect(cohortPerceptionReach(stats)).toBe(perceptionReach(0.05, 0) + 4); // floor(log2(16)) = 4
  });

  it('realizes a disc at the settlement anchor with ZERO named believers present', () => {
    const ws = seed('w', [{ id: 'town', type: 'village', position: { x: 16, y: 16 }, npcs: [villager] }]);
    const map = makeMap(32, 32, ws);
    const world = new World(map);
    const cohorts = new Map([['town', statSettlement('town', 40, 10, PLAYER_SPIRIT_ID)]]);
    const sys = new PerceptionSystem(identityOracle, () => map, undefined, () => cohorts);
    const ctx = ctxFor(world);
    sys.tick(ctx as never);
    expect(map.tiles[16][16].state).toBe('realized');
    expect(map.tiles[0][0].state).toBe('void'); // bounded reach
  });

  it('without the statistical tier nothing realizes (pre-P1 behavior preserved)', () => {
    const ws = seed('w', [{ id: 'town', type: 'village', position: { x: 16, y: 16 }, npcs: [villager] }]);
    const map = makeMap(32, 32, ws);
    const sys = new PerceptionSystem(identityOracle, () => map);
    sys.tick(ctxFor(new World(map)) as never);
    expect(map.tiles[16][16].state).toBe('void');
  });

  it('a heathen statistical settlement (no believers) opens nothing', () => {
    const ws = seed('w', [{ id: 'town', type: 'village', position: { x: 16, y: 16 }, npcs: [villager] }]);
    const map = makeMap(32, 32, ws);
    const cohorts = new Map([['town', statSettlement('town', 40, 0, PLAYER_SPIRIT_ID)]]);
    const sys = new PerceptionSystem(identityOracle, () => map, undefined, () => cohorts);
    sys.tick(ctxFor(new World(map)) as never);
    expect(map.tiles[16][16].state).toBe('void');
  });
});

// ── housing-gated births + growth counts (§5.2) ──────────────────────────────

describe('BirthSystem: housing-derived combined throttle', () => {
  function fertilePair(world: World): void {
    addAdult(world, 'mum', 'village', { age: 28 });
    addAdult(world, 'dad', 'village', { age: 31 });
  }
  const births = (sys: BirthSystem, world: World, ticks: number): number => {
    const { ctx } = (() => {
      const clock = new SimClock();
      const log = new EventLog(clock);
      return { ctx: { world, spirits: new Map(), log, clock, rng: createRng(7), dt: 1000, now: 0 } };
    })();
    let n = 0;
    ctx.log.subscribe((a: AppendedEvent) => { if (a.event.type === 'npc_birth') n++; });
    for (let t = 0; t < ticks; t++) sys.tick({ ...ctx, now: t } as never);
    return n;
  };

  it('statistical souls consume housing headroom — an overcrowded town stops birthing', () => {
    const world = new World(makeMap());
    fertilePair(world);
    const cohorts = new Map([['village', statSettlement('village', 100, 0, PLAYER_SPIRIT_ID)]]);
    const sys = new BirthSystem({
      cohorts: () => cohorts,
      housingCapacity: () => new Map([['village', 40]]), // cap = 50 < 102 combined
    });
    expect(births(sys, world, 50_000)).toBe(0);
  });

  it('with housing headroom the same pair births (cap = capacity × HOUSING_SLACK)', () => {
    const world = new World(makeMap());
    fertilePair(world);
    const cohorts = new Map([['village', statSettlement('village', 100, 0, PLAYER_SPIRIT_ID)]]);
    const sys = new BirthSystem({
      cohorts: () => cohorts,
      housingCapacity: () => new Map([['village', Math.ceil(200 / HOUSING_SLACK)]]),
    });
    expect(births(sys, world, 100_000)).toBeGreaterThan(0);
  });

  it('POIs without housing data keep the legacy POP_CAP behavior', () => {
    const world = new World(makeMap());
    fertilePair(world);
    expect(births(new BirthSystem({}), world, 100_000)).toBeGreaterThan(0);
  });
});

describe('residentsByPoi reads the statistical tier', () => {
  it('adds cohort population to the named resident count', () => {
    const world = new World(makeMap());
    addAdult(world, 'n1', 'town');
    addAdult(world, 'n2', 'town');
    const cohorts = new Map([['town', statSettlement('town', 30, 0, PLAYER_SPIRIT_ID)]]);
    expect(residentsByPoi(world).get('town')).toBe(2);
    expect(residentsByPoi(world, cohorts).get('town')).toBe(32);
  });
});

// ── snapshot round-trip ──────────────────────────────────────────────────────

describe('statistical tier snapshot round-trip', () => {
  it('captures and restores state.cohorts exactly (and unaliased)', () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    state.cohorts = new Map([['town', statSettlement('town', 30, 10, PLAYER_SPIRIT_ID)]]);
    const snap = captureSnapshot(state);
    const before = JSON.stringify([...state.cohorts.entries()]);
    state.cohorts.get('town')!.bands[2].count = 999; // post-snapshot mutation
    restoreSnapshot(state, snap);
    expect(JSON.stringify([...state.cohorts.entries()])).toBe(before);
    // Restored tier must not alias the snapshot's copies.
    state.cohorts.get('town')!.bands[2].count = 5;
    expect(snap.statCohorts![0].bands[2].count).toBe(30);
  });

  it('a pre-P1 snapshot (no statCohorts field) restores an empty tier', () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    state.cohorts = new Map([['town', statSettlement('town', 30, 0, PLAYER_SPIRIT_ID)]]);
    const snap = captureSnapshot(state);
    delete snap.statCohorts;
    restoreSnapshot(state, snap);
    expect(state.cohorts.size).toBe(0);
  });
});

// ── conservation audit ───────────────────────────────────────────────────────

describe('CohortSystem audits the statistical tier (P1: counts are constant)', () => {
  it('flags a minted/vanished statistical soul as a conservation violation, then self-heals', () => {
    const world = new World(makeMap());
    addAdult(world, 'n1', 'town');
    const stat = new Map([['town', statSettlement('town', 30, 0, PLAYER_SPIRIT_ID)]]);
    const sys = new CohortSystem(() => stat);
    const ctx = ctxFor(world);
    const errors: string[] = [];
    ctx.log.subscribe((a: AppendedEvent) => {
      if (a.event.type === 'system_error') errors.push(a.event.message);
    });
    sys.tick(ctx as never);                       // baseline adopted
    expect(sys.ledgerCounters().violations).toBe(0);
    stat.get('town')!.bands[2].count += 5;        // houses-mint-people, statistically
    sys.tick(ctx as never);
    expect(sys.ledgerCounters().violations).toBe(1);
    expect(errors.some(m => m.includes("statistical tier 'town'"))).toBe(true);
    sys.tick(ctx as never);                       // self-healed: baseline re-adopted
    expect(sys.ledgerCounters().violations).toBe(1);
  });

  it('serializes the statistical baseline (scrub-back restores what the future diffed against)', () => {
    const world = new World(makeMap());
    const stat = new Map([['town', statSettlement('town', 30, 0, PLAYER_SPIRIT_ID)]]);
    const sys = new CohortSystem(() => stat);
    sys.tick(ctxFor(world) as never);
    const saved = structuredClone(sys.serialize());
    const sys2 = new CohortSystem(() => stat);
    sys2.hydrate(saved);
    // A hydrated system sees the unchanged tier as clean, not as a fresh diff.
    const ctx = ctxFor(world);
    sys2.tick(ctx as never);
    expect(sys2.ledgerCounters().violations).toBe(0);
  });
});

// ── Fate exemption (user ruling 3) ───────────────────────────────────────────

describe('FateTrigger exempts statistical claims', () => {
  let id = 1;
  const appended = (event: SimEvent): AppendedEvent => ({ id: id++, t: 0, event });
  function harness() {
    const clock = new SimClock();
    clock.now = () => 1000;
    const fired: unknown[] = [];
    const trig = new FateTrigger({
      clock, cooldownTicks: 1, isReady: () => true, onTrigger: (f) => fired.push(f),
    });
    return { trig, fired };
  }

  it('two NAMED rival claims wake Fate; two STATISTICAL claims do not', () => {
    const named = harness();
    named.trig.onEvent(appended({ type: 'answer_prayer', spiritId: 'rival-1', npcId: 'n1' }));
    named.trig.onEvent(appended({ type: 'answer_prayer', spiritId: 'rival-1', npcId: 'n2' }));
    expect(named.fired).toHaveLength(1);

    const stat = harness();
    stat.trig.onEvent(appended({ type: 'answer_prayer', spiritId: 'rival-1', npcId: 'n1', statistical: true }));
    stat.trig.onEvent(appended({ type: 'answer_prayer', spiritId: 'rival-1', npcId: 'n2', statistical: true }));
    expect(stat.fired).toHaveLength(0);
  });
});
