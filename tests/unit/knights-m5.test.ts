// M5 (mortal power) — knights: the castle's garrison gets teeth. Dominion links
// derived from runtime-POI provenance give the castle seat's tithe REACH back to
// the settlement that raised it (carried by knights: no garrison, no grip), the
// knights themselves patrol between keep and gripped settlement and are PAID
// from the extraction, LordSystem logs the grip transitions, BOTH population
// tiers feel the carried tithe (the spec's cohort double-accounting warning),
// and the Peace of God binds the knights from the gripped crowd's assembly —
// the coercion M6 exists to bind. Harness style mirrors lord-system.test.ts.
import { describe, it, expect } from 'vitest';
import { LordSystem, COHORT_TITHE_RELAX_PER_HOUR } from '@/sim/systems/lord-system';
import { NpcActivitySystem, PATROL_TURN_RADIUS } from '@/sim/systems/npc-activity-system';
import {
  makeLordState, titheRateFor, grippingSeatOf, assemblySeatIdsAt, patrolAnchorFor,
  peaceActive, DEFAULT_TITHE, PEACE_TITHE_CAP, type LordState,
} from '@/sim/lord';
import { proclaimPeace, PROCLAIM_PEACE_DEVOTION_COST } from '@/sim/divine-actions';
import { RuntimePoiStore, rebuildDominions } from '@/world/runtime-poi';
import { emptySettlementCohorts, STAT_UNTITHED_PROSPERITY, type SettlementCohorts } from '@/sim/cohorts';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { EventLog, SilentEventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { createState } from '@/core/state';
import type { Spirit } from '@/core/spirit';
import type { Entity, GameMap, NpcRole, Tile, WorldSeed } from '@/core/types';

const CASTLE = 'castle:0001';

function makeMap(w = 40, h = 40, withDirectory = true): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  // A minimal POI directory: the village anchor patrols ride to. (Runtime
  // castles are projected into the same directory by M4; the harness plants
  // the authored half only.)
  const worldSeed = withDirectory
    ? ({ pois: [{ id: 'poi1', type: 'village', name: 'Lowfield', position: { x: 5, y: 5 } }] } as unknown as WorldSeed)
    : null;
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function addNpc(world: World, id: string, role: NpcRole, opts: {
  poiId?: string; birthTick?: number; x?: number; y?: number; devotion?: number;
} = {}): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  const x = opts.x ?? 30, y = opts.y ?? 30;
  props.homeX = x; props.homeY = y;
  props.homePoiId = opts.poiId ?? CASTLE;
  props.birthTick = opts.birthTick ?? 0;
  props.lineageId = id;
  props.beliefs = {};
  if (opts.devotion !== undefined) {
    props.beliefs['player'] = { faith: 0.6, understanding: 0.3, devotion: opts.devotion };
  }
  const e: Entity = { id, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

/** A store carrying one runtime castle founded FROM poi1 (the dominion link). */
function castleStore(): RuntimePoiStore {
  const store = new RuntimePoiStore();
  store.add({
    poi: { id: CASTLE, type: 'castle', name: 'The New Castle', position: { x: 30, y: 30 }, size: 'small', importance: 'medium', runtime: true } as never,
    provenance: { bornTick: 0, cause: 'lord:kn-lord', complexTypeId: 'motte_and_bailey', foundedFromPoiId: 'poi1' },
    earthworks: [],
    barrierRuns: [],
  });
  return store;
}

function createContext(world: World, tick = 1000, log?: EventLog) {
  const clock = { now: () => tick, advance: () => {} } as unknown as SimClock;
  return {
    world, spirits: new Map(),
    log: log ?? new SilentEventLog(null as never),
    clock, rng: createRng(7), dt: 1000, now: tick,
  };
}

function spirit(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 100, manifestation: null };
}

function eventsOf(log: EventLog) {
  return log.range(0, 1_000_000).map(a => a.event);
}

// ─── dominion links + the effective tithe (the reach itself) ──────────────────

describe('M5 — dominion links and the effective tithe', () => {
  it('rebuildDominions derives gripped→castle from provenance and drops stale links', () => {
    const dominions = new Map<string, string>([['stale', 'castle:0999']]);
    rebuildDominions(dominions, castleStore());
    expect([...dominions]).toEqual([['poi1', CASTLE]]);
    // A harness/studio foundation without foundedFromPoiId carries no link.
    const bare = new RuntimePoiStore();
    bare.add({
      poi: { id: 'castle:0002', type: 'castle', name: 'x', position: { x: 1, y: 1 }, runtime: true } as never,
      provenance: { bornTick: 0, cause: 'harness', complexTypeId: 'motte_and_bailey' },
      earthworks: [], barrierRuns: [],
    });
    rebuildDominions(dominions, bare);
    expect(dominions.size).toBe(0);
  });

  it('the knights CARRY the tithe: castle seat + live garrison reach the gripped settlement', () => {
    const world = new World(makeMap());
    rebuildDominions(world.dominions, castleStore());
    // No castle seat yet: nothing reaches.
    expect(grippingSeatOf(world, 'poi1')).toBeNull();
    expect(titheRateFor(world, 'poi1')).toBe(0);
    // Seat, but no garrison: no knights, no reach.
    const seat: LordState = { npcId: 'kn-lord', lineageId: 'kn-lord', tithe: 0.3, garrison: 0, unrest: 0, keepTier: 0 };
    world.lords.set(CASTLE, seat);
    expect(titheRateFor(world, 'poi1')).toBe(0);
    // Garrison up: the castle's 0.3 is collected at the village.
    seat.garrison = 3;
    expect(grippingSeatOf(world, 'poi1')).toBe(seat);
    expect(titheRateFor(world, 'poi1')).toBe(0.3);
    // A local seat never STACKS with the grip — the heavier hand takes (max).
    world.lords.set('poi1', { npcId: 'v-lord', lineageId: 'v-lord', tithe: 0.1, garrison: 0, unrest: 0, keepTier: 0 });
    expect(titheRateFor(world, 'poi1')).toBe(0.3);
    world.lords.get('poi1')!.tithe = 0.5;
    expect(titheRateFor(world, 'poi1')).toBe(0.5);
  });

  it('assemblySeatIdsAt names every seat whose armed men hold the ground (local first)', () => {
    const world = new World(makeMap());
    rebuildDominions(world.dominions, castleStore());
    expect(assemblySeatIdsAt(world, 'poi1')).toEqual([]);
    world.lords.set(CASTLE, makeLordState(addNpc(world, 'kn-lord', 'noble')));
    expect(assemblySeatIdsAt(world, 'poi1')).toEqual([CASTLE]);
    world.lords.set('poi1', makeLordState(addNpc(world, 'v-lord', 'noble', { poiId: 'poi1', x: 5, y: 5 })));
    expect(assemblySeatIdsAt(world, 'poi1')).toEqual(['poi1', CASTLE]);
    // The castle itself answers only for its own seat.
    expect(assemblySeatIdsAt(world, CASTLE)).toEqual([CASTLE]);
  });
});

// ─── LordSystem: grip transitions + both population tiers ─────────────────────

describe('M5 — LordSystem grip transitions', () => {
  function castleWorld(): { world: World; store: RuntimePoiStore; sys: LordSystem; cohorts: Map<string, SettlementCohorts> } {
    const world = new World(makeMap());
    addNpc(world, 'kn-lord', 'noble');
    addNpc(world, 'kn-a', 'soldier');
    addNpc(world, 'kn-b', 'soldier');
    const store = castleStore();
    const sc = emptySettlementCohorts('poi1');
    sc.bands[2].count = 10;
    sc.bands[2].needs.prosperity = STAT_UNTITHED_PROSPERITY;
    const cohorts = new Map<string, SettlementCohorts>([['poi1', sc]]);
    const sys = new LordSystem(() => cohorts, () => store);
    return { world, store, sys, cohorts };
  }

  it('takes the grip when the seat attaches with a live garrison (grip_taken, once)', () => {
    const { world, sys } = castleWorld();
    const log = new EventLog(new SimClock());
    sys.tick(createContext(world, 1000, log));
    const seat = world.lords.get(CASTLE)!;
    expect(seat.garrison).toBe(2);
    expect(seat.gripsPoiId).toBe('poi1');
    expect(eventsOf(log)).toContainEqual({ type: 'grip_taken', castlePoiId: CASTLE, poiId: 'poi1', garrison: 2 });
    // Steady state: no re-log while the grip holds.
    const log2 = new EventLog(new SimClock());
    sys.tick(createContext(world, 2000, log2));
    expect(eventsOf(log2).filter(e => e.type === 'grip_taken')).toEqual([]);
  });

  it('breaks the grip when the garrison empties (grip_broken) and retakes on return', () => {
    const { world, sys } = castleWorld();
    sys.tick(createContext(world, 1000));
    // The knights leave (rehomed away — killNpc would do the same via the census).
    for (const id of ['kn-a', 'kn-b']) npcProps(world.query({ kind: 'npc' }).find(e => e.id === id)!).homePoiId = 'elsewhere';
    const log = new EventLog(new SimClock());
    sys.tick(createContext(world, 2000, log));
    const seat = world.lords.get(CASTLE)!;
    expect(seat.garrison).toBe(0);
    expect(seat.gripsPoiId).toBeUndefined();
    expect(eventsOf(log)).toContainEqual({ type: 'grip_broken', castlePoiId: CASTLE, poiId: 'poi1' });
    expect(titheRateFor(world, 'poi1')).toBe(0);   // the village breathes
    // The knights return: the grip is retaken.
    for (const id of ['kn-a', 'kn-b']) npcProps(world.query({ kind: 'npc' }).find(e => e.id === id)!).homePoiId = CASTLE;
    const log3 = new EventLog(new SimClock());
    sys.tick(createContext(world, 3000, log3));
    expect(eventsOf(log3)).toContainEqual({ type: 'grip_taken', castlePoiId: CASTLE, poiId: 'poi1', garrison: 2 });
  });

  it('a LAPSING castle seat logs grip_broken — the knights answer to nobody', () => {
    const { world, sys } = castleWorld();
    sys.tick(createContext(world, 1000));
    world.updateEntity('kn-lord', { kind: 'remains' });  // the line is spent (no other noble)
    const log = new EventLog(new SimClock());
    sys.tick(createContext(world, 2000, log));
    expect(world.lords.has(CASTLE)).toBe(false);
    expect(eventsOf(log)).toContainEqual({ type: 'grip_broken', castlePoiId: CASTLE, poiId: 'poi1' });
  });

  it('presses the CARRIED tithe onto the gripped settlement\'s statistical tier (no local seat)', () => {
    const { world, sys, cohorts } = castleWorld();
    sys.tick(createContext(world, 1000));
    world.lords.get(CASTLE)!.tithe = 0.5;
    const before = cohorts.get('poi1')!.bands[2].needs.prosperity;
    sys.tick(createContext(world, 2000));
    const target = STAT_UNTITHED_PROSPERITY * (1 - 0.5);
    expect(cohorts.get('poi1')!.bands[2].needs.prosperity)
      .toBeCloseTo(before + (target - before) * COHORT_TITHE_RELAX_PER_HOUR, 10);
    // Counts NEVER move — the P1 conservation audit is over counts.
    expect(cohorts.get('poi1')!.bands[2].count).toBe(10);
  });

  it('a gripped settlement WITH a local seat relaxes unrest toward the EFFECTIVE tithe', () => {
    const { world, sys } = castleWorld();
    addNpc(world, 'v-lord', 'noble', { poiId: 'poi1', x: 5, y: 5 });
    sys.tick(createContext(world, 1000));
    world.lords.get(CASTLE)!.tithe = 0.6;                 // the castle grinds harder than the local 0.1
    const vSeat = world.lords.get('poi1')!;
    const before = vSeat.unrest;
    sys.tick(createContext(world, 2000));
    // Effective at poi1 = max(0.1 local, 0.6 carried) = 0.6 — the crowd's anger tracks what it loses.
    expect(vSeat.unrest).toBeCloseTo(before + (0.6 - before) * 0.02, 10);
  });
});

// ─── the knights themselves: patrol + pay ─────────────────────────────────────

describe('M5 — knight patrols', () => {
  function patrolWorld(): { world: World; seat: LordState; knight: Entity } {
    const world = new World(makeMap());
    rebuildDominions(world.dominions, castleStore());
    const knight = addNpc(world, 'kn-a', 'soldier');       // homed at the castle (30,30)
    const seat: LordState = { npcId: 'kn-lord', lineageId: 'kn-lord', tithe: DEFAULT_TITHE, garrison: 1, unrest: 0, keepTier: 0 };
    world.lords.set(CASTLE, seat);
    return { world, seat, knight };
  }

  it('patrolAnchorFor: dominion link + seated lord → the gripped settlement\'s anchor', () => {
    const { world } = patrolWorld();
    expect(patrolAnchorFor(world, CASTLE)).toEqual({ x: 5, y: 5 });
    expect(patrolAnchorFor(world, 'poi1')).toBeNull();     // villages have no patrol
    expect(patrolAnchorFor(world, undefined)).toBeNull();
    world.lords.delete(CASTLE);                            // vacant seat: nobody commands a patrol
    expect(patrolAnchorFor(world, CASTLE)).toBeNull();
  });

  it('a castle knight PATROLS by day: out to the gripped settlement, then back home', () => {
    const { world, knight } = patrolWorld();
    const sys = new NpcActivitySystem();
    sys.tick(createContext(world, 50));                    // day, needs high, no plea
    const p = npcProps(knight);
    expect(p.activity).toBe('patrol');
    // Far from the anchor → the outbound leg targets the village (±2 jitter).
    expect(Math.abs(p.activityTargetX! - 5)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.activityTargetY! - 5)).toBeLessThanOrEqual(2);
    // Arrived near the anchor → the next leg turns for home.
    world.updateEntity(knight.id, { x: 5.5, y: 5.5 });
    p.activityDuration = 0;
    sys.tick(createContext(world, 60));
    expect(p.activity).toBe('patrol');
    expect(Math.abs(p.activityTargetX! - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.activityTargetY! - 30)).toBeLessThanOrEqual(2);
    expect(PATROL_TURN_RADIUS).toBeGreaterThan(0);
  });

  it('a village soldier still drills at work — no dominion, no patrol', () => {
    const world = new World(makeMap());
    rebuildDominions(world.dominions, castleStore());
    const soldier = addNpc(world, 'v-s', 'soldier', { poiId: 'poi1', x: 5, y: 5 });
    new NpcActivitySystem().tick(createContext(world, 50));
    expect(npcProps(soldier).activity).toBe('work');
  });

  it('knight pay rides the extraction: full at the customary tithe, halved under a Peace cap, nothing from a tithe-0 lord', () => {
    const { world, seat, knight } = patrolWorld();
    const sys = new NpcActivitySystem();
    const p = npcProps(knight);
    const payAt = (tithe: number): number => {
      seat.tithe = tithe;
      p.activity = 'patrol';
      p.activityDuration = 0;
      p.needs.prosperity = 0.4;
      sys.tick(createContext(world, 50));
      return p.needs.prosperity - 0.4;
    };
    expect(payAt(DEFAULT_TITHE)).toBeCloseTo(0.3, 10);       // SELF_AGENCY_RESTORE, full pay
    expect(payAt(PEACE_TITHE_CAP)).toBeCloseTo(0.15, 10);    // the oath halves the take — and the pay
    expect(payAt(0)).toBeCloseTo(0, 10);                     // a benevolent lord starves his knights
  });
});

