import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { seedWorld } from '@/world/seed-world';
import { seedStatisticalCohorts } from '@/sim/cohorts';
import { generateRivalSpirits } from '@/sim/rival-spirit';
import { rivalToSpirit } from '@/sim/command/rival-adapter';
import { identityOracle } from '@/world/oracle';
import { SpiritSystem } from '@/sim/spirit-system';
import { FADE_SUSTAIN_TICKS, FADE_MASS } from '@/sim/god-tier';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps, getNpc } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import { whisper, omen, answerPrayer, canAfford } from '@/sim/divine-actions';
import { eligibleClaimants } from '@/sim/rival-claims';
import type { RivalPersonality } from '@/sim/rival-spirit';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import type { Entity, GameMap, NpcProperties, Tile, WorldSeed } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { GameState } from '@/core/state';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { FateArcStore } from '@/sim/fate/arc-store';
import { ChronicleStore } from '@/core/chronicle-store';

const PERSONALITY: RivalPersonality = {
  aggression: 0.5, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.5, jealousy: 0.5,
};
function makeSpirit(id: string, isPlayer = false, power = 100): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer, power, manifestation: null };
}
function makeMap(): GameMap {
  return {
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}
/** seedWorld needs real tiles to place anything on; `makeMap` is the bare stub
 *  the pure-system tests use. */
function gridMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { ...makeMap(), tiles, width: w, height: h };
}
function makeState(): GameState {
  const m = makeMap();
  return {
    world: new World(m), map: m, clock: new SimClock(), rng: createRng(1),
    eventLog: new EventLog(new SimClock()), spirits: new Map(),
    plotThreads: new PlotThreadStore(), staging: new StagingBuffer(),
    fateArcs: new FateArcStore(), chronicle: new ChronicleStore(),
  } as unknown as GameState;
}
function ctx(spirits: Map<SpiritId, Spirit>) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  return { world: new World(makeMap()), log, clock, spirits, rng: createRng(0) };
}
function addBeliever(
  world: World, id: string,
  beliefs: Record<string, { faith: number; understanding: number; devotion: number }>,
) {
  const props = initNpcProps('Alice', 'farmer', 1) as NpcProperties;
  props.beliefs = beliefs;
  world.addEntity({ id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity);
  return getNpc(world, id)!;
}

describe('T5.0 — the reality number', () => {
  it('persists the mass the power loop was already computing', () => {
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit('player', true)]]);
    const c = ctx(spirits);
    // faith .4 · U .1 · D .15 → 0.4 × 1.2 × 1.3 = 0.624 (the default world's soul).
    addBeliever(c.world, 'n1', { player: { faith: 0.4, understanding: 0.1, devotion: 0.15 } });
    new SpiritSystem().tick({ ...c, dt: 1000, now: 1 });
    expect(spirits.get('player')!.beliefMass).toBeCloseTo(0.624, 6);
  });

  it('derives the tier the default world actually starts on', () => {
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit('player', true)]]);
    const c = ctx(spirits);
    for (let i = 0; i < 6; i++) {
      addBeliever(c.world, `n${i}`, { player: { faith: 0.4, understanding: 0.1, devotion: 0.15 } });
    }
    new SpiritSystem().tick({ ...c, dt: 1000, now: 1 });
    const p = spirits.get('player')!;
    expect(p.beliefMass).toBeCloseTo(3.744, 6);
    expect(p.tier).toBe('small');
  });

  it('intimacy is mass-weighted: one deep believer outweighs a shallow crowd', () => {
    const spirits = new Map<SpiritId, Spirit>([['deep', makeSpirit('deep')], ['broad', makeSpirit('broad')]]);
    const c = ctx(spirits);
    addBeliever(c.world, 'devotee', { deep: { faith: 1, understanding: 0.9, devotion: 0.9 } });
    for (let i = 0; i < 20; i++) {
      addBeliever(c.world, `shallow${i}`, { broad: { faith: 1, understanding: 0, devotion: 0 } });
    }
    new SpiritSystem().tick({ ...c, dt: 1000, now: 1 });
    const deep = spirits.get('deep')!, broad = spirits.get('broad')!;
    expect(deep.intimacy).toBeCloseTo(0.81, 6);   // 0.9 × 0.9
    expect(broad.intimacy).toBe(0);
    // The hollow god is far bigger and far less real per believer — the Act 3 matchup.
    expect(broad.beliefMass!).toBeGreaterThan(deep.beliefMass!);
    expect(broad.intimacy!).toBeLessThan(deep.intimacy!);
  });

  it('reports zero intimacy, not NaN, for a god nobody believes in', () => {
    const spirits = new Map<SpiritId, Spirit>([['ghost', makeSpirit('ghost')]]);
    const c = ctx(spirits);
    new SpiritSystem().tick({ ...c, dt: 1000, now: 1 });
    expect(spirits.get('ghost')!.intimacy).toBe(0);
    expect(spirits.get('ghost')!.beliefMass).toBe(0);
  });
});

