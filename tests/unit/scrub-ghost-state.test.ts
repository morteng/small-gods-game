/**
 * WP-D scrub-ghost regression tests.
 *
 * Tick systems that keep internal state (cooldowns, edge-detection sides,
 * ever-believed history) must snapshot it through `GameState.systemState`
 * (`SystemStateRegistry`) so a committed scrubbed timeline can neither be
 * SUPPRESSED by eligibility state from the discarded future nor DOUBLE-FIRE
 * edges that already fired before the snapshot point.
 */
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { SystemStateRegistry } from '@/core/system-state';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, NpcProperties } from '@/core/types';

type S = ReturnType<typeof createState>;

function attachWorld(state: S, opts?: { homePoiId?: string }): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  if (opts?.homePoiId) props.homePoiId = opts.homePoiId;
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: props as unknown as Record<string, unknown> });
}

function npcProps(state: S, id = 'n1'): NpcProperties {
  return state.world!.registry.get(id)!.properties as unknown as NpcProperties;
}

/** One 1 Hz system tick at sim tick `now` (also moves the state clock there). */
function tickAt(state: S, sys: { tick(ctx: any): void }, now: number): void {
  state.clock.setNow(now);
  sys.tick({
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    clock: state.clock, rng: state.rng, dt: 1000, now,
  });
}

function eventsOfType(state: S, type: string) {
  return state.eventLog.since(0).map(a => a.event).filter(e => e.type === type);
}

// ── SettlementEventSystem: cooldowns ─────────────────────────────────────────

describe('scrub-ghost: SettlementEventSystem cooldowns', () => {
  it('a cooldown armed in the discarded future is cleared by restore', () => {
    const state = createState();
    attachWorld(state, { homePoiId: 'poi1' });
    const sys = new SettlementEventSystem();
    state.systemState.register(sys);

    const snap = captureSnapshot(state); // no cooldowns yet

    // Discarded future: force a festival, run it to expiry → cooldown arms.
    state.world!.forcedEvents.set('poi1', 'festival');
    let ended = false;
    for (let t = 1; t <= 200 && !ended; t++) {
      tickAt(state, sys, t);
      ended = eventsOfType(state, 'settlement_end').length > 0;
    }
    expect(ended).toBe(true);
    expect((sys.serialize() as { cooldowns: unknown[] }).cooldowns.length).toBeGreaterThan(0);

    restoreSnapshot(state, snap);
    expect((sys.serialize() as { cooldowns: unknown[] }).cooldowns).toEqual([]);
  });

  it('ghost cooldowns suppress event rolls; restoring the snapshot un-suppresses them', () => {
    const state = createState();
    attachWorld(state, { homePoiId: 'poi1' });
    const sys = new SettlementEventSystem();
    state.systemState.register(sys);

    const snap = captureSnapshot(state);

    // Simulate ghost state: every event type on far-future cooldown for poi1.
    const types = ['drought', 'festival', 'dispute', 'plague', 'raiders',
      'trading_caravan', 'stranger_arrives', 'harvest_blessing'];
    sys.hydrate({ cooldowns: types.map(t => [`poi1:${t}`, 1e9]) });

    const N = 2000;
    for (let t = 1; t <= N; t++) tickAt(state, sys, t);
    expect(eventsOfType(state, 'settlement_begin')).toHaveLength(0); // wedged shut

    // Restore (clock + rng + cooldowns rewound) and replay the same span:
    // with the ghost cooldowns gone, the same rng stream now produces events.
    restoreSnapshot(state, snap);
    for (let t = 1; t <= N; t++) tickAt(state, sys, t);
    expect(eventsOfType(state, 'settlement_begin').length).toBeGreaterThan(0);
  });
});

// ── NpcSimSystem: belief/mood edge detection ─────────────────────────────────

