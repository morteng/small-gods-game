// M6 (mortal power) — the Peace of God: relics paraded, armed men bound by oath
// before a crowd. The player's answer to the lord's coercion loop that is NOT a
// lightning bolt — it spends the congregation's DEVOTION, never `spirit.power`,
// and its binding effect (the seat's tithe cap) reaches BOTH population tiers
// through the shipped M0.c choke points (workRestoreScale / applyCohortTithe).
// Harness style mirrors lord-system.test.ts.
import { describe, it, expect } from 'vitest';
import {
  proclaimPeace, bindOath, devotionPoolAt,
  PROCLAIM_PEACE_DEVOTION_COST, BIND_OATH_DEVOTION_COST,
} from '@/sim/divine-actions';
import {
  makeLordState, peaceActive, boundTitheCap, armedMenOf, titheRateFor, workRestoreScale,
  PEACE_DURATION_TICKS, PEACE_TITHE_CAP, PEACE_UNREST_RELIEF, DEFAULT_TITHE,
  type LordState,
} from '@/sim/lord';
import { LordSystem, COHORT_TITHE_RELAX_PER_HOUR } from '@/sim/systems/lord-system';
import { emptySettlementCohorts, STAT_UNTITHED_PROSPERITY, type SettlementCohorts } from '@/sim/cohorts';
import { setLordStanceApply } from '@/sim/command/authoring-verbs';
import { executeCommand } from '@/sim/command/command-system';
import { TICKS_PER_DAY } from '@/core/calendar';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { EventLog, SilentEventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { createState } from '@/core/state';
import type { Spirit } from '@/core/spirit';
import type { ApplyCtx, Command } from '@/sim/command/types';
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

function addNpc(world: World, id: string, role: NpcRole, opts: { poiId?: string; devotion?: number; birthTick?: number } = {}): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  props.homeX = 10; props.homeY = 10;
  props.homePoiId = opts.poiId ?? 'poi1';
  props.birthTick = opts.birthTick ?? 0;
  props.lineageId = id;
  // Exact devotion accounting: wipe initNpcProps' seeded default belief so the
  // pool is precisely the sum of the devotions this harness hands out.
  props.beliefs = {};
  if (opts.devotion !== undefined) {
    props.beliefs['player'] = { faith: 0.6, understanding: 0.3, devotion: opts.devotion };
  }
  const e: Entity = { id, kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function spirit(power = 100): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power, manifestation: null };
}

function log(): EventLog {
  return new EventLog(new SimClock());
}

/** A seated lord + a devoted congregation big enough to pay for the assembly. */
function seatWithCrowd(world: World, opts: { devotionEach?: number; believers?: number } = {}): { seat: LordState; lord: Entity } {
  const lord = addNpc(world, 'lord', 'noble');
  const n = opts.believers ?? 4;
  for (let i = 0; i < n; i++) addNpc(world, `dev${i}`, 'farmer', { devotion: opts.devotionEach ?? 0.3 });
  const seat = makeLordState(lord);
  world.lords.set('poi1', seat);
  return { seat, lord };
}

function lordCtx(world: World, tick = 1000, l?: EventLog) {
  const clock = { now: () => tick, advance: () => {} } as unknown as SimClock;
  return {
    world, spirits: new Map(),
    log: l ?? new SilentEventLog(null as never),
    clock, rng: createRng(7), dt: 1000, now: tick,
  };
}