describe('T5.1 — fading through the live system', () => {
  it('fades a believerless god only after the sustained window', () => {
    const s = makeSpirit('p', true, 100);
    const spirits = new Map<SpiritId, Spirit>([['p', s]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();

    sys.tick({ ...c, dt: 1000, now: 0 });
    expect(s.faded).toBe(false);
    expect(s.belowSinceTick).toBe(0);

    sys.tick({ ...c, dt: 1000, now: FADE_SUSTAIN_TICKS - 1 });
    expect(s.faded).toBe(false);

    sys.tick({ ...c, dt: 1000, now: FADE_SUSTAIN_TICKS });
    expect(s.faded).toBe(true);
    expect(s.tier).toBe('nameless');
    const faded = c.log.since(0).filter(a => a.event.type === 'god_faded');
    expect(faded).toHaveLength(1);
    expect(faded[0].event).toMatchObject({ type: 'god_faded', spiritId: 'p' });
  });

  it('emits god_faded once, not every tick thereafter', () => {
    const s = makeSpirit('p', true, 100);
    const spirits = new Map<SpiritId, Spirit>([['p', s]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();
    for (const now of [0, FADE_SUSTAIN_TICKS, FADE_SUSTAIN_TICKS + 1, FADE_SUSTAIN_TICKS + 500]) {
      sys.tick({ ...c, dt: 1000, now });
    }
    expect(c.log.since(0).filter(a => a.event.type === 'god_faded')).toHaveLength(1);
  });

  it('returns a faded god when belief comes back, and says so once', () => {
    const s = makeSpirit('p', true, 100);
    const spirits = new Map<SpiritId, Spirit>([['p', s]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 0 });
    sys.tick({ ...c, dt: 1000, now: FADE_SUSTAIN_TICKS });
    expect(s.faded).toBe(true);

    // A whisper lands and someone believes again.
    addBeliever(c.world, 'n1', { p: { faith: 0.9, understanding: 0.5, devotion: 0.5 } });
    sys.tick({ ...c, dt: 1000, now: FADE_SUSTAIN_TICKS + 1 });
    expect(s.faded).toBe(false);
    expect(s.belowSinceTick).toBeUndefined();
    expect(s.tier).toBe('small');
    expect(c.log.since(0).filter(a => a.event.type === 'god_returned')).toHaveLength(1);

    sys.tick({ ...c, dt: 1000, now: FADE_SUSTAIN_TICKS + 2 });
    expect(c.log.since(0).filter(a => a.event.type === 'god_returned')).toHaveLength(1);
  });

  it('survives a bad hour — pressure clears on any recovery tick', () => {
    const s = makeSpirit('p', true, 100);
    const spirits = new Map<SpiritId, Spirit>([['p', s]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 0 });
    expect(s.belowSinceTick).toBe(0);
    const n = addBeliever(c.world, 'n1', { p: { faith: 0.9, understanding: 0.5, devotion: 0.5 } });
    sys.tick({ ...c, dt: 1000, now: 100 });
    expect(s.belowSinceTick).toBeUndefined();
    // Losing them restarts the clock from scratch rather than resuming it.
    c.world.removeEntity(n.id);
    sys.tick({ ...c, dt: 1000, now: 200 });
    expect(s.belowSinceTick).toBe(200);
    sys.tick({ ...c, dt: 1000, now: 200 + FADE_SUSTAIN_TICKS - 1 });
    expect(s.faded).toBe(false);
  });

  it('fades rivals on exactly the same rule as the player', () => {
    const rival = makeSpirit('rival', false, 100);
    const spirits = new Map<SpiritId, Spirit>([['rival', rival]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 0 });
    expect(rival.faded).toBe(false);
    sys.tick({ ...c, dt: 1000, now: FADE_SUSTAIN_TICKS });
    expect(rival.faded).toBe(true);
    expect(c.log.since(0).filter(a => a.event.type === 'god_faded')).toHaveLength(1);
  });
});

describe('T5.1 — what a faded god can still do (the real guards)', () => {
  function fadedPlayerWith(target: Record<string, { faith: number; understanding: number; devotion: number }>) {
    const s = { ...makeSpirit('p', true, 1000), faded: true };
    const c = ctx(new Map<SpiritId, Spirit>([['p', s]]));
    const npc = addBeliever(c.world, 'n1', target);
    return { s, c, npc };
  }

  it('keeps the whisper — the only route back from nothing', () => {
    const { s, c, npc } = fadedPlayerWith({});
    expect(whisper(s, npc, c.log)).toBe(true);
    expect(s.power).toBeLessThan(1000);   // it really ran
  });

  it('loses omen, dream, miracle, answer_prayer, smite and storm', () => {
    const { s, c, npc } = fadedPlayerWith({ p: { faith: 0.5, understanding: 0.5, devotion: 0.5 } });
    const before = s.power;
    expect(omen(s, 'village-1', c.world, c.log)).toBe(false);
    expect(answerPrayer(s, npc, c.log)).toBe(false);
    // Refused outright — a faded god is not merely charged and ignored.
    expect(s.power).toBe(before);
  });

  it('canAfford agrees with the guards, however much power is banked', () => {
    const spirits = new Map<SpiritId, Spirit>([['p', { ...makeSpirit('p', true, 1e6), faded: true }]]);
    expect(canAfford(spirits, 'p', 'whisper')).toBe(true);
    for (const a of ['omen', 'dream', 'miracle', 'answer_prayer']) {
      expect(canAfford(spirits, 'p', a)).toBe(false);
    }
  });
});

describe('T5.1 — supplanting: a faded rival stops competing', () => {
  it('drops out of the claimant pool entirely', () => {
    const live = { ...makeSpirit('live', false, 1000), ai: { policy: 'x', cooldowns: {}, settlements: ['v1'], personality: PERSONALITY } };
    const dead = { ...makeSpirit('dead', false, 1000), faded: true, ai: { policy: 'x', cooldowns: {}, settlements: ['v1'], personality: PERSONALITY } };
    const spirits = new Map<SpiritId, Spirit>([['live', live], ['dead', dead]]);
    const c = ctx(spirits);
    const props = initNpcProps('Alice', 'farmer', 1) as NpcProperties;
    props.homePoiId = 'v1';
    c.world.addEntity({ id: 'n1', kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity);

    const claimants = eligibleClaimants(getNpc(c.world, 'n1')!, spirits);
    expect(claimants).toContain('live');
    expect(claimants).not.toContain('dead');
  });
});

describe('T5.1 — boot reality: a fresh world must not fade anyone', () => {
  it('starts every god, player and rival alike, clear of the fade line', () => {
    // The failure this pins: rivals get NO named believers at seed
    // (`instantiateRivals` only assigns settlements), so if their statistical
    // followers didn't count they would all fade on game-day 2 and Track 3 would
    // die silently on every fresh world. Measured through the real boot order —
    // seedWorld → rivals → cohorts — exactly as `bootstrap-world.ts` runs it.
    const ws = JSON.parse(readFileSync('public/data/worlds/default.json', 'utf8')) as WorldSeed;
    const clock = new SimClock();
    const log = new EventLog(clock);
    const m = gridMap(ws.size?.width ?? 64, ws.size?.height ?? 64);
    const world = new World(m);
    const rng = createRng(12345);
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit('player', true, 3)]]);
    seedWorld({ world, log, clock, spirits, rng, worldSeed: ws, map: m, oracle: identityOracle });

    const settlementIds = (ws.pois ?? []).filter((p: { npcs?: unknown[] }) => (p.npcs?.length ?? 0) > 0).map((p: { id: string }) => p.id);
    for (const r of generateRivalSpirits(rng.nextInt(0x7fffffff), settlementIds, 2)) {
      spirits.set(r.id, rivalToSpirit(r));
    }
    const cohorts = seedStatisticalCohorts(world, ws, spirits, clock.now());

    new SpiritSystem(() => cohorts).tick({ world, log, clock, spirits, rng, dt: 1000, now: 1 });

    expect(spirits.size).toBe(3);
    for (const s of spirits.values()) {
      expect(s.beliefMass!).toBeGreaterThan(FADE_MASS);
      expect(s.tier).toBe('small');       // Act 1: everyone starts a small god
      expect(s.faded).toBe(false);
      expect(s.belowSinceTick).toBeUndefined();
    }
    // Headroom, not a squeak past the line — measured 6.80 / 4.86 / 3.24.
    for (const s of spirits.values()) expect(s.beliefMass!).toBeGreaterThan(3 * FADE_MASS);
  });
});

describe('T5 — persistence', () => {
  it('round-trips the lifecycle fields through a snapshot', () => {
    const state = makeState();
    state.spirits.set('p', {
      ...makeSpirit('p', true, 42),
      faded: true, belowSinceTick: 7, beliefMass: 0.5, intimacy: 0.25, tier: 'nameless',
    });
    const snap = captureSnapshot(state);

    // A god that rose again AFTER the snapshot must be un-risen by the scrub.
    Object.assign(state.spirits.get('p')!, {
      faded: false, belowSinceTick: undefined, tier: 'major', intimacy: 0.9,
    });
    restoreSnapshot(state, snap);

    const back = state.spirits.get('p')!;
    expect(back.faded).toBe(true);
    expect(back.belowSinceTick).toBe(7);
    expect(back.tier).toBe('nameless');
    expect(back.intimacy).toBe(0.25);
  });

  it('loads a pre-T5.0 spirit (no new fields) and re-derives within one tick', () => {
    const legacy = makeSpirit('p', true, 5);           // exactly the old shape
    expect(legacy.tier).toBeUndefined();
    const spirits = new Map<SpiritId, Spirit>([['p', legacy]]);
    const c = ctx(spirits);
    addBeliever(c.world, 'n1', { p: { faith: 0.4, understanding: 0.1, devotion: 0.15 } });
    new SpiritSystem().tick({ ...c, dt: 1000, now: 1 });
    expect(legacy.tier).toBe('nameless');              // 0.624 < SMALL_IN
    expect(legacy.beliefMass).toBeCloseTo(0.624, 6);
    expect(legacy.faded).toBe(false);
  });
});