describe('scrub-ghost: NpcSimSystem edge detection', () => {
  it('a belief_cross that fired only in the discarded future re-fires after restore', () => {
    const state = createState();
    attachWorld(state);
    const sys = new NpcSimSystem();
    state.systemState.register(sys);

    npcProps(state).beliefs['player'].faith = 0.45; // mid
    tickAt(state, sys, 1); // establish side = mid
    expect(eventsOfType(state, 'belief_cross')).toHaveLength(0);

    const snap = captureSnapshot(state); // sides: mid

    // Discarded future: faith rockets → high edge fires.
    npcProps(state).beliefs['player'].faith = 0.9;
    tickAt(state, sys, 2);
    expect(eventsOfType(state, 'belief_cross')).toHaveLength(1);

    // Scrub back + commit. Without hydration the side map would still say
    // 'high' and the SAME rise would be silently swallowed.
    restoreSnapshot(state, snap);
    const before = eventsOfType(state, 'belief_cross').length;
    npcProps(state).beliefs['player'].faith = 0.9;
    tickAt(state, sys, 2);
    expect(eventsOfType(state, 'belief_cross').length).toBe(before + 1);
  });

  it('an edge that fired BEFORE the snapshot does not double-fire after restore', () => {
    const state = createState();
    attachWorld(state);
    const sys = new NpcSimSystem();
    state.systemState.register(sys);

    npcProps(state).beliefs['player'].faith = 0.9;
    tickAt(state, sys, 1); // fires high (first encounter defaults mid)
    expect(eventsOfType(state, 'belief_cross')).toHaveLength(1);

    const snap = captureSnapshot(state); // sides: high, faith ~0.9

    tickAt(state, sys, 2); // still high → no new cross
    restoreSnapshot(state, snap);

    // Side hydrated back to 'high' → restored high faith must NOT re-cross.
    // (A reset-to-empty instead of serialize would double-fire here.)
    const before = eventsOfType(state, 'belief_cross').length;
    tickAt(state, sys, 2);
    expect(eventsOfType(state, 'belief_cross').length).toBe(before);
  });

  it('mood side state survives the round-trip (no duplicate mood_cross)', () => {
    const state = createState();
    attachWorld(state);
    const sys = new NpcSimSystem();
    state.systemState.register(sys);

    const p = npcProps(state);
    p.needs.safety = 1; p.needs.prosperity = 1; p.needs.community = 1; p.needs.meaning = 1;
    p.mood = 0.95;
    tickAt(state, sys, 1); // mood high → mood_cross fires once
    const fired = eventsOfType(state, 'mood_cross').length;
    expect(fired).toBeGreaterThan(0);

    const snap = captureSnapshot(state);
    restoreSnapshot(state, snap);
    tickAt(state, sys, 2);
    expect(eventsOfType(state, 'mood_cross').length).toBe(fired);
  });
});

// ── AbandonmentSystem: believed/lapsed/announced history ─────────────────────

describe('scrub-ghost: AbandonmentSystem history', () => {
  it('a believer_lost announced only in the discarded future can re-fire after restore', () => {
    const state = createState();
    attachWorld(state);
    const sys = new AbandonmentSystem();
    state.systemState.register(sys);

    npcProps(state).beliefs['player'].faith = 0.5; // active believer
    tickAt(state, sys, 1);                          // learns everBelieved

    const snap = captureSnapshot(state);

    // Discarded future: faith collapses, grace elapses → believer_lost.
    npcProps(state).beliefs['player'].faith = 0;
    for (let t = 2; t <= 13; t++) tickAt(state, sys, t);
    expect(eventsOfType(state, 'believer_lost')).toHaveLength(1);

    // Scrub back + commit: announced/lapsed rewound, everBelieved kept (it was
    // true at capture). The same collapse must announce again — without
    // hydration the ghost `announced` entry would suppress it forever.
    restoreSnapshot(state, snap);
    expect(npcProps(state).beliefs['player'].faith).toBe(0.5);
    npcProps(state).beliefs['player'].faith = 0;
    for (let t = 2; t <= 13; t++) tickAt(state, sys, t);
    expect(eventsOfType(state, 'believer_lost')).toHaveLength(2);
  });

  it('restoring to before the conversion forgets everBelieved (no lapse for a soul that never believed)', () => {
    const state = createState();
    attachWorld(state);
    const sys = new AbandonmentSystem();
    state.systemState.register(sys);

    npcProps(state).beliefs['player'].faith = 0.05; // never a believer
    const snap = captureSnapshot(state);

    // Discarded future: converts, then collapses.
    npcProps(state).beliefs['player'].faith = 0.5;
    tickAt(state, sys, 1);

    restoreSnapshot(state, snap);
    npcProps(state).beliefs['player'].faith = 0;
    for (let t = 2; t <= 20; t++) tickAt(state, sys, t);
    expect(eventsOfType(state, 'believer_lost')).toHaveLength(0);
  });
});