describe('proclaim_peace — spends DEVOTION, not power', () => {
  it('pays from the congregation pro-rata and leaves spirit.power untouched', () => {
    const world = new World(makeMap());
    const { seat } = seatWithCrowd(world, { devotionEach: 0.3, believers: 4 });   // pool 1.2
    const sp = spirit(5);
    const poolBefore = devotionPoolAt(world, 'player', 'poi1');
    expect(poolBefore).toBeCloseTo(1.2, 10);

    expect(proclaimPeace(sp, 'poi1', world, log(), 1000)).toBe(true);

    expect(sp.power).toBe(5);                                    // NOT a power spend
    const poolAfter = devotionPoolAt(world, 'player', 'poi1');
    expect(poolAfter).toBeCloseTo(poolBefore - PROCLAIM_PEACE_DEVOTION_COST, 10);
    // Pro-rata: every believer kept the same fraction of their devotion.
    const scale = 1 - PROCLAIM_PEACE_DEVOTION_COST / poolBefore;
    const dev0 = world.registry.get('dev0')!;
    expect(npcProps(dev0).beliefs['player']!.devotion).toBeCloseTo(0.3 * scale, 10);
    expect(peaceActive(seat, 1000)).toBe(true);
  });

  it('a devotion-poor god CANNOT proclaim, no matter how much raw power it holds', () => {
    const world = new World(makeMap());
    seatWithCrowd(world, { devotionEach: 0.05, believers: 4 });   // pool 0.2 < cost
    const sp = spirit(1000);                                      // cheap-fear god: power-rich
    expect(proclaimPeace(sp, 'poi1', world, log(), 1000)).toBe(false);
    expect(world.lords.get('poi1')!.peace).toBeUndefined();
  });

  it('requires a seated lord (something to bind) and rejects a standing peace', () => {
    const world = new World(makeMap());
    addNpc(world, 'solo-believer', 'farmer', { devotion: 1 });
    expect(proclaimPeace(spirit(), 'poi1', world, log(), 1000)).toBe(false);   // no seat

    const { seat } = seatWithCrowd(world, { devotionEach: 1, believers: 2 });
    expect(proclaimPeace(spirit(), 'poi1', world, log(), 1000)).toBe(true);
    expect(proclaimPeace(spirit(), 'poi1', world, log(), 2000)).toBe(false);   // one at a time
    expect(seat.peace!.untilTick).toBe(1000 + PEACE_DURATION_TICKS);
  });

  it('binds the armed men present, clamps the tithe to the cap, eases unrest, logs + is remembered', () => {
    const world = new World(makeMap());
    const { seat, lord } = seatWithCrowd(world);
    addNpc(world, 's1', 'soldier');
    addNpc(world, 's2', 'soldier');
    addNpc(world, 'elsewhere', 'soldier', { poiId: 'poi2' });     // not present, not bound
    seat.tithe = 0.4;
    seat.unrest = 0.5;
    const l = log();

    expect(proclaimPeace(spirit(), 'poi1', world, l, 1000)).toBe(true);

    expect(seat.peace!.sworn).toEqual(['lord', 's1', 's2']);      // sorted, lord included
    expect(seat.peace!.titheCap).toBe(PEACE_TITHE_CAP);
    expect(seat.tithe).toBe(PEACE_TITHE_CAP);                     // the cap engages NOW
    expect(seat.unrest).toBeCloseTo(0.5 - PEACE_UNREST_RELIEF, 10);
    expect(l.range(0, 1).map(a => a.event)).toContainEqual({
      type: 'peace_proclaimed', spiritId: 'player', poiId: 'poi1', sworn: 3,
      untilTick: 1000 + PEACE_DURATION_TICKS,
    });
    // The crowd was the witness — residents carry the day in their memory rings.
    expect(npcProps(lord).recentEventIds.length).toBeGreaterThan(0);
    expect(npcProps(world.registry.get('dev0')!).recentEventIds.length).toBeGreaterThan(0);
    expect(npcProps(world.registry.get('elsewhere')!).recentEventIds.length).toBe(0);
  });

  it('PEACE_DURATION_TICKS is a TICKS_PER_DAY multiple (fiction-day constants rule)', () => {
    expect(PEACE_DURATION_TICKS % TICKS_PER_DAY).toBe(0);
  });
});

