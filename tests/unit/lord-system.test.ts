// M3 (mortal power) — the lord: seat attachment, dynasty succession, lapse,
// and the tithe economy hitting BOTH population tiers (the spec's cohort
// double-accounting warning). Harness style mirrors npc-activity-system.test.ts.
import { describe, it, expect } from 'vitest';
import { LordSystem, COHORT_TITHE_RELAX_PER_HOUR } from '@/sim/systems/lord-system';
import { DEFAULT_TITHE, UNREST_RELAX_PER_HOUR, selectLord, titheRateFor, workRestoreScale, buildLordSituation } from '@/sim/lord';
import { emptySettlementCohorts, applyCohortTithe, STAT_UNTITHED_PROSPERITY, type SettlementCohorts } from '@/sim/cohorts';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { EventLog, SilentEventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { createState } from '@/core/state';
import type { Entity, GameMap, NpcRole, Tile } from '@/core/types';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function addNpc(world: World, id: string, role: NpcRole, opts: { poiId?: string; birthTick?: number; lineageId?: string } = {}): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  props.homeX = 10; props.homeY = 10;
  props.homePoiId = opts.poiId ?? 'poi1';
  props.birthTick = opts.birthTick ?? 0;
  props.lineageId = opts.lineageId ?? id;
  const e: Entity = { id, kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function createContext(world: World, tick = 1000, log?: EventLog) {
  const clock = { now: () => tick, advance: () => {} } as unknown as SimClock;
  return {
    world, spirits: new Map(),
    log: log ?? new SilentEventLog(null as never),
    clock, rng: createRng(7), dt: 1000, now: tick,
  };
}

describe('LordSystem — seats and succession', () => {
  it('attaches the ELDEST resident noble as lord and logs lord_risen', () => {
    const world = new World(makeMap());
    addNpc(world, 'young', 'noble', { birthTick: 500 });
    addNpc(world, 'old', 'noble', { birthTick: 100 });
    addNpc(world, 'peasant', 'farmer');
    const log = new EventLog(new SimClock());
    new LordSystem().tick(createContext(world, 1000, log));

    const seat = world.lords.get('poi1')!;
    expect(seat).toBeDefined();
    expect(seat.npcId).toBe('old');
    expect(seat.lineageId).toBe('old');
    expect(seat.tithe).toBe(DEFAULT_TITHE);
    expect(seat.keepTier).toBe(0);
    expect(log.range(0, 1).map(a => a.event)).toContainEqual(
      { type: 'lord_risen', poiId: 'poi1', npcId: 'old', lineageId: 'old', succession: false },
    );
  });

  it('a settlement with no noble never gets a seat', () => {
    const world = new World(makeMap());
    addNpc(world, 'peasant', 'farmer');
    new LordSystem().tick(createContext(world));
    expect(world.lords.size).toBe(0);
  });

  it('succession prefers the dead lord\'s LINEAGE over an older rival house (dynasty is free)', () => {
    const world = new World(makeMap());
    const lord = addNpc(world, 'aldric', 'noble', { birthTick: 0, lineageId: 'house-a' });
    addNpc(world, 'elder-rival', 'noble', { birthTick: 50, lineageId: 'house-b' });
    addNpc(world, 'heir', 'noble', { birthTick: 900, lineageId: 'house-a' });
    const sys = new LordSystem();
    sys.tick(createContext(world, 1000));
    expect(world.lords.get('poi1')!.npcId).toBe('aldric');

    // The lord dies (kind flips off 'npc', as killNpc does).
    world.updateEntity(lord.id, { kind: 'remains' });
    const log = new EventLog(new SimClock());
    sys.tick(createContext(world, 2000, log));

    const seat = world.lords.get('poi1')!;
    expect(seat.npcId).toBe('heir');                     // same house, though younger
    expect(seat.lineageId).toBe('house-a');
    expect(log.range(0, 1).map(a => a.event)).toContainEqual(
      { type: 'lord_risen', poiId: 'poi1', npcId: 'heir', lineageId: 'house-a', succession: true },
    );
  });

  it('falls back to the eldest noble of any house when the line is spent', () => {
    const world = new World(makeMap());
    const lord = addNpc(world, 'aldric', 'noble', { birthTick: 0, lineageId: 'house-a' });
    addNpc(world, 'rival', 'noble', { birthTick: 50, lineageId: 'house-b' });
    const sys = new LordSystem();
    sys.tick(createContext(world, 1000));
    world.updateEntity(lord.id, { kind: 'remains' });
    sys.tick(createContext(world, 2000));
    expect(world.lords.get('poi1')!.npcId).toBe('rival');
  });

  it('the seat LAPSES when no noble remains to succeed', () => {
    const world = new World(makeMap());
    const lord = addNpc(world, 'aldric', 'noble');
    addNpc(world, 'peasant', 'farmer');
    const sys = new LordSystem();
    sys.tick(createContext(world, 1000));
    expect(world.lords.size).toBe(1);
    world.updateEntity(lord.id, { kind: 'remains' });
    sys.tick(createContext(world, 2000));
    expect(world.lords.size).toBe(0);
  });

  it('succession keeps the seat\'s learned rule (tithe/unrest persist across holders)', () => {
    const world = new World(makeMap());
    const lord = addNpc(world, 'aldric', 'noble', { lineageId: 'house-a' });
    addNpc(world, 'heir', 'noble', { birthTick: 900, lineageId: 'house-a' });
    const sys = new LordSystem();
    sys.tick(createContext(world, 1000));
    const seat = world.lords.get('poi1')!;
    seat.tithe = 0.6;
    seat.unrest = 0.4;
    world.updateEntity(lord.id, { kind: 'remains' });
    sys.tick(createContext(world, 2000));
    const after = world.lords.get('poi1')!;
    expect(after.npcId).toBe('heir');
    expect(after.tithe).toBe(0.6);
    expect(after.unrest).toBeGreaterThan(0.4);           // relaxing toward the 0.6 tithe
  });
});

describe('LordSystem — the tithe economy (both tiers)', () => {
  it('recomputes the garrison headcount from resident soldiers each fire', () => {
    const world = new World(makeMap());
    addNpc(world, 'lord', 'noble');
    addNpc(world, 's1', 'soldier');
    addNpc(world, 's2', 'soldier');
    addNpc(world, 'elsewhere', 'soldier', { poiId: 'poi2' });
    const sys = new LordSystem();
    sys.tick(createContext(world));
    expect(world.lords.get('poi1')!.garrison).toBe(2);
  });

  it('unrest relaxes toward the tithe rate each game hour', () => {
    const world = new World(makeMap());
    addNpc(world, 'lord', 'noble');
    const sys = new LordSystem();
    sys.tick(createContext(world, 1000));
    const seat = world.lords.get('poi1')!;
    seat.tithe = 0.8;
    expect(seat.unrest).toBeCloseTo(DEFAULT_TITHE * UNREST_RELAX_PER_HOUR, 10);   // first fire, from 0 toward 0.1
    const before = seat.unrest;
    sys.tick(createContext(world, 2000));
    expect(seat.unrest).toBeCloseTo(before + (0.8 - before) * UNREST_RELAX_PER_HOUR, 10);
  });

  it('presses the tithe onto the STATISTICAL tier: cohort prosperity relaxes toward the tithed equilibrium', () => {
    const world = new World(makeMap());
    addNpc(world, 'lord', 'noble');
    const sc = emptySettlementCohorts('poi1');
    sc.bands[2].count = 10;
    sc.bands[2].needs.prosperity = STAT_UNTITHED_PROSPERITY;
    const cohorts = new Map<string, SettlementCohorts>([['poi1', sc]]);
    const sys = new LordSystem(() => cohorts);
    sys.tick(createContext(world, 1000));
    world.lords.get('poi1')!.tithe = 0.5;
    sys.tick(createContext(world, 2000));

    const target = STAT_UNTITHED_PROSPERITY * (1 - 0.5);
    const expected = STAT_UNTITHED_PROSPERITY
      // fire 1 at DEFAULT_TITHE (target 0.45), fire 2 at 0.5:
      + (STAT_UNTITHED_PROSPERITY * (1 - DEFAULT_TITHE) - STAT_UNTITHED_PROSPERITY) * COHORT_TITHE_RELAX_PER_HOUR;
    const afterFire2 = expected + (target - expected) * COHORT_TITHE_RELAX_PER_HOUR;
    expect(sc.bands[2].needs.prosperity).toBeCloseTo(afterFire2, 10);
    // Empty bands stay untouched (their means are meaningless).
    expect(sc.bands[0].needs.prosperity).toBe(0);
    // Counts NEVER move — the P1 conservation audit is over counts.
    expect(sc.bands[2].count).toBe(10);
  });

  it('cohort prosperity RECOVERS when the tithe is eased back to 0', () => {
    const sc = emptySettlementCohorts('poi1');
    sc.bands[2].count = 5;
    sc.bands[2].needs.prosperity = 0.2;                  // ground down by years of extraction
    applyCohortTithe(sc, 0, 0.5);
    expect(sc.bands[2].needs.prosperity).toBeCloseTo(0.35, 10);   // climbing back toward 0.5
  });

  it('the named-tier half: workRestoreScale/titheRateFor read the seat (0 when unseated)', () => {
    const world = new World(makeMap());
    expect(titheRateFor(world, 'poi1')).toBe(0);
    expect(titheRateFor(world, undefined)).toBe(0);
    world.lords.set('poi1', { npcId: 'l', lineageId: 'l', tithe: 0.3, garrison: 0, unrest: 0, keepTier: 0 });
    expect(titheRateFor(world, 'poi1')).toBe(0.3);
    expect(workRestoreScale(0.3)).toBeCloseTo(0.7, 10);
    expect(workRestoreScale(0)).toBe(1);
    expect(workRestoreScale(2)).toBe(0);                 // clamped — never a negative restore
  });
});

describe('buildLordSituation — pure, both tiers (buildRivalSituation pattern)', () => {
  it('counts named residents AND statistical souls, means over each tier', () => {
    const world = new World(makeMap());
    const a = addNpc(world, 'a', 'farmer');
    const b = addNpc(world, 'b', 'farmer');
    addNpc(world, 'far', 'farmer', { poiId: 'poi2' });
    npcProps(a).needs.prosperity = 0.2;
    npcProps(b).needs.prosperity = 0.4;
    npcProps(a).prayerSince = 0;                          // an old standing plea
    npcProps(a).activity = 'worship';
    const sc = emptySettlementCohorts('poi1');
    sc.bands[2].count = 10;
    sc.bands[2].needs.prosperity = 0.5;
    const seat = { npcId: 'l', lineageId: 'l', tithe: 0.25, garrison: 3, unrest: 0.1, keepTier: 0 };
    const now = 10_000_000;                               // plea age ≥ warning window

    const sit = buildLordSituation(world, new Map([['poi1', sc]]), 'poi1', seat, now);
    expect(sit.namedPopulation).toBe(2);
    expect(sit.statPopulation).toBe(10);
    expect(sit.meanProsperityNamed).toBeCloseTo(0.3, 10);
    expect(sit.meanProsperityStat).toBeCloseTo(0.5, 10);
    expect(sit.prayerPressure).toBe(1);
    expect(sit).toMatchObject({ tithe: 0.25, unrest: 0.1, garrison: 3 });
  });

  it('selectLord is deterministic: eldest first, id tiebreak', () => {
    const world = new World(makeMap());
    addNpc(world, 'b-noble', 'noble', { birthTick: 100 });
    addNpc(world, 'a-noble', 'noble', { birthTick: 100 });
    expect(selectLord(world, 'poi1')!.id).toBe('a-noble');
    expect(selectLord(world, 'poi9')).toBeNull();
  });
});

describe('LordState — snapshot round-trip', () => {
  it('captures and restores World.lords (and a pre-lord snapshot restores to no seats)', () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    addNpc(state.world, 'lord', 'noble');
    state.world.lords.set('poi1', { npcId: 'lord', lineageId: 'lord', tithe: 0.35, garrison: 2, unrest: 0.12, keepTier: 0 });

    const snap = captureSnapshot(state);
    // Deep capture: mutating the live seat must not touch the snapshot.
    state.world.lords.get('poi1')!.tithe = 0.9;
    state.world.lords.delete('poi1');

    restoreSnapshot(state, snap);
    expect(state.world!.lords.get('poi1')).toEqual(
      { npcId: 'lord', lineageId: 'lord', tithe: 0.35, garrison: 2, unrest: 0.12, keepTier: 0 },
    );

    // A pre-lord snapshot (no `lords` field) restores cleanly to zero seats.
    delete (snap as { lords?: unknown }).lords;
    restoreSnapshot(state, snap);
    expect(state.world!.lords.size).toBe(0);
  });
});