// ── Snapshot field: roundtrip, old-save compat, waterLevelM ──────────────────

describe('snapshot systems field + insurance', () => {
  it('roundtrips the systems dict and is JSON-cloneable (save-file path)', () => {
    const state = createState();
    attachWorld(state, { homePoiId: 'poi1' });
    const sys = new SettlementEventSystem();
    state.systemState.register(sys);
    sys.hydrate({ cooldowns: [['poi1:plague', 777]] });

    const snap = captureSnapshot(state);
    expect(snap.systems).toBeDefined();
    // A save file persists through structuredClone/JSON — must survive it.
    const revived = JSON.parse(JSON.stringify(snap));
    sys.hydrate(undefined); // dirty the live system
    restoreSnapshot(state, revived);
    expect(sys.serialize()).toEqual({ cooldowns: [['poi1:plague', 777]] });
  });

  it('old save / snapshot without the systems field resets systems cleanly (no throw)', () => {
    const state = createState();
    attachWorld(state, { homePoiId: 'poi1' });
    const sys = new SettlementEventSystem();
    const npcSys = new NpcSimSystem();
    state.systemState.register(sys);
    state.systemState.register(npcSys);

    const snap = captureSnapshot(state);
    delete snap.systems;
    delete snap.waterLevelM;

    sys.hydrate({ cooldowns: [['poi1:drought', 999]] });
    npcSys.hydrate({ beliefSides: [['n1:player', 'high']], moodSides: [['n1', 'low']] });
    state.waterLevelM = 4;

    expect(() => restoreSnapshot(state, snap)).not.toThrow();
    expect(sys.serialize()).toEqual({ cooldowns: [] });
    expect(npcSys.serialize()).toEqual({ beliefSides: [], moodSides: [] });
    expect(state.waterLevelM).toBe(0);
  });

  it('waterLevelM roundtrips through the snapshot', () => {
    const state = createState();
    attachWorld(state);
    state.waterLevelM = 3.5;
    const snap = captureSnapshot(state);
    state.waterLevelM = -2;
    restoreSnapshot(state, snap);
    expect(state.waterLevelM).toBe(3.5);
  });

  it('repeated restores of the same snapshot are not corrupted by post-restore mutation', () => {
    const state = createState();
    attachWorld(state, { homePoiId: 'poi1' });
    const sys = new SettlementEventSystem();
    state.systemState.register(sys);
    sys.hydrate({ cooldowns: [['poi1:raiders', 50]] });

    const snap = captureSnapshot(state);
    sys.hydrate({ cooldowns: [['poi1:raiders', 12345]] }); // mutate live state
    restoreSnapshot(state, snap);
    expect(sys.serialize()).toEqual({ cooldowns: [['poi1:raiders', 50]] });
    sys.hydrate({ cooldowns: [['ghost:festival', 1]] });   // mutate again
    restoreSnapshot(state, snap);                          // second restore, same snap
    expect(sys.serialize()).toEqual({ cooldowns: [['poi1:raiders', 50]] });
  });
});

// ── Registry contract ────────────────────────────────────────────────────────

describe('SystemStateRegistry', () => {
  it('rejects duplicate registration by name', () => {
    const reg = new SystemStateRegistry();
    reg.register(new NpcSimSystem());
    expect(() => reg.register(new NpcSimSystem())).toThrow(/already registered/);
  });

  it('ignores unknown keys and resets systems missing from the dict', () => {
    const reg = new SystemStateRegistry();
    const sys = new SettlementEventSystem();
    reg.register(sys);
    sys.hydrate({ cooldowns: [['a:festival', 9]] });
    // Dict from a save written by a build with a system this build lacks —
    // the unknown key is ignored; the registered system's key is absent → reset.
    expect(() => reg.hydrate({ some_future_system: { x: 1 } })).not.toThrow();
    expect(sys.serialize()).toEqual({ cooldowns: [] });
  });
});