describe('the binding reaches BOTH population tiers (through the tithe choke points)', () => {
  it('named tier: titheRateFor/workRestoreScale read the capped tithe after the oath', () => {
    const world = new World(makeMap());
    const { seat } = seatWithCrowd(world);
    seat.tithe = 0.5;
    expect(workRestoreScale(titheRateFor(world, 'poi1'))).toBeCloseTo(0.5, 10);
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    expect(titheRateFor(world, 'poi1')).toBe(PEACE_TITHE_CAP);
    expect(workRestoreScale(titheRateFor(world, 'poi1'))).toBeCloseTo(1 - PEACE_TITHE_CAP, 10);
  });

  it('statistical tier: the next LordSystem fire presses the CAPPED tithe onto the cohorts', () => {
    const world = new World(makeMap());
    const { seat } = seatWithCrowd(world);
    seat.tithe = 0.5;
    const sc = emptySettlementCohorts('poi1');
    sc.bands[2].count = 10;
    sc.bands[2].needs.prosperity = 0.3;                           // ground down under 0.5 tithe
    const cohorts = new Map<string, SettlementCohorts>([['poi1', sc]]);
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);

    new LordSystem(() => cohorts).tick(lordCtx(world, 2000));
    const target = STAT_UNTITHED_PROSPERITY * (1 - PEACE_TITHE_CAP);   // relaxing toward the CAPPED equilibrium
    expect(sc.bands[2].needs.prosperity)
      .toBeCloseTo(0.3 + (target - 0.3) * COHORT_TITHE_RELAX_PER_HOUR, 10);
  });
});

describe('LordSystem enforcement — the oath holds, lapses, and does not outlive its swearer', () => {
  it('holds a sworn seat-holder to the cap every hour (tithe creep is bound)', () => {
    const world = new World(makeMap());
    const { seat } = seatWithCrowd(world);
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    seat.tithe = 0.8;                                             // the lord grows greedy again
    new LordSystem().tick(lordCtx(world, 2000));
    expect(seat.tithe).toBe(PEACE_TITHE_CAP);
  });

  it('reaps a lapsed peace, logs peace_lapsed, and frees the tithe', () => {
    const world = new World(makeMap());
    const { seat } = seatWithCrowd(world);
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    const l = log();
    const sys = new LordSystem();

    sys.tick(lordCtx(world, 1000 + PEACE_DURATION_TICKS - 1, l)); // still binding
    expect(seat.peace).toBeDefined();
    expect(l.size()).toBe(0);

    sys.tick(lordCtx(world, 1000 + PEACE_DURATION_TICKS, l));     // the term runs out
    expect(seat.peace).toBeUndefined();
    expect(l.range(0, Number.MAX_SAFE_INTEGER).map(a => a.event)).toContainEqual(
      { type: 'peace_lapsed', poiId: 'poi1', spiritId: 'player' },
    );

    seat.tithe = 0.8;
    sys.tick(lordCtx(world, 1000 + PEACE_DURATION_TICKS + 1));
    expect(seat.tithe).toBe(0.8);                                 // unbound again
  });

  it('an UNSWORN successor rules unbound (dynasty passes the seat, not the oath)', () => {
    const world = new World(makeMap());
    const { seat, lord } = seatWithCrowd(world);
    addNpc(world, 'heir', 'noble', { birthTick: 900 });
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    expect(boundTitheCap(seat, 2000)).toBe(PEACE_TITHE_CAP);

    world.updateEntity(lord.id, { kind: 'remains' });             // the swearer dies
    const sys = new LordSystem();
    sys.tick(lordCtx(world, 2000));
    const after = world.lords.get('poi1')!;
    expect(after.npcId).toBe('heir');
    expect(after.peace).toBeDefined();                            // the peace stands…
    expect(boundTitheCap(after, 2000)).toBeNull();                // …but the heir never swore
    after.tithe = 0.6;
    sys.tick(lordCtx(world, 3000));
    expect(after.tithe).toBe(0.6);                                // not clamped
  });
});

