import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { Entity, GameMap, NpcProperties, ActiveEvent } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import {
  addDomainBelief, getDomainBelief, aggregateDomain, isDomainUnlocked, DOMAIN_DEFS,
} from '@/sim/belief-domains';
import { omen, smite, SMITE_COST } from '@/sim/divine-actions';
import { getCapability } from '@/sim/command/registry';
import { BeliefContentSystem, DOMAIN_DECAY } from '@/sim/systems/belief-content-system';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';

// ── scaffolding ──────────────────────────────────────────────────────────────
function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}
function spirit(id: string, power = 100, isPlayer = true): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer, power, manifestation: null };
}
let nextId = 0;
function addNpc(
  world: World, opts: { poi?: string; faith?: number; understanding?: number; devotion?: number; storm?: number; activity?: string } = {},
): Entity {
  const id = `n${nextId++}`;
  const props = initNpcProps('Pip', 'farmer', nextId) as NpcProperties;
  props.beliefs = { player: { faith: opts.faith ?? 0.5, understanding: opts.understanding ?? 0.5, devotion: opts.devotion ?? 0.2 } };
  if (opts.poi) props.homePoiId = opts.poi;
  if (opts.activity) props.activity = opts.activity as NpcProperties['activity'];
  if (opts.storm !== undefined) addDomainBelief(props, 'player', 'storm', opts.storm);
  const e = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}
function activeEvent(type: ActiveEvent['type'], poiId: string, severity: number): ActiveEvent {
  return { type, poiId, severity, durationTicks: 100, ticksElapsed: 0 };
}

// ── B-A: belief-content model ────────────────────────────────────────────────
describe('belief-domains (B-A)', () => {
  it('stores domain belief sparsely and prunes near-zero entries', () => {
    const p = initNpcProps('A', 'farmer', 1);
    expect(getDomainBelief(p, 'player', 'storm')).toBe(0);
    addDomainBelief(p, 'player', 'storm', 0.4);
    expect(getDomainBelief(p, 'player', 'storm')).toBeCloseTo(0.4, 6);
    // decay back below epsilon → the record is pruned entirely
    addDomainBelief(p, 'player', 'storm', -0.4);
    expect(getDomainBelief(p, 'player', 'storm')).toBe(0);
    expect(p.domains).toBeUndefined();
  });

  it('aggregate weights by faith×devotion and gates the unlock threshold', () => {
    const world = makeWorld();
    // a devout, fully-convinced believer + a faithless bystander who "believes" storm
    addNpc(world, { faith: 0.9, devotion: 0.9, storm: 1.0 });
    addNpc(world, { faith: 0.0, devotion: 0.0, storm: 1.0 }); // ignored: no faith → not in the congregation
    const agg = aggregateDomain(world, 'player', 'storm');
    expect(agg.believers).toBe(1);          // only the faith-bearer counts
    expect(agg.conviction).toBeCloseTo(1, 6);
    expect(agg.reach).toBe(1);              // reach is scoped to faith-bearers holding the belief
    expect(isDomainUnlocked(world, 'player', 'storm')).toBe(true);
  });

  // ── R7 WP-B: conviction locality ───────────────────────────────────────────
  // Seeding is per-settlement (omens/smites land on ONE town), so the unlock
  // signal is the BEST congregation, not a world-wide mean that dilutes a
  // devout town out of its own power once believers spread.
  it('a devout town unlocks smite even when believers spread across other settlements', () => {
    const world = makeWorld();
    for (let i = 0; i < 5; i++) addNpc(world, { poi: 'devout', faith: 1, devotion: 1, storm: 1 });
    // 20 faith-bearers elsewhere who have never seen a storm: under the old
    // world-wide mean these diluted conviction to ~0.45 < bar 0.5.
    for (let i = 0; i < 20; i++) addNpc(world, { poi: `far${i % 4}`, faith: 0.5, devotion: 0.2, storm: 0 });
    expect(aggregateDomain(world, 'player', 'storm').conviction).toBeCloseTo(1, 6);
    expect(isDomainUnlocked(world, 'player', 'storm')).toBe(true);
  });

  it('the same convinced believers spread thin across towns do NOT unlock', () => {
    const world = makeWorld();
    // Five believers each carrying storm 0.3 live in five DIFFERENT settlements
    // among unconvinced neighbours → every congregation's mean stays low.
    for (let i = 0; i < 5; i++) {
      addNpc(world, { poi: `town${i}`, faith: 1, devotion: 1, storm: 0.3 });
      for (let j = 0; j < 4; j++) addNpc(world, { poi: `town${i}`, faith: 0.8, devotion: 0.5, storm: 0 });
    }
    expect(aggregateDomain(world, 'player', 'storm').conviction).toBeLessThan(DOMAIN_DEFS.storm.unlockThreshold);
    expect(isDomainUnlocked(world, 'player', 'storm')).toBe(false);
  });

  it('settlement-less believers form their own congregation (the roadless bucket)', () => {
    const world = makeWorld();
    // A big diluting city of unconvinced believers…
    for (let i = 0; i < 10; i++) addNpc(world, { poi: 'city', faith: 0.8, devotion: 0.5, storm: 0 });
    // …and a devout wandering band with no homePoiId at all.
    for (let i = 0; i < 3; i++) addNpc(world, { faith: 1, devotion: 1, storm: 1 });
    expect(isDomainUnlocked(world, 'player', 'storm')).toBe(true);
  });

  it('a half-convinced congregation sits below the unlock bar', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0.8, devotion: 0.5, storm: 0.2 });
    addNpc(world, { faith: 0.8, devotion: 0.5, storm: 0.0 });
    expect(aggregateDomain(world, 'player', 'storm').conviction).toBeLessThan(DOMAIN_DEFS.storm.unlockThreshold);
    expect(isDomainUnlocked(world, 'player', 'storm')).toBe(false);
  });
});