// ─── the Peace of God binds the knights (what M6 exists to bind) ──────────────

describe('M5 — the gripped crowd binds the castle\'s knights', () => {
  function grippedWorld(withLocalSeat = false) {
    const world = new World(makeMap());
    rebuildDominions(world.dominions, castleStore());
    addNpc(world, 'kn-lord', 'noble');
    addNpc(world, 'kn-a', 'soldier');
    const castleSeat = makeLordState(world.query({ kind: 'npc' }).find(e => e.id === 'kn-lord')!);
    castleSeat.garrison = 1;
    castleSeat.tithe = 0.4;                                // the knights grind the village
    world.lords.set(CASTLE, castleSeat);
    // The crowd: devoted believers at the VILLAGE (the people who suffer the grip).
    for (let i = 0; i < 4; i++) addNpc(world, `crowd-${i}`, 'farmer', { poiId: 'poi1', x: 5, y: 5, devotion: 0.3 });
    if (withLocalSeat) {
      const vLord = addNpc(world, 'v-lord', 'noble', { poiId: 'poi1', x: 5, y: 5 });
      world.lords.set('poi1', makeLordState(vLord));
    }
    return { world, castleSeat };
  }

  it('proclaim at the gripped village (NO local seat) binds the castle seat from the village\'s devotion', () => {
    const { world, castleSeat } = grippedWorld(false);
    const log = new EventLog(new SimClock());
    expect(proclaimPeace(spirit(), 'poi1', world, log, 1000)).toBe(true);
    // The castle's armed men swore; the cap engaged; the carried tithe eased.
    expect(peaceActive(castleSeat, 1000)).toBe(true);
    expect(castleSeat.peace!.sworn).toEqual(['kn-a', 'kn-lord']);
    expect(castleSeat.tithe).toBe(PEACE_TITHE_CAP);
    expect(titheRateFor(world, 'poi1')).toBe(PEACE_TITHE_CAP);
    expect(eventsOf(log)).toContainEqual(
      { type: 'peace_proclaimed', spiritId: 'player', poiId: CASTLE, sworn: 2, untilTick: expect.any(Number) },
    );
    // The devotion came from the village crowd, pro-rata.
    const crowd = world.query({ kind: 'npc' }).find(e => e.id === 'crowd-0')!;
    expect(npcProps(crowd).beliefs['player']!.devotion).toBeLessThan(0.3);
    // The sworn knights remember the day, though they live at the castle.
    const knight = world.query({ kind: 'npc' }).find(e => e.id === 'kn-a')!;
    expect(npcProps(knight).recentEventIds.length).toBeGreaterThan(0);
    expect(PROCLAIM_PEACE_DEVOTION_COST).toBeLessThanOrEqual(4 * 0.3);
  });

  it('proclaim at a gripped village WITH a local seat binds BOTH seats in one assembly', () => {
    const { world, castleSeat } = grippedWorld(true);
    expect(proclaimPeace(spirit(), 'poi1', world, new EventLog(new SimClock()), 1000)).toBe(true);
    expect(peaceActive(castleSeat, 1000)).toBe(true);
    expect(peaceActive(world.lords.get('poi1')!, 1000)).toBe(true);
    expect(world.lords.get('poi1')!.peace!.sworn).toContain('v-lord');
  });

  it('an assembly with nothing left to bind returns false (all seats already at peace)', () => {
    const { world, castleSeat } = grippedWorld(false);
    castleSeat.peace = { spiritId: 'player', untilTick: 999_999, titheCap: PEACE_TITHE_CAP, sworn: ['kn-lord'] };
    expect(proclaimPeace(spirit(), 'poi1', world, new EventLog(new SimClock()), 1000)).toBe(false);
  });
});