describe('bind_oath — one later armed man before the relics', () => {
  it('binds an unsworn successor lord and re-engages the cap, spending devotion', () => {
    const world = new World(makeMap());
    const { seat, lord } = seatWithCrowd(world, { devotionEach: 0.5 });
    addNpc(world, 'heir', 'noble', { birthTick: 900 });
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    world.updateEntity(lord.id, { kind: 'remains' });
    new LordSystem().tick(lordCtx(world, 2000));
    const after = world.lords.get('poi1')!;
    after.tithe = 0.6;                                            // the unbound heir extracts

    const poolBefore = devotionPoolAt(world, 'player', 'poi1');
    const l = log();
    const heir = world.registry.get('heir')!;
    expect(bindOath(spirit(3), heir, world, l, 3000)).toBe(true);

    expect(after.peace!.sworn).toContain('heir');
    expect(after.tithe).toBe(PEACE_TITHE_CAP);                    // the cap re-engages
    expect(devotionPoolAt(world, 'player', 'poi1')).toBeCloseTo(poolBefore - BIND_OATH_DEVOTION_COST, 10);
    expect(l.range(0, 1).map(a => a.event)).toContainEqual(
      { type: 'oath_sworn', spiritId: 'player', npcId: 'heir', poiId: 'poi1' },
    );
    expect(npcProps(heir).recentEventIds.length).toBeGreaterThan(0);
    expect(seat).toBe(after);                                     // same seat object throughout
  });

  it('binds a newly arrived soldier; rejects the unarmed, the already-sworn, a lapsed peace, and foreign relics', () => {
    const world = new World(makeMap());
    seatWithCrowd(world, { devotionEach: 0.5 });
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    const recruit = addNpc(world, 'recruit', 'soldier');
    const farmer = world.registry.get('dev0')!;

    expect(bindOath(spirit(), farmer, world, log(), 2000)).toBe(false);          // not an armed man
    const rival: Spirit = { ...spirit(), id: 'rival', isPlayer: false };
    expect(bindOath(rival, recruit, world, log(), 2000)).toBe(false);            // not your relics
    expect(bindOath(spirit(), recruit, world, log(), 2000)).toBe(true);
    expect(bindOath(spirit(), recruit, world, log(), 2000)).toBe(false);         // already sworn
    expect(bindOath(spirit(), recruit, world, log(), 1000 + PEACE_DURATION_TICKS)).toBe(false); // lapsed
  });
});

describe('the command channel — registry gating end to end', () => {
  function applyCtx(world: World, sp: Spirit, tick = 1000): ApplyCtx {
    return {
      world, spirits: new Map([[sp.id, sp]]), log: log(),
      rng: createRng(7), now: tick,
    };
  }

  it('proclaim_peace applies through executeCommand with ZERO power (devotion-funded)', () => {
    const world = new World(makeMap());
    seatWithCrowd(world);
    const sp = spirit(0);                                         // no power at all
    const cmd: Command = { verb: 'proclaim_peace', source: 'player', target: { kind: 'settlement', poiId: 'poi1' }, seq: 0 };
    expect(executeCommand(cmd, applyCtx(world, sp))).toEqual({ status: 'applied', verb: 'proclaim_peace', source: 'player' });
    expect(world.lords.get('poi1')!.peace).toBeDefined();
  });

  it('a devotion shortfall rejects as precondition_failed, never insufficient_power', () => {
    const world = new World(makeMap());
    seatWithCrowd(world, { devotionEach: 0.01 });
    const cmd: Command = { verb: 'proclaim_peace', source: 'player', target: { kind: 'settlement', poiId: 'poi1' }, seq: 0 };
    expect(executeCommand(cmd, applyCtx(world, spirit(1000))))
      .toEqual({ status: 'rejected', verb: 'proclaim_peace', source: 'player', reason: 'precondition_failed' });
  });

  it('an unseated settlement is invalid_target; bind_oath gates the same way', () => {
    const world = new World(makeMap());
    addNpc(world, 'solo-believer', 'farmer', { devotion: 1 });
    const proclaim: Command = { verb: 'proclaim_peace', source: 'player', target: { kind: 'settlement', poiId: 'poi1' }, seq: 0 };
    expect(executeCommand(proclaim, applyCtx(world, spirit())).status).toBe('rejected');

    const { seat } = seatWithCrowd(world);
    void seat;
    addNpc(world, 'sold', 'soldier');
    const bind: Command = { verb: 'bind_oath', source: 'player', target: { kind: 'npc', npcId: 'sold' }, seq: 0 };
    // No standing peace yet → precondition_failed.
    expect(executeCommand(bind, applyCtx(world, spirit()))).toMatchObject({ status: 'rejected', reason: 'precondition_failed' });
    expect(executeCommand(proclaim, applyCtx(world, spirit())).status).toBe('applied');
    // The soldier swore at the assembly itself (he was present) → already bound.
    expect(executeCommand(bind, applyCtx(world, spirit()))).toMatchObject({ status: 'rejected', reason: 'precondition_failed' });
    const late = addNpc(world, 'late', 'soldier');
    void late;
    const bindLate: Command = { verb: 'bind_oath', source: 'player', target: { kind: 'npc', npcId: 'late' }, seq: 0 };
    expect(executeCommand(bindLate, applyCtx(world, spirit())).status).toBe('applied');
  });

  it('set_lord_stance cannot coach a SWORN lord above his oath (and can once it lapses)', () => {
    const world = new World(makeMap());
    const { seat } = seatWithCrowd(world);
    proclaimPeace(spirit(), 'poi1', world, log(), 1000);
    const cmd: Command = {
      verb: 'set_lord_stance', source: 'fate',
      target: { kind: 'settlement', poiId: 'poi1' }, payload: { tithe: 0.2 }, seq: 0,
    };
    const ctx = applyCtx(world, spirit(), 2000);
    expect(setLordStanceApply(cmd, ctx)).toBe(true);
    expect(seat.tithe).toBe(PEACE_TITHE_CAP);                     // clamped to the oath

    seat.peace!.untilTick = 1500;                                 // the oath runs out
    expect(setLordStanceApply(cmd, { ...ctx, now: 2000 })).toBe(true);
    expect(seat.tithe).toBeCloseTo(PEACE_TITHE_CAP + 0.2, 10);    // free to be coached again
  });
});

