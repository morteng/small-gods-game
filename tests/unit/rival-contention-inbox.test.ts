// Rival economics — the PERSISTENT contention ladder surfaces through the
// existing divine-inbox machinery (no bespoke panel): a settlement in `schism`
// or `holy_war` produces ONE coalesced, poi-anchored item (alert-pins projects
// it for free), and a `holy_war` poi's claim multiplier compresses the effective
// rival claim window (`findClaimablePrayers`). The ledger STATE is the source of
// truth — tests populate `state.contention` directly and drive the inbox.
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';
import { findClaimablePrayers, PRAYER_CLAIM_WINDOW_TICKS } from '@/sim/rival-claims';
import { HOLY_WAR_CLAIM_MULT, type PoiBelieverCounts } from '@/sim/rival-contention';
import { scoreAffordance } from '@/game/affordance/salience';
import { createRng } from '@/core/rng';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function makeWorld(): World {
  return new World({ tiles: [], width: 10, height: 10, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as GameMap);
}
function counts(entries: Record<string, number>): PoiBelieverCounts { return new Map(Object.entries(entries)); }

function build() {
  const world = makeWorld();
  const state = createState();
  state.world = world;
  state.spirits.set('rival-1', { id: 'rival-1', name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power: 10, manifestation: null });
  state.worldSeed = {
    name: 'w', size: { width: 10, height: 10 }, biome: 'temperate',
    pois: [
      { id: 'vale', type: 'village', name: 'Vale', position: { x: 5, y: 4 } },
      { id: 'holt', type: 'village', name: 'Holt', position: { x: 8, y: 7 } },
    ],
    connections: [], constraints: [],
  } as unknown as typeof state.worldSeed;
  return { world, state };
}

describe('divineInbox — persistent contention ladder', () => {
  it('surfaces a holy_war as a coalesced high-salience anchored threat', () => {
    const { state } = build();
    // Drive Vale to holy war (3 steps of a near-even, populous census).
    const census = new Map([['vale', counts({ player: 30, 'rival-1': 28 })]]);
    for (let i = 0; i < 3; i++) state.contention.step(census, new Map(), i);
    expect(state.contention.stateOf('vale')).toBe('holy_war');

    const inbox = createGameQuery({ state }).divineInbox();
    const items = inbox.filter(i => i.id === 'war:vale');
    expect(items.length).toBe(1);                          // coalesced: one per settlement
    const item = items[0];
    expect(item.kind).toBe('threat');
    expect(item.title).toBe('Holy war rends Vale');
    expect(item.detail).toContain('Sablethorn');
    expect(item.target).toEqual({ kind: 'settlement', poiId: 'vale' });
    expect(item.anchor).toEqual({ x: 5, y: 4 });
    // Outranks an ordinary rival threat (which caps at 0.9).
    expect(item.salience).toBeGreaterThan(scoreAffordance({ kind: 'threat', rivalBelievers: 100 }));
  });

  it('surfaces a schism as an ordinary tiding (no holy_war item)', () => {
    const { state } = build();
    // Two steps reach schism but not war.
    const census = new Map([['vale', counts({ player: 30, 'rival-1': 28 })]]);
    for (let i = 0; i < 2; i++) state.contention.step(census, new Map(), i);
    expect(state.contention.stateOf('vale')).toBe('schism');

    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.find(i => i.id === 'war:vale')).toBeUndefined();
    const item = inbox.find(i => i.id === 'schism:vale');
    expect(item).toBeDefined();
    expect(item!.kind).toBe('tiding');
    expect(item!.title).toBe('A schism splits Vale');
    expect(item!.anchor).toEqual({ x: 5, y: 4 });
  });

  it('a calm/tension settlement produces no contention item', () => {
    const { state } = build();
    const census = new Map([['vale', counts({ player: 30, 'rival-1': 28 })]]);
    state.contention.step(census, new Map(), 0);           // one step → tension only
    expect(state.contention.stateOf('vale')).toBe('tension');
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.find(i => i.id.startsWith('war:') || i.id.startsWith('schism:'))).toBeUndefined();
  });
});

// ── mechanical teeth: holy war compresses the effective claim window ─────────
describe('findClaimablePrayers — holy-war claim compression', () => {
  function worshipperWorld(): { world: World; spirits: Map<SpiritId, Spirit>; now: number } {
    const world = makeWorld();
    const now = PRAYER_CLAIM_WINDOW_TICKS * 2;
    // A plea aged to 0.8× the base window: past the COMPRESSED (0.75×) window but
    // short of the normal window — so it fires ONLY under holy-war compression.
    const age = PRAYER_CLAIM_WINDOW_TICKS * 0.8;
    const p = initNpcProps('Pip', 'farmer', 7) as NpcProperties;
    p.homePoiId = 'vale';
    p.activity = 'worship';
    p.prayerSince = now - age;
    const e: Entity = { id: 'pip', kind: 'npc', x: 2, y: 3, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    const rival: Spirit = {
      id: 'rival-1', name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power: 100, manifestation: null,
      ai: { policy: 'coexist', cooldowns: {}, personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 }, settlements: ['vale'], lastActionTick: 0, actionCooldown: 0 },
    };
    const spirits = new Map<SpiritId, Spirit>([['rival-1', rival]]);
    return { world, spirits, now };
  }

  it('does NOT claim below the base window at the default multiplier (mult = 1)', () => {
    const { world, spirits, now } = worshipperWorld();
    const claims = findClaimablePrayers(world, spirits, now, createRng(1));   // default mult = 1
    expect(claims.length).toBe(0);
  });

  it('DOES claim the same plea when the poi is at holy war (compressed window)', () => {
    const { world, spirits, now } = worshipperWorld();
    const mult = (poiId: string) => (poiId === 'vale' ? HOLY_WAR_CLAIM_MULT : 1);
    const claims = findClaimablePrayers(world, spirits, now, createRng(1), mult);
    expect(claims.length).toBe(1);
    expect(claims[0]).toMatchObject({ npcId: 'pip', rivalId: 'rival-1', poiId: 'vale' });
  });

  it('leaves pleas in non-war settlements unaffected (mult = 1 elsewhere)', () => {
    const { world, spirits, now } = worshipperWorld();
    const mult = (poiId: string) => (poiId === 'holt' ? HOLY_WAR_CLAIM_MULT : 1);  // war is elsewhere
    const claims = findClaimablePrayers(world, spirits, now, createRng(1), mult);
    expect(claims.length).toBe(0);
  });
});
