// W4 (D7): the pantheon panel's data — `GameQuery.pantheon()`. Rivals were
// invisible in the barebones UI (`GameQuery.spirits()` had no consumer); this
// is the read-only roster the SPIRITS pill opens. Covers: player-first + by-
// follower-desc ordering, the two-tier follower fold (named durable +
// statistical cohort), stance derivation from `strategyForPersonality`, the
// strongest-settlement resolution, and JSON round-trip (no live refs).

import { describe, it, expect } from 'vitest';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { emptySettlementCohorts } from '@/sim/cohorts';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { RivalPersonality } from '@/sim/rival-spirit';

function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}

/** A durable believer (faith>0.3 && devotion>0.4) toward `spiritId`, homed at `poiId`. */
function addBeliever(world: World, id: string, spiritId: SpiritId, poiId: string): Entity {
  const props = initNpcProps('Pip', 'farmer', 7) as NpcProperties;
  props.homePoiId = poiId;
  props.beliefs[spiritId] = { faith: 0.8, understanding: 0.5, devotion: 0.6 };
  const e = { id, kind: 'npc', x: 1, y: 1, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

function rivalSpirit(id: SpiritId, overrides: Partial<Spirit> = {}): Spirit {
  return {
    id, name: id, sigil: '◆', color: '#f00', isPlayer: false, power: 5, manifestation: null,
    ...overrides,
  };
}

function personality(overrides: Partial<RivalPersonality> = {}): RivalPersonality {
  return { aggression: 0.1, subtlety: 0.1, territoriality: 0.1, assertiveness: 0.1, jealousy: 0.1, ...overrides };
}

/** Seed a settlement's statistical cohort with N believers toward `spiritId` in
 *  the first age band — the P1 tier `totalCohortBelievers`/`cohortBelievers` read. */
function seedCohortBelievers(state: ReturnType<typeof createState>, poiId: string, spiritId: SpiritId, n: number): void {
  const sc = state.cohorts.get(poiId) ?? emptySettlementCohorts(poiId);
  sc.bands[0].belief[spiritId] = { sumFaith: 0, sumU: 0, sumD: 0, sumContribution: 0, believerCount: n, durableCount: 0 };
  state.cohorts.set(poiId, sc);
}

function build() {
  const world = makeWorld();
  const state = createState();
  state.world = world;
  state.worldSeed = {
    name: 'w', size: { width: 10, height: 10 }, biome: 'temperate',
    pois: [
      { id: 'vale', type: 'village', name: 'Vale', position: { x: 5, y: 4 } },
      { id: 'ford', type: 'village', name: 'Ford', position: { x: 8, y: 8 } },
    ],
    connections: [], constraints: [],
  } as unknown as typeof state.worldSeed;
  return { world, state };
}

describe('GameQuery.pantheon (W4/D7)', () => {
  it('lists the player first even when a rival outnumbers it', () => {
    const { world, state } = build();
    addBeliever(world, 'p1', 'player', 'vale');
    state.spirits.set('rival1', rivalSpirit('rival1'));
    addBeliever(world, 'r1', 'rival1', 'vale');
    addBeliever(world, 'r2', 'rival1', 'vale');
    addBeliever(world, 'r3', 'rival1', 'vale');

    const rows = createGameQuery({ state }).pantheon();
    expect(rows[0].id).toBe('player');
    expect(rows[0].isPlayer).toBe(true);
    expect(rows[1].id).toBe('rival1');
    expect(rows[1].followers).toBe(3);
  });

  it('sorts rivals by follower count descending, stable id tiebreak on a tie', () => {
    const { world, state } = build();
    state.spirits.set('rival-b', rivalSpirit('rival-b'));
    state.spirits.set('rival-a', rivalSpirit('rival-a'));
    addBeliever(world, 'b1', 'rival-b', 'vale');
    addBeliever(world, 'b2', 'rival-b', 'vale');
    addBeliever(world, 'a1', 'rival-a', 'vale');

    const rows = createGameQuery({ state }).pantheon();
    const rivalIds = rows.filter((r) => !r.isPlayer).map((r) => r.id);
    expect(rivalIds).toEqual(['rival-b', 'rival-a']); // 2 followers beats 1

    // Now tie them — id order (asc) breaks the tie.
    addBeliever(world, 'a2', 'rival-a', 'vale');
    const rows2 = createGameQuery({ state }).pantheon();
    expect(rows2.filter((r) => !r.isPlayer).map((r) => r.id)).toEqual(['rival-a', 'rival-b']);
  });

  it('folds BOTH population tiers into followers: named durable + statistical cohort', () => {
    const { world, state } = build();
    state.spirits.set('rival1', rivalSpirit('rival1'));
    addBeliever(world, 'r1', 'rival1', 'vale');      // 1 named durable believer
    seedCohortBelievers(state, 'vale', 'rival1', 4);  // + 4 statistical believers

    const rows = createGameQuery({ state }).pantheon();
    const rival = rows.find((r) => r.id === 'rival1')!;
    expect(rival.followers).toBe(5);
  });

  it('a non-durable named belief (faith below the durable line) does not count as a follower', () => {
    const { world, state } = build();
    state.spirits.set('rival1', rivalSpirit('rival1'));
    const props = initNpcProps('Weak', 'farmer', 3) as NpcProperties;
    props.homePoiId = 'vale';
    props.beliefs['rival1'] = { faith: 0.1, understanding: 0, devotion: 0 }; // below the durable line
    world.addEntity({ id: 'weak1', kind: 'npc', x: 1, y: 1, properties: props as unknown as Record<string, unknown> } as Entity);

    const rows = createGameQuery({ state }).pantheon();
    expect(rows.find((r) => r.id === 'rival1')!.followers).toBe(0);
  });

  it('derives a one-word stance from strategyForPersonality; the player has none', () => {
    const { state } = build();
    // High aggression ⇒ 'expand' (see rival-spirit.ts's decision tree).
    state.spirits.set('rival1', rivalSpirit('rival1', { ai: { policy: 'stale', cooldowns: {}, personality: personality({ aggression: 0.9 }) } }));

    const rows = createGameQuery({ state }).pantheon();
    expect(rows.find((r) => r.id === 'player')!.stance).toBe('');
    expect(rows.find((r) => r.id === 'rival1')!.stance).toBe('expand');
  });

  it('a rival with no stored ai/personality (legacy) reads an empty stance, never throws', () => {
    const { state } = build();
    state.spirits.set('rival1', rivalSpirit('rival1')); // no `ai` at all
    const rows = createGameQuery({ state }).pantheon();
    expect(rows.find((r) => r.id === 'rival1')!.stance).toBe('');
  });

  it('resolves the strongest settlement (max believers, both tiers) with a deterministic tie-break', () => {
    const { world, state } = build();
    state.spirits.set('rival1', rivalSpirit('rival1'));
    addBeliever(world, 'r1', 'rival1', 'vale');
    addBeliever(world, 'r2', 'rival1', 'vale');
    addBeliever(world, 'r3', 'rival1', 'ford');

    const rows = createGameQuery({ state }).pantheon();
    expect(rows.find((r) => r.id === 'rival1')!.strongestPoiId).toBe('vale'); // 2 > 1
  });

  it('a spirit with no believers anywhere resolves strongestPoiId to null', () => {
    const { state } = build();
    state.spirits.set('rival1', rivalSpirit('rival1'));
    const rows = createGameQuery({ state }).pantheon();
    expect(rows.find((r) => r.id === 'rival1')!.strongestPoiId).toBeNull();
  });

  it('every row is JSON-serializable (no live World/Entity/Spirit refs)', () => {
    const { world, state } = build();
    state.spirits.set('rival1', rivalSpirit('rival1', { ai: { policy: 'x', cooldowns: {}, personality: personality({ territoriality: 0.9 }) } }));
    addBeliever(world, 'r1', 'rival1', 'vale');

    const rows = createGameQuery({ state }).pantheon();
    const round = JSON.parse(JSON.stringify(rows));
    expect(round).toEqual(rows);
  });
});