describe('snapshot round-trip — the oath is sim history', () => {
  it('captures and restores LordState.peace deeply; pre-M6 seats restore unbound', () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    addNpc(state.world, 'lord', 'noble');
    state.world.lords.set('poi1', {
      npcId: 'lord', lineageId: 'lord', tithe: PEACE_TITHE_CAP, garrison: 1, unrest: 0.1, keepTier: 0,
      peace: { spiritId: 'player', untilTick: 9_999_999, titheCap: PEACE_TITHE_CAP, sworn: ['lord', 's1'] },
    });

    const snap = captureSnapshot(state);
    // Deep capture: mutating the live oath must not touch the snapshot.
    state.world.lords.get('poi1')!.peace!.sworn.push('intruder');
    state.world.lords.get('poi1')!.tithe = 0.9;

    restoreSnapshot(state, snap);
    const seat = state.world!.lords.get('poi1')!;
    expect(seat.tithe).toBe(PEACE_TITHE_CAP);
    expect(seat.peace).toEqual({ spiritId: 'player', untilTick: 9_999_999, titheCap: PEACE_TITHE_CAP, sworn: ['lord', 's1'] });
    expect(peaceActive(seat, 1000)).toBe(true);

    // A pre-M6 seat (no `peace` field) restores to an unbound seat.
    delete (snap.lords![0][1] as { peace?: unknown }).peace;
    restoreSnapshot(state, snap);
    expect(state.world!.lords.get('poi1')!.peace).toBeUndefined();
    expect(boundTitheCap(state.world!.lords.get('poi1')!, 1000)).toBeNull();
  });
});

describe('armedMenOf — the men an assembly binds', () => {
  it('is resident soldiers + the seated lord, sorted by id', () => {
    const world = new World(makeMap());
    const lord = addNpc(world, 'zlord', 'noble');
    addNpc(world, 'a-sold', 'soldier');
    addNpc(world, 'other-noble', 'noble');                        // a noble who holds no seat is not "armed men"
    addNpc(world, 'far-sold', 'soldier', { poiId: 'poi2' });
    const seat = makeLordState(lord);
    world.lords.set('poi1', seat);
    expect(armedMenOf(world, 'poi1', seat).map(e => e.id)).toEqual(['a-sold', 'zlord']);
  });

  it('DEFAULT_TITHE sits above the sworn cap (the oath is a real concession)', () => {
    expect(PEACE_TITHE_CAP).toBeLessThan(DEFAULT_TITHE);
  });
});