// ── B-B: attribution at the act site ─────────────────────────────────────────
describe('attribution (B-B)', () => {
  it('an omen over a suffering settlement seeds storm-attribution', () => {
    const world = makeWorld();
    const clock = new SimClock();
    const log = new EventLog(clock);
    const e = addNpc(world, { poi: 'vale', faith: 0.5, understanding: 0.8 });
    world.activeEvents.set('vale', [activeEvent('drought', 'vale', 0.9)]);
    omen(spirit('player'), 'vale', world, log);
    expect(getDomainBelief(e.properties as unknown as NpcProperties, 'player', 'storm')).toBeGreaterThan(0);
  });

  it('a calm-sky omen seeds far less than a wrathful one', () => {
    const calm = makeWorld(), dire = makeWorld();
    const log = new EventLog(new SimClock());
    const ec = addNpc(calm, { poi: 'p', faith: 0.5, understanding: 0.8 });
    const ed = addNpc(dire, { poi: 'p', faith: 0.5, understanding: 0.8 });
    dire.activeEvents.set('p', [activeEvent('drought', 'p', 1.0)]);
    omen(spirit('player'), 'p', calm, log);
    omen(spirit('player'), 'p', dire, log);
    const sc = getDomainBelief(ec.properties as unknown as NpcProperties, 'player', 'storm');
    const sd = getDomainBelief(ed.properties as unknown as NpcProperties, 'player', 'storm');
    expect(sd).toBeGreaterThan(sc);
  });
});

// ── B-C: smite gating + reinforcement ────────────────────────────────────────
describe('smite (B-C)', () => {
  function ctx(world: World, spirits: Map<SpiritId, Spirit>) {
    return { world, spirits, log: new EventLog(new SimClock()) };
  }
  it('is gated: rejected below the storm threshold, allowed once believed', () => {
    const world = makeWorld();
    const target = addNpc(world, { poi: 'v', faith: 0.5 });
    const spirits = new Map<SpiritId, Spirit>([['player', spirit('player')]]);
    const cap = getCapability('smite')!;
    const cmd = { verb: 'smite' as const, source: 'player', target: { kind: 'npc' as const, npcId: target.id }, seq: 0 };

    // no storm belief yet → precondition_failed
    expect(cap.precondition!(cmd, ctx(world, spirits))).toBe('precondition_failed');

    // convince the congregation → unlocked
    addNpc(world, { poi: 'v', faith: 1, devotion: 1, storm: 1 });
    expect(cap.precondition!(cmd, ctx(world, spirits))).toBeNull();
  });

  it('insufficient power is reported before the belief gate', () => {
    const world = makeWorld();
    const target = addNpc(world, { faith: 0.5 });
    const spirits = new Map<SpiritId, Spirit>([['player', spirit('player', SMITE_COST - 1)]]);
    const cap = getCapability('smite')!;
    const cmd = { verb: 'smite' as const, source: 'player', target: { kind: 'npc' as const, npcId: target.id }, seq: 0 };
    expect(cap.precondition!(cmd, ctx(world, spirits))).toBe('insufficient_power');
  });

  it('reinforces witnesses’ storm belief and terrifies the target into faith', () => {
    const world = makeWorld();
    const log = new EventLog(new SimClock());
    const target = addNpc(world, { poi: 'v', faith: 0.2, understanding: 0.5 });
    const witness = addNpc(world, { poi: 'v', faith: 0.8, understanding: 0.8, storm: 0.6 });
    const sp = spirit('player');
    const tp0 = (target.properties as unknown as NpcProperties).beliefs.player.faith;
    const wStorm0 = getDomainBelief(witness.properties as unknown as NpcProperties, 'player', 'storm');

    expect(smite(sp, target, world, log)).toBe(true);

    const tp = target.properties as unknown as NpcProperties;
    const wp = witness.properties as unknown as NpcProperties;
    expect(tp.beliefs.player.faith).toBeGreaterThan(tp0);           // fear converts
    expect(getDomainBelief(wp, 'player', 'storm')).toBeGreaterThan(wStorm0); // witness reinforced
    expect(getDomainBelief(tp, 'player', 'storm')).toBeGreaterThan(0);       // target felt it
    expect(sp.power).toBe(100 - SMITE_COST);
    expect(log.since(0).some(a => a.event.type === 'smite')).toBe(true);
  });
});