// ─── snapshot: the grip and its links survive scrub/restore ───────────────────

describe('M5 — snapshot round-trip', () => {
  it('restores gripsPoiId with the seat and rebuilds dominions immediately (no hourly wait)', () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    addNpc(state.world, 'kn-lord', 'noble');
    addNpc(state.world, 'kn-a', 'soldier');
    // Found the link through the store the snapshot carries.
    const entry = castleStore().all()[0];
    state.runtimePois.add(structuredClone(entry) as never);
    rebuildDominions(state.world.dominions, state.runtimePois);
    const seat: LordState = { npcId: 'kn-lord', lineageId: 'kn-lord', tithe: 0.4, garrison: 1, unrest: 0, keepTier: 0, gripsPoiId: 'poi1' };
    state.world.lords.set(CASTLE, seat);
    expect(titheRateFor(state.world, 'poi1')).toBe(0.4);

    const snap = captureSnapshot(state);
    // The future the scrub discards: the grip breaks, the castle un-exists.
    delete state.world.lords.get(CASTLE)!.gripsPoiId;
    state.world.lords.delete(CASTLE);
    state.runtimePois.reset();
    state.world.dominions.clear();

    restoreSnapshot(state, snap);
    expect(state.world!.lords.get(CASTLE)!.gripsPoiId).toBe('poi1');
    expect([...state.world!.dominions]).toEqual([['poi1', CASTLE]]);
    expect(titheRateFor(state.world!, 'poi1')).toBe(0.4);   // reach is live before any hourly fire

    // A pre-M5 snapshot (no store entries, seat without gripsPoiId) restores clean.
    const bare = captureSnapshot(state);
    bare.runtimePois = { entries: [], nextId: 1 };
    delete (bare.lords!.find(([id]) => id === CASTLE)![1] as LordState).gripsPoiId;
    restoreSnapshot(state, bare);
    expect(state.world!.dominions.size).toBe(0);
    expect(state.world!.lords.get(CASTLE)!.gripsPoiId).toBeUndefined();
    expect(titheRateFor(state.world!, 'poi1')).toBe(0);
  });
});