// ── B-B: propagation + decay system ──────────────────────────────────────────
describe('BeliefContentSystem (B-B)', () => {
  function tick(world: World) {
    new BeliefContentSystem().tick({
      world, spirits: new Map(), log: new EventLog(new SimClock()),
      clock: new SimClock(), rng: createRng(0), dt: 2000, now: 1,
    });
  }
  it('decays undefended belief, but devotion (doctrine) resists', () => {
    const world = makeWorld();
    const waverer = addNpc(world, { faith: 0.5, devotion: 0, storm: 0.5 });
    const devout = addNpc(world, { faith: 0.5, devotion: 1, storm: 0.5 });
    tick(world);
    const w = getDomainBelief(waverer.properties as unknown as NpcProperties, 'player', 'storm');
    const d = getDomainBelief(devout.properties as unknown as NpcProperties, 'player', 'storm');
    expect(w).toBeLessThan(0.5);
    expect(w).toBeCloseTo(0.5 * (1 - DOMAIN_DECAY), 6);
    expect(d).toBeCloseTo(0.5, 6); // doctrine frozen
  });

  it('propagates belief along a trusted social tie', () => {
    const world = makeWorld();
    const sage = addNpc(world, { faith: 0.7, devotion: 0.5, storm: 0.9 });
    const pupil = addNpc(world, { faith: 0.7, devotion: 0.5, storm: 0.0 });
    // pupil trusts sage
    (pupil.properties as unknown as NpcProperties).relationships = [{ npcId: sage.id, type: 'mentor', trust: 1 }];
    const before = getDomainBelief(pupil.properties as unknown as NpcProperties, 'player', 'storm');
    tick(world);
    const after = getDomainBelief(pupil.properties as unknown as NpcProperties, 'player', 'storm');
    expect(after).toBeGreaterThan(before);
  });
});

// ── query projections: beliefPowers + divineInbox ────────────────────────────
describe('GameQuery.beliefPowers + divineInbox (B-C/B-D/B-E)', () => {
  function queryFor(world: World) {
    const state = createState();
    state.world = world;
    return createGameQuery({ state });
  }
  it('beliefPowers reports locked→unlocked as conviction crosses the bar', () => {
    const world = makeWorld();
    addNpc(world, { faith: 0.9, devotion: 0.9, storm: 0.1 });
    let power = queryFor(world).beliefPowers().find(p => p.domain === 'storm')!;
    expect(power.unlocked).toBe(false);
    expect(power.verb).toBe('smite');

    addNpc(world, { faith: 1, devotion: 1, storm: 1 });
    addNpc(world, { faith: 1, devotion: 1, storm: 1 });
    power = queryFor(world).beliefPowers().find(p => p.domain === 'storm')!;
    expect(power.unlocked).toBe(true);
    expect(power.conviction).toBeGreaterThanOrEqual(power.threshold);
  });

  it('divineInbox surfaces prayers + ominous-event opportunities, salience-ranked', () => {
    const world = makeWorld();
    addNpc(world, { poi: 'vale', faith: 0.8, activity: 'worship' });   // a prayer
    world.activeEvents.set('vale', [activeEvent('drought', 'vale', 0.9)]); // an opportunity
    const inbox = queryFor(world).divineInbox();
    expect(inbox.some(i => i.kind === 'prayer')).toBe(true);
    expect(inbox.some(i => i.kind === 'opportunity')).toBe(true);
    // sorted descending by salience
    for (let i = 1; i < inbox.length; i++) expect(inbox[i - 1].salience).toBeGreaterThanOrEqual(inbox[i].salience);
  });

  it('Fate surfacing (B-E) flags + boosts a promoted item to the top', () => {
    const world = makeWorld();
    addNpc(world, { poi: 'vale', faith: 0.2, activity: 'worship' });
    world.activeEvents.set('vale', [activeEvent('drought', 'vale', 0.1)]);
    const state = createState();
    state.world = world;
    state.surfacedInbox.add('opp:vale');
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox[0].id).toBe('opp:vale');
    expect(inbox[0].surfaced).toBe(true);
  });
});
